// Chain access shared by the pipelines: the L2 client with Multicall3, an L1
// client for the rollup's Ethereum side, and a log scanner that narrows its
// window when the RPC refuses a range. No "server-only": the worker imports this.

import { createPublicClient, http, keccak256, parseEventLogs, type Abi, type Address, type Log, type PublicClient } from "viem";
import { getDaemonClient, getLogClient, usingPublicRpc } from "@/lib/chain/rpc";
import { pauseRequests } from "@/lib/chain/pace";
import { hypersyncConfig, hypersyncLogs } from "@/lib/registry/authority/hypersync";
import { logEvent } from "@/lib/log";
import { MULTICALL3 } from "@/lib/registry/authority/constants";

export function l2Client(chainId: number): PublicClient {
  return getDaemonClient(chainId);
}

let l1: PublicClient | null = null;

// Ethereum mainnet, where the rollup's inbox and bridge live. A keyed URL in
// RPC_URL_1 is preferred; the public endpoint answers the few calls made here.
export function l1Client(): PublicClient {
  if (!l1) {
    l1 = createPublicClient({ transport: http(process.env.RPC_URL_1 || "https://ethereum-rpc.publicnode.com") });
  }
  return l1;
}

export interface MulticallCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export interface MulticallResult {
  status: "success" | "failure";
  result?: unknown;
  error?: unknown;
}

// Every read goes through Multicall3 so 194 tokens cost a handful of requests
// against a rate-limited public RPC, not a thousand.
export async function multicall(client: PublicClient, contracts: MulticallCall[]): Promise<MulticallResult[]> {
  if (contracts.length === 0) {
    return [];
  }
  const results = await client.multicall({
    contracts: contracts as never,
    allowFailure: true,
    multicallAddress: MULTICALL3,
    // Bytes of calldata per eth_call, about thirty reads. Eight kilobytes
    // looked cheaper (a quarter of the calls) but the public RPC's eth_call
    // gas cap made every full chunk revert and only the short tail answer:
    // a pass over 2,500 pools updated fifty. Two kilobytes answers.
    batchSize: client.chain && !usingPublicRpc(client.chain.id) ? 32_768 : 2_048,
  });
  return results as MulticallResult[];
}

export interface ScanRange {
  fromBlock: bigint;
  toBlock: bigint;
}

interface ScanParams {
  source?: "rpc";
  client: PublicClient;
  addresses: Address[];
  abi: Abi;
  // One name filters by that event's arguments too; several names share one
  // request, matched on topic0 alone.
  eventName: string | string[];
  args?: Record<string, unknown>;
  range: ScanRange;
  chunk: bigint;
  label: string;
  // Called after every window with that window's logs and its last block. A
  // scanner that writes rows and moves its checkpoint here survives a restart
  // in the middle of a history backfill; without it the whole scan is redone.
  onWindow?: (logs: Log[], toBlock: bigint) => Promise<void>;
  // Smallest window the scanner will fall back to; a dense filter (every
  // transfer of every token) needs to go far below the default.
  minChunk?: bigint;
  // Pause between calls, so a scan that will make thousands of them leaves
  // room for the daemon's other jobs on the same rate-limited RPC.
  paceMs?: number;
  // End successfully after this many committed windows; callers resume from their checkpoint.
  maxWindows?: number;
}

// eth_getLogs, in windows. The public RPC has no documented range limit and
// answers sparse filters over millions of blocks, then refuses a dense one with
// a generic error; when that happens the window halves and the scan continues,
// so a first run over the chain's history finishes instead of failing at the
// first busy stretch.
// After this many windows in a row succeed, the window doubles again (up to
// the ceiling): density changes across a chain's history, and a scanner that
// only ever narrows would crawl through the sparse early blocks at the width
// the busiest ones forced on it.
const WIDEN_AFTER = 3;
// The public RPC's limit resets in a minute; a rate-limited window is retried
// after this pause rather than narrowed, since its size was not the problem.
export const RATE_LIMIT_PAUSE_MS = 20_000;
const MAX_REFUSALS_PER_WINDOW = 6;

function describe(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split("\n")[0].slice(0, 120);
}

// Exported because every job that talks to the public RPC in a loop has to
// tell "you are asking too fast" from a real failure, and they must agree.
// Only the status, the RPC's own code and its short text count. The full
// message carries the request body, and a hex address containing "429" once
// made "logs matched by query exceeds limit of 10000" read as a rate limit,
// which left two scanners waiting on a window they should have narrowed.
export function isRateLimit(cause: unknown): boolean {
  if (typeof cause === "object" && cause !== null) {
    const record = cause as { status?: unknown; code?: unknown; shortMessage?: unknown; details?: unknown };
    if (record.status === 429 || record.code === 429) {
      return true;
    }
    const text = `${typeof record.shortMessage === "string" ? record.shortMessage : ""} ${typeof record.details === "string" ? record.details : ""}`;
    // When the public RPC refuses a whole JSON-RPC batch it answers with one
    // 429 object instead of an array, and viem trips over it while indexing
    // the responses. That trace is a refusal, not an unknown error.
    return /rate limit|too many requests|reading 'error'/i.test(text);
  }
  return /rate limit|too many requests/i.test(String(cause));
}

function sleep(ms: number): Promise<void> {
  return new Promise(function later(resolve) {
    setTimeout(resolve, ms);
  });
}

// Pacing lives in lib/chain/pace.ts and applies to every request the daemon's
// client sends, this scanner's included.
export async function scanLogs(params: ScanParams): Promise<Log[]> {
  const client = params.client.chain ? getLogClient(params.client.chain.id, true) : params.client;
  const found: Log[] = [];
  let from = params.range.fromBlock;
  let chunk = params.chunk;
  const minChunk = params.minChunk ?? BigInt(2_000);
  let successes = 0;
  let refusals = 0;
  let committedWindows = 0;
  while (from <= params.range.toBlock) {
    const to = from + chunk - BigInt(1) > params.range.toBlock ? params.range.toBlock : from + chunk - BigInt(1);
    if (params.paceMs) {
      await sleep(params.paceMs);
    }
    try {
      // No addresses means "every contract that emits this event": one request
      // for the whole chain, matched against what we know afterwards. Ninety
      // address-filtered requests per window is what kept the swap scan days
      // behind head.
      let address: Address | Address[] | undefined = params.addresses;
      if (params.addresses.length === 0) {
        address = undefined;
      } else if (params.addresses.length === 1) {
        address = params.addresses[0];
      }
      const logs =
        (params.source === "rpc" ? null : await windowFromHyperSync(params, from, to)) ??
        (Array.isArray(params.eventName)
          ? await client.getLogs({ address, events: params.eventName.map((name) => eventFrom(params.abi, name)), fromBlock: from, toBlock: to })
          : await client.getLogs({ address, event: eventFrom(params.abi, params.eventName), args: params.args as never, fromBlock: from, toBlock: to }));
      if (params.onWindow) {
        await params.onWindow(logs as Log[], to);
      } else {
        found.push(...(logs as Log[]));
      }
      committedWindows += 1;
      if (params.maxWindows !== undefined && committedWindows >= params.maxWindows) break;
      from = to + BigInt(1);
      successes += 1;
      refusals = 0;
      if (successes >= WIDEN_AFTER && chunk < params.chunk) {
        chunk = chunk * BigInt(2) > params.chunk ? params.chunk : chunk * BigInt(2);
        successes = 0;
      }
    } catch (cause) {
      if (isRateLimit(cause)) {
        refusals += 1;
        logEvent("registry", { event: "scan-rate-limited", label: params.label, from: from.toString(), refusals, detail: describe(cause) });
        // A window refused this many times in a row is not going to pass in
        // this run; the run ends with the error on record and the checkpoint
        // where it was, and the next run starts there.
        if (refusals >= MAX_REFUSALS_PER_WINDOW) {
          throw new Error(`${params.label}: the RPC refused the window from ${from} ${refusals} times in a row`);
        }
        pauseRequests(RATE_LIMIT_PAUSE_MS);
        await sleep(RATE_LIMIT_PAUSE_MS);
        continue;
      }
      if (chunk <= minChunk) {
        throw cause;
      }
      chunk = chunk / BigInt(2);
      successes = 0;
      logEvent("registry", { event: "scan-narrowed", label: params.label, chunk: chunk.toString(), from: from.toString() });
    }
  }
  return found;
}

// With a HyperSync key configured, a window's logs come from there in one
// request and the public RPC keeps its budget for head reads. A failed page
// (a refused key, a timeout) is logged once and the window falls back to the
// RPC, so a missing or expired key slows the scanners rather than stopping
// them. Null means "not configured or failed": read the RPC.
let hypersyncWarned = false;

async function windowFromHyperSync(params: ScanParams, from: bigint, to: bigint): Promise<Log[] | null> {
  const config = hypersyncConfig();
  if (!config) {
    return null;
  }
  try {
    return await hypersyncLogs(config, { addresses: params.addresses, abi: params.abi, eventName: params.eventName, args: params.args as Record<string, unknown> | undefined, fromBlock: from, toBlock: to });
  } catch (cause) {
    if (!hypersyncWarned) {
      hypersyncWarned = true;
      logEvent("registry", { event: "hypersync-failed", label: params.label, message: cause instanceof Error ? cause.message : String(cause) });
    }
    return null;
  }
}

function eventFrom(abi: Abi, name: string) {
  const item = abi.find(function match(entry) {
    return entry.type === "event" && entry.name === name;
  });
  if (!item) {
    throw new Error(`ABI has no event ${name}`);
  }
  return item as Extract<Abi[number], { type: "event" }>;
}

export function decodeLogs<TAbi extends Abi>(abi: TAbi, logs: Log[]) {
  return parseEventLogs({ abi, logs, strict: true });
}

export async function blockHash(client: PublicClient, blockNumber: bigint): Promise<string> {
  const block = await client.getBlock({ blockNumber });
  return block.hash;
}

export function codeHash(code: `0x${string}` | undefined): string | null {
  return code && code !== "0x" ? keccak256(code) : null;
}

export function eventId(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}:${txHash}:${logIndex}`;
}
