// Blockscout's public API is an independent source. Calls are paced; access
// denials are reported explicitly and never treated as fresh observations.

import { logEvent } from "@/lib/log";

const PUBLIC_BASE = "https://robinhoodchain.blockscout.com/api/v2";
const PRO_BASE = "https://api.blockscout.com/4663/api/v2";
const USER_AGENT = "Fletch/1.0 (+https://fletch.now)";
const MIN_GAP_MS = 300;
const RETRY_AFTER_MS = 2_000;

export class BlockscoutUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockscoutUnavailableError";
  }
}

// An endpoint's server error need not invalidate other assets' responses.
// Only safe relative paths are retained; credentials stay in request headers.
export class BlockscoutEndpointError extends Error {
  constructor(readonly status: number, readonly path: string) {
    super(`Explorer endpoint HTTP ${status} on ${path}; previous observation retained`);
    this.name = "BlockscoutEndpointError";
  }
}

export interface BlockscoutToken {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  holders: number | null;
  totalSupplyRaw: string | null;
}

interface RawToken {
  address_hash?: string;
  address?: string;
  symbol?: string | null;
  name?: string | null;
  decimals?: string | number | null;
  holders_count?: string | number | null;
  holders?: string | number | null;
  total_supply?: string | null;
}

let lastCallAt = 0;

export interface BlockscoutAccounting {
  beforeRequest: () => Promise<void>;
  afterResponse: (response: Response) => Promise<void>;
}

let accounting: BlockscoutAccounting | null = null;

export function configureBlockscoutAccounting(value: BlockscoutAccounting | null): void {
  accounting = value;
}

function pace(): Promise<void> {
  const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
  lastCallAt = Date.now() + wait;
  return new Promise(function later(resolve) {
    setTimeout(resolve, wait);
  });
}

function integerOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toToken(raw: RawToken): BlockscoutToken | null {
  const address = raw.address_hash ?? raw.address;
  if (!address) {
    return null;
  }
  return {
    address: address.toLowerCase(),
    symbol: raw.symbol ?? null,
    name: raw.name ?? null,
    decimals: integerOf(raw.decimals),
    holders: integerOf(raw.holders_count ?? raw.holders),
    totalSupplyRaw: raw.total_supply && /^\d+$/.test(raw.total_supply) ? raw.total_supply : null,
  };
}

async function get<T>(path: string, attempt = 1): Promise<T | null> {
  await pace();
  await accounting?.beforeRequest();
  const key = process.env.BLOCKSCOUT_API_KEY?.trim();
  const base = key ? PRO_BASE : PUBLIC_BASE;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": USER_AGENT };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}${path}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  await accounting?.afterResponse(response);
  if (response.status === 404) {
    await response.body?.cancel().catch(function discardFailure() {});
    return null;
  }
  const challenged = (response.headers.get("content-type") ?? "").includes("text/html");
  if ((challenged && response.status < 400) || response.status === 401 || response.status === 402 || response.status === 403) {
    await response.body?.cancel().catch(function discardFailure() {});
    throw new BlockscoutUnavailableError(`Explorer denied API access (HTTP ${response.status}); previous observations retained`);
  }
  if ((response.status === 429 || response.status >= 500) && attempt === 1) {
    await response.body?.cancel().catch(function discardFailure() {});
    logEvent("registry", { event: "blockscout-retry", path, status: response.status, challenged });
    await new Promise(function later(resolve) {
      setTimeout(resolve, RETRY_AFTER_MS);
    });
    return get<T>(path, 2);
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(function discardFailure() {});
    if (response.status === 429) throw new BlockscoutUnavailableError("Explorer unavailable (HTTP 429); previous observations retained");
    throw new BlockscoutEndpointError(response.status, path);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(function discardFailure() {});
    throw new Error(`explorer ${response.status} on ${path}`);
  }
  return (await response.json()) as T;
}

// First page only: Blockscout orders by holder count, and a lookalike nobody
// holds is not worth a row.
export async function searchTokens(query: string): Promise<BlockscoutToken[]> {
  const body = await get<{ items?: RawToken[] }>(`/tokens?q=${encodeURIComponent(query)}&type=ERC-20`);
  const items = body?.items ?? [];
  return items.map(toToken).filter(function present(token): token is BlockscoutToken {
    return token !== null;
  });
}

export async function tokenInfo(address: string): Promise<BlockscoutToken | null> {
  const body = await get<RawToken>(`/tokens/${address}`);
  return body ? toToken({ ...body, address_hash: body.address_hash ?? address }) : null;
}

export async function tokenCounters(address: string): Promise<{ holders: number | null; transfers: number | null } | null> {
  const body = await get<{ token_holders_count?: string; transfers_count?: string }>(`/tokens/${address}/counters`);
  return body ? { holders: integerOf(body.token_holders_count), transfers: integerOf(body.transfers_count) } : null;
}

export type ExplorerCursor = Record<string, string | number | boolean | null>;
export interface ExplorerTokenPage { items: BlockscoutToken[]; next: ExplorerCursor | null }

export function parseExplorerCursor(value: unknown): ExplorerCursor | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 4096) {
    throw new Error("Explorer token pagination schema changed");
  }
  const allowed = new Set(["name", "q", "contract_address_hash", "fiat_value", "market_cap", "holders_count", "items_count", "is_name_null"]);
  for (const [key, entry] of Object.entries(value)) {
    if (!allowed.has(key) || entry !== null && !["string", "number", "boolean"].includes(typeof entry)) {
      throw new Error("Explorer token pagination schema changed");
    }
  }
  if (Object.keys(value).length === 0) throw new Error("Explorer returned an empty pagination cursor");
  return value as ExplorerCursor;
}

export async function searchTokenPage(symbol: string, cursor: ExplorerCursor | null = null): Promise<ExplorerTokenPage> {
  const query = new URLSearchParams({ q: symbol, type: "ERC-20" });
  if (cursor) for (const [key, value] of Object.entries(parseExplorerCursor(cursor)!)) {
    if (key === "q") {
      if (value !== symbol) throw new Error("Explorer pagination changed the search symbol");
    } else {
      // Null sort values still select the cursor clause upstream. Omitting
      // those keys makes the explorer silently return the first page again.
      query.set(key, value === null ? "" : String(value));
    }
  }
  const body = await get<{ items?: RawToken[]; next_page_params?: unknown }>(`/tokens?${query}`);
  if (!body || !Array.isArray(body.items) || body.items.length > 100 || !("next_page_params" in body)) {
    throw new Error("Explorer token search schema changed; previous progress retained");
  }
  const items = body.items.map(function token(raw): BlockscoutToken {
    const value = toToken(raw);
    if (!value || !/^0x[0-9a-f]{40}$/.test(value.address) || value.symbol !== null && typeof value.symbol !== "string"
      || value.name !== null && typeof value.name !== "string") throw new Error("Explorer token metadata schema changed");
    return value;
  });
  const next = parseExplorerCursor(body.next_page_params);
  if (next && cursor && JSON.stringify(Object.entries(next).sort()) === JSON.stringify(Object.entries(cursor).sort())) {
    throw new Error("Explorer token pagination did not advance");
  }
  return { items, next };
}
