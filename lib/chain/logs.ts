// ERC-20 Transfer log fetching for the watch daemon. No official range cap is
// published for Robinhood's RPC (docs/MVP.md "Risks, stated"), so the chunk size
// is discovered empirically per call: start at WATCH_LIMITS.logChunkBlocks, halve
// on anything that looks like a provider range/result-cap error, floor at
// MIN_LOG_CHUNK_BLOCKS blocks (QuickNode's documented 10,000-block cap is one data
// point among providers Robinhood recommends, not a number to trust blindly).

import { parseAbiItem } from "viem";
import { getLogClient } from "@/lib/chain/rpc";
import { WATCH_LIMITS } from "@/lib/watch/types";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export const MIN_LOG_CHUNK_BLOCKS = BigInt(50);

// Thrown when the caller's RPC budget (lib/ratelimit.ts-style daily counter) is
// spent; the poll loop catches this to flip a watcher to "degraded" rather than
// spinning on a provider that will just reject the call anyway.
export class BudgetExceededError extends Error {
  constructor() {
    super("RPC call budget exceeded");
    this.name = "BudgetExceededError";
  }
}

export interface TransferLog {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  from: string;
  to: string;
  value: bigint;
}

export interface FetchTransferLogsParams {
  daemon?: boolean;
  chainId: number;
  address: string;
  fromBlock: bigint;
  toBlock: bigint;
  // Only transfers into this address, filtered by the provider on the indexed
  // topic, so a treasury sweep does not page through every USDG transfer.
  to?: string;
  // Awaited before every RPC call; false means the caller's budget is spent.
  onRpcCall?: () => Promise<boolean>;
}

// Wide net: providers phrase their block-range and result-size caps differently
// ("query returned more than 10000 results", "block range too large", "exceeds
// the limit"...), and the daemon has no provider allowlist to special-case, so a
// message match is the only signal available.
const RANGE_ERROR_PATTERN = /range|limit|too many|exceed|10000|result set/i;

export function looksLikeRangeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RANGE_ERROR_PATTERN.test(message);
}

// Pure so it can be unit tested without a client: halve, but never below the
// floor. Once a call already at the floor still fails, the caller gives up
// rather than call this again and loop forever at the same size.
export function nextChunkSize(current: bigint): bigint {
  const halved = current / BigInt(2);
  return halved > MIN_LOG_CHUNK_BLOCKS ? halved : MIN_LOG_CHUNK_BLOCKS;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

// The indexed-argument filter for getLogs: `to` when a recipient is given,
// nothing otherwise. Pure so the shape is unit-tested without an RPC.
export function transferLogArgs(to?: string): { to: `0x${string}` } | undefined {
  return to ? { to: to as `0x${string}` } : undefined;
}

export async function fetchTransferLogs(params: FetchTransferLogsParams): Promise<TransferLog[]> {
  const { chainId, address, fromBlock, toBlock, onRpcCall, to } = params;
  const client = getLogClient(chainId, params.daemon ?? true);
  const results: TransferLog[] = [];

  let cursor = fromBlock;
  let chunkSize = BigInt(WATCH_LIMITS.logChunkBlocks);

  while (cursor <= toBlock) {
    const chunkEnd = minBigInt(cursor + chunkSize - BigInt(1), toBlock);

    if (onRpcCall) {
      const allowed = await onRpcCall();
      if (!allowed) {
        throw new BudgetExceededError();
      }
    }

    try {
      const logs = await client.getLogs({
        address: address as `0x${string}`,
        event: TRANSFER_EVENT,
        args: transferLogArgs(to),
        fromBlock: cursor,
        toBlock: chunkEnd,
        // Non-strict would type indexed args as possibly-undefined for any log
        // that fails to decode; strict drops those instead of forwarding a
        // Transfer with a missing `from`/`to`/`value`.
        strict: true,
      });
      for (const log of logs) {
        results.push({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          from: log.args.from,
          to: log.args.to,
          value: log.args.value,
        });
      }
      cursor = chunkEnd + BigInt(1);
    } catch (error) {
      const alreadyAtFloor = chunkSize <= MIN_LOG_CHUNK_BLOCKS;
      if (!looksLikeRangeError(error) || alreadyAtFloor) {
        throw error;
      }
      chunkSize = nextChunkSize(chunkSize);
      // cursor stays put; the next loop iteration retries this window at the
      // smaller chunk size instead of skipping the blocks that just failed.
    }
  }

  return results;
}

// A plain decimal string with up to 4 fractional digits, never exponential
// notation — BigInt math throughout so a uint256 value never round-trips
// through a float. Amounts land in Telegram alert text, where "1e21" reads as
// a bug, not a large number.
export function decodeAmount(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;

  const base = BigInt(10) ** BigInt(decimals);
  const remainder = magnitude % base;

  // Round the full-precision remainder to 4 fractional digits rather than
  // truncating the padded string, so e.g. 0.99996 rounds to 1.0000 correctly.
  const displayDecimals = Math.min(decimals, 4);
  const scale = BigInt(10) ** BigInt(decimals - displayDecimals);
  let scaledRemainder = remainder / scale;
  let wholePart = magnitude / base;
  // Compare 2x the leftover against the scale itself, not against scale/2 —
  // scale/2 floors to 0 when scale is 1 (decimals === displayDecimals), which
  // would round up on every value with no discarded precision at all.
  if ((remainder % scale) * BigInt(2) >= scale) {
    scaledRemainder += BigInt(1);
  }
  const fractionCap = BigInt(10) ** BigInt(displayDecimals);
  if (scaledRemainder >= fractionCap) {
    scaledRemainder -= fractionCap;
    wholePart += BigInt(1);
  }

  const fractionStr = scaledRemainder.toString().padStart(displayDecimals, "0");
  const trimmedFraction = fractionStr.replace(/0+$/, "");

  const sign = negative ? "-" : "";
  if (trimmedFraction.length === 0) {
    return `${sign}${wholePart.toString()}`;
  }
  return `${sign}${wholePart.toString()}.${trimmedFraction}`;
}
