import type { HolderObservation } from "./priority-metadata";
import { tokenCounters } from "./authority/blockscout";

export const NATIVE_HOLDERS_REASON = "The zero address represents native ETH, not an ERC-20 token. An ERC-20 holder count does not apply.";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ORIGIN = "https://www.robinscan.net";
const CHAIN_ID = 4663;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
let reading = false;
let lastStartedAt = 0;

/** Read the labeled count, not the number of rows in the paginated holder table. */
export function parseExplorerHolders(html: string, address: string): number | null {
  if (!ADDRESS.test(address) || Buffer.byteLength(html, "utf8") > MAX_BYTES) return null;
  const document = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  if (!/Chain ID\s*:?\s*4663\b/.test(document) || !/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(document)) return null;
  const contracts = [...document.matchAll(/>\s*Contract\s*<\/div>\s*<div\b[^>]*>([\s\S]{0,2000}?)<\/div>/gi)];
  if (contracts.length !== 1) return null;
  const link = contracts[0][1].match(/<a\b[^>]*href=["']\/address\/(0x[0-9a-f]{40})["'][^>]*>\s*(0x[0-9a-f]{40})\s*<\/a>/i);
  if (!link || link[1].toLowerCase() !== address.toLowerCase() || link[2].toLowerCase() !== address.toLowerCase()) return null;
  const counts = [...document.matchAll(/>\s*Holders\s*<\/div>\s*<div\b[^>]*>\s*([\d,]+)\s*<\/div>/gi)];
  if (counts.length !== 1 || !/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(counts[0][1])) return null;
  const count = Number(counts[0][1].replaceAll(",", ""));
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

async function boundedHtml(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("body_too_large");
  }
  if (!response.body) throw new Error("body_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error("body_too_large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Public HTML only; no explorer credentials, billing proxies or redirects. */
export async function readExplorerHolders(chainId: number, address: string, fetcher: typeof fetch = fetch): Promise<HolderObservation> {
  const validAddress = ADDRESS.test(address);
  const url = validAddress ? `${ORIGIN}/token/${address.toLowerCase()}` : ORIGIN;
  const result: HolderObservation = {
    value: null,
    source: `Robinscan reported holder count: ${url}. Observation time is the page fetch time; source index snapshot time is not published.`,
    asOf: null,
    reason: null,
    blockNumber: null,
    blockHash: null,
  };
  if (chainId !== CHAIN_ID || !validAddress) return { ...result, reason: "This holder source supports valid token addresses on chain 4663 only." };
  if (address.toLowerCase() === ZERO_ADDRESS) return { ...result, source: "Native ETH on chain 4663; no ERC-20 token contract at the zero address.", reason: NATIVE_HOLDERS_REASON };
  if (reading) return { ...result, reason: "A public explorer holder read is already in progress." };
  reading = true;
  let signal: AbortSignal | null = null;
  try {
    const delay = Math.max(0, 1000 - (Date.now() - lastStartedAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastStartedAt = Date.now();
    signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetcher(url, { redirect: "error", credentials: "omit", signal, headers: { accept: "text/html" } });
    result.asOf = new Date().toISOString();
    if (response.url && response.url !== url) {
      await response.body?.cancel();
      return { ...result, reason: "The public explorer returned a different token page." };
    }
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
      await response.body?.cancel();
      return { ...result, reason: `The public explorer token page is unavailable (HTTP ${response.status}).` };
    }
    const html = await boundedHtml(response);
    result.asOf = new Date().toISOString();
    result.value = parseExplorerHolders(html, address);
    if (result.value === null) result.reason = "The public explorer page did not provide an unambiguous holder count for this exact address.";
    return result;
  } catch (error) {
    const timeout = signal?.aborted || error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    let reason = "The public explorer token page could not be fetched or read.";
    if (timeout) reason = "The public explorer page exceeded the 12-second request timeout.";
    else if (error instanceof Error && error.message === "body_too_large") reason = "The public explorer page exceeded the 2 MiB response limit.";
    return { ...result, value: null, reason };
  } finally {
    reading = false;
  }
}

export async function readPriorityHolders(chainId: number, address: string): Promise<HolderObservation> {
  if (!process.env.BLOCKSCOUT_API_KEY?.trim()) return readExplorerHolders(chainId, address);
  const result: HolderObservation = { value: null, source: `Chain explorer indexed holder count for ${address}. Fetch time recorded; source index snapshot time is unpublished.`,
    asOf: null, reason: null, blockNumber: null, blockHash: null };
  if (chainId !== CHAIN_ID || !ADDRESS.test(address)) return { ...result, reason: "This holder source supports valid token addresses on chain 4663 only." };
  if (address.toLowerCase() === ZERO_ADDRESS) return { ...result, reason: NATIVE_HOLDERS_REASON };
  try {
    const counters = await tokenCounters(address.toLowerCase());
    const value = counters?.holders;
    if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) {
      return { ...result, asOf: new Date().toISOString(), reason: "The chain explorer has no valid holder count for this address." };
    }
    return { ...result, value, asOf: new Date().toISOString() };
  } catch (error) {
    return { ...result, reason: error instanceof Error ? error.message : "The chain explorer holder count could not be read." };
  }
}
