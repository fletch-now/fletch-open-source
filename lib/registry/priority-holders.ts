import { createPublicClient, erc20Abi, http, parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";
import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { getLogClient, getLogRpcUrl, PUBLIC_RPC_URLS } from "@/lib/chain/rpc";
import { createDedicatedFetch, pacedFetch } from "@/lib/chain/pace";
import { budgetedRpcFetch } from "@/lib/chain/rpc-budget";
import { checkRpcBudget } from "@/lib/ratelimit";
import type { HolderObservation } from "./priority-metadata";

const holderClients = new Map<number,PublicClient>();
const dedicatedFetch = createDedicatedFetch();
export function priorityHolderClient(chainId: number): PublicClient {
  const cached = holderClients.get(chainId);
  if (cached) return cached;
  const url = getLogRpcUrl(chainId);
  const client = createPublicClient({ chain:getLogClient(chainId).chain,
    transport:http(url,{retryCount:0,timeout:20_000,fetchFn:budgetedRpcFetch(url===PUBLIC_RPC_URLS[chainId]?pacedFetch:dedicatedFetch,checkRpcBudget)}) });
  holderClients.set(chainId,client);
  return client;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_ADDRESSES = 50_000;
const MAX_LOGS = 500_000;
const MAX_RANGE = BigInt(2_000_000);
const SOURCE = "Complete ERC-20 Transfer history plus positive balanceOf snapshots at one pinned block; sum checked against totalSupply; zero address excluded from holder count";
interface HolderScan {
  head: string; hash: string; asOf: string; nextBlock: string; addresses: string[]; logs: number; range?: string;
}
export interface HolderScanOutcome {
  address: string; complete: boolean; holders: number | null; nextBlock: string; head: string; reason: string | null; logRequests: number;
}

export async function refreshPriorityHolders(chainId: number, address: string, options: { maxLogRequests?: number; client?: PublicClient; database?: Pool } = {}): Promise<HolderScanOutcome> {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("Invalid holder token address");
  const target = address.toLowerCase() as Address;
  const client = options.client ?? priorityHolderClient(chainId);
  // Alchemy documents a10k log response bound, verified against split Robinhood
  // ranges. Unverified providers retain the more conservative2k threshold.
  const responseLimit = new URL(getLogRpcUrl(chainId)).hostname.endsWith(".g.alchemy.com") ? 10_000 : 2_000;
  const database = options.database ?? pool;
  const limit = Math.min(100, Math.max(1, options.maxLogRequests ?? 40));
  const owner = await database.connect();
  let acquired = false;
  try {
    acquired = (await owner.query("select pg_try_advisory_lock(hashtextextended($1,55)) as acquired", [`holders:${chainId}:${target}`])).rows[0].acquired;
    if (!acquired) throw new Error("This token holder snapshot is already running");
    if (await client.getChainId() !== chainId) throw new Error("Holder RPC chain mismatch");
    const saved = await owner.query<{ holder_scan: HolderScan | null; holders: HolderObservation | null }>("select holder_scan,holders from registry_token_observations where chain_id=$1 and address=$2", [chainId, target]);
    const previous = saved.rows[0]?.holders;
    const previousAge = previous?.asOf ? Date.now()-Date.parse(previous.asOf) : Infinity;
    if (previous?.value !== null && previous?.value !== undefined && previous.reason === null && previousAge >= 0 && previousAge < 24*60*60_000
      && previous.blockNumber && previous.blockHash && (await client.getBlock({ blockNumber: BigInt(previous.blockNumber) })).hash === previous.blockHash) {
      return {address:target,complete:true,holders:previous.value,nextBlock:(BigInt(previous.blockNumber)+BigInt(1)).toString(),head:previous.blockNumber,reason:null,logRequests:0};
    }
    let scan = saved.rows[0]?.holder_scan ?? null;
    if (scan && (await client.getBlock({ blockNumber: BigInt(scan.head) })).hash !== scan.hash) scan = null;
    if (!scan) {
      const head = await client.getBlock({ blockTag: "latest" });
      if (head.number === null || !head.hash || !(await client.getCode({ address: target, blockNumber: head.number }))) throw new Error("Holder token has no code at the snapshot head");
      scan = { head: head.number.toString(), hash: head.hash, asOf: new Date(Number(head.timestamp) * 1000).toISOString(), nextBlock: "0", addresses: [], logs: 0 };
    }
    const addresses = new Set(scan.addresses);
    let next = BigInt(scan.nextBlock);
    const head = BigInt(scan.head);
    const hint = scan.range && /^\d{1,7}$/.test(scan.range) ? BigInt(scan.range) : BigInt(0);
    let range = hint >= BigInt(1) && hint <= MAX_RANGE ? hint : MAX_RANGE;
    let requests = 0;
    async function saveProgress(reason: string): Promise<void> {
      scan!.nextBlock = next.toString(); scan!.addresses = [...addresses].sort(); scan!.range = range.toString();
      await owner.query(`insert into registry_token_observations(chain_id,address,holder_scan,holders,holders_attempted_at)
        values($1,$2,$3,$4,clock_timestamp()) on conflict(chain_id,address) do update set holder_scan=excluded.holder_scan,
          holders=case when registry_token_observations.holders->>'value' is not null then registry_token_observations.holders else excluded.holders end,
          holders_attempted_at=excluded.holders_attempted_at`, [chainId, target, scan,
      { value: null, source: SOURCE, asOf: null, reason, blockNumber: null, blockHash: null } satisfies HolderObservation]);
    }
    while (next <= head && requests < limit) {
      const through = next + range - BigInt(1) < head ? next + range - BigInt(1) : head;
      requests++;
      let logs;
      try {
        logs = await client.getLogs({ address: target, event: TRANSFER, fromBlock: next, toBlock: through, strict: true });
        if (logs.length >= responseLimit) {
          if (range === BigInt(1)) throw new Error("One block exceeds the conservative holder-log response limit");
          range = range / BigInt(2) || BigInt(1);
          continue;
        }
      } catch (error) {
        if (range === BigInt(1)) throw error;
        range = range / BigInt(2) || BigInt(1);
        continue;
      }
      for (const log of logs) {
        if (log.removed || log.blockNumber === null || log.blockNumber < next || log.blockNumber > through || !log.args.from || !log.args.to) throw new Error("Incomplete or noncanonical holder log response");
        addresses.add(log.args.from.toLowerCase()); addresses.add(log.args.to.toLowerCase());
      }
      scan.logs += logs.length;
      if (addresses.size > MAX_ADDRESSES || scan.logs > MAX_LOGS) throw new Error("Targeted holder snapshot exceeded its bounded address or event budget");
      next = through + BigInt(1);
      await saveProgress("Complete holder history is still being scanned; no partial count is published.");
      if (logs.length < responseLimit / 10 && range < MAX_RANGE) range = range * BigInt(2) > MAX_RANGE ? MAX_RANGE : range * BigInt(2);
    }
    if (next <= head) {
      await saveProgress("Complete holder history is still being scanned; no partial count is published.");
      return { address: target, complete: false, holders: null, nextBlock: next.toString(), head: scan.head, reason: "Complete transfer history is not yet covered", logRequests: requests };
    }
    const holders = [...addresses];
    let count = 0;
    let sum = BigInt(0);
    for (let offset = 0; offset < holders.length; offset += 100) {
      const batch = holders.slice(offset, offset + 100);
      const results = await client.multicall({ contracts: batch.map((holder) => ({ address: target, abi: erc20Abi, functionName: "balanceOf", args: [holder as Address] })),
        allowFailure: true, blockNumber: head, batchSize: 8192 });
      for (const [index, result] of results.entries()) {
        if (result.status !== "success" || typeof result.result !== "bigint") throw new Error("A holder balance call failed; complete count is unavailable");
        sum += result.result;
        if (batch[index] !== zeroAddress && result.result > BigInt(0)) count++;
      }
    }
    const supply = await client.readContract({ address: target, abi: erc20Abi, functionName: "totalSupply", blockNumber: head });
    if (sum !== supply) throw new Error("Transfer-discovered balances do not sum to totalSupply; a complete holder count cannot be established");
    if ((await client.getBlock({ blockNumber: head })).hash !== scan.hash) throw new Error("Holder snapshot changed during scan; count not published");
    const observation: HolderObservation = { value: count, source: SOURCE, asOf: scan.asOf, reason: null,
      blockNumber: scan.head, blockHash: scan.hash, candidateAddresses: holders.length };
    await owner.query(`insert into registry_token_observations(chain_id,address,holders,holders_attempted_at,holder_scan)
      values($1,$2,$3,clock_timestamp(),null) on conflict(chain_id,address) do update set holders=excluded.holders,
      holders_attempted_at=excluded.holders_attempted_at,holder_scan=null`, [chainId, target, observation]);
    return { address: target, complete: true, holders: count, nextBlock: next.toString(), head: scan.head, reason: null, logRequests: requests };
  } catch (error) {
    if (acquired) {
      const message = error instanceof Error && /^(Holder RPC chain mismatch|Holder token has no code|One block exceeds|Incomplete or noncanonical|Targeted holder snapshot exceeded|A holder balance call failed|Transfer-discovered balances do not sum|Holder snapshot changed)/.test(error.message)
        ? error.message : "The targeted holder RPC scan failed; a complete count is unavailable.";
      await owner.query(`insert into registry_token_observations(chain_id,address,holders,holders_attempted_at)
        values($1,$2,$3,clock_timestamp()) on conflict(chain_id,address) do update set
        holders=case when registry_token_observations.holders->>'value' is not null then registry_token_observations.holders else excluded.holders end,
        holders_attempted_at=excluded.holders_attempted_at`, [chainId,target,
        {value:null,source:SOURCE,asOf:null,reason:message,blockNumber:null,blockHash:null} satisfies HolderObservation]);
    }
    throw error;
  } finally {
    if (acquired) await owner.query("select pg_advisory_unlock(hashtextextended($1,55))", [`holders:${chainId}:${target}`]).catch(function ignoreRelease() {});
    owner.release();
  }
}
