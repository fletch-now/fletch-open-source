// Envio HyperSync as an alternative source of event logs. The public RPC
// allows about thirty calls a minute and refuses any window past ten thousand
// logs, which makes reading history a job of days; HyperSync answers the same
// question for a whole block range in one paged request. It is used only when
// a key is configured (HYPERSYNC_API_KEY, plus HYPERSYNC_URL to override the
// chain's endpoint), and the logs it returns are shaped exactly like the
// RPC's, so every scanner keeps its own decoding and checkpoints.

import { encodeEventTopics, type Abi, type Address, type Hex, type Log } from "viem";

const DEFAULT_URL = "https://robinhood.hypersync.xyz";
const PAGE_TIMEOUT_MS = 60_000;

export interface HyperSyncConfig {
  url: string;
  apiKey: string;
}

export function hypersyncConfig(): HyperSyncConfig | null {
  const apiKey = process.env.HYPERSYNC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return { url: (process.env.HYPERSYNC_URL ?? DEFAULT_URL).replace(/\/$/, ""), apiKey };
}

interface RawLog {
  address: string;
  data: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  block_number: number;
  transaction_hash: string;
  log_index: number;
  transaction_index: number;
  removed?: boolean | null;
}

interface QueryResponse {
  data?: Array<{ logs?: RawLog[] }>;
  next_block?: number;
  error?: string;
}

// One HyperSync log as the viem Log the scanners already decode. Block hash
// is not requested (a checkpoint's hash is read from the RPC when written).
export function toLog(raw: RawLog): Log {
  const topics = [raw.topic0, raw.topic1, raw.topic2, raw.topic3].filter((topic): topic is string => typeof topic === "string" && topic.length > 0) as [Hex, ...Hex[]];
  return {
    address: raw.address as Address,
    data: raw.data as Hex,
    topics,
    blockNumber: BigInt(raw.block_number),
    blockHash: null,
    transactionHash: raw.transaction_hash as Hex,
    transactionIndex: raw.transaction_index,
    logIndex: raw.log_index,
    removed: raw.removed === true,
  } as Log;
}

export interface HyperSyncLogQuery {
  addresses: Address[];
  abi: Abi;
  eventName: string | string[];
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
}

// The topic filter HyperSync wants: one array per position, each listing the
// values accepted there, an empty array meaning any. Built from the ABI so a
// scanner's `args` filter (a list of pool ids, say) applies the same way it
// does on the RPC.
export function topicFilter(query: HyperSyncLogQuery): Hex[][] {
  const names = Array.isArray(query.eventName) ? query.eventName : [query.eventName];
  const perEvent = names.map(function topicsFor(name) {
    return encodeEventTopics({ abi: query.abi, eventName: name, args: query.args } as never) as (Hex | Hex[] | null)[];
  });
  const positions = Math.max(...perEvent.map((topics) => topics.length));
  const filter: Hex[][] = [];
  for (let position = 0; position < positions; position += 1) {
    const values = new Set<Hex>();
    let any = false;
    for (const topics of perEvent) {
      const entry = topics[position];
      if (entry === null || entry === undefined) {
        any = true;
      } else if (Array.isArray(entry)) {
        entry.forEach((value) => values.add(value));
      } else {
        values.add(entry);
      }
    }
    filter.push(any && position > 0 ? [] : [...values]);
  }
  return filter;
}

// Every matching log in the range, paged through next_block. Throws on a
// refused key or a failed page; the caller falls back to the RPC.
export async function hypersyncLogs(config: HyperSyncConfig, query: HyperSyncLogQuery): Promise<Log[]> {
  const topics = topicFilter(query);
  const found: Log[] = [];
  let from = query.fromBlock;
  while (from <= query.toBlock) {
    const body = {
      from_block: Number(from),
      // HyperSync's to_block is exclusive.
      to_block: Number(query.toBlock) + 1,
      logs: [{ address: query.addresses, topics }],
      field_selection: { log: ["address", "data", "topic0", "topic1", "topic2", "topic3", "block_number", "transaction_hash", "log_index", "transaction_index", "removed"] },
    };
    const controller = new AbortController();
    const timer = setTimeout(function giveUp() {
      controller.abort();
    }, PAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${config.url}/query`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`HyperSync answered ${response.status}`);
    }
    const page = (await response.json()) as QueryResponse;
    if (page.error) {
      throw new Error(`HyperSync: ${page.error}`);
    }
    for (const batch of page.data ?? []) {
      for (const raw of batch.logs ?? []) {
        found.push(toLog(raw));
      }
    }
    const next = page.next_block;
    if (typeof next !== "number" || !Number.isSafeInteger(next) || BigInt(next) <= from) {
      throw new Error("HyperSync returned an incomplete page without an advancing next_block");
    }
    from = BigInt(next);
  }
  return found;
}
