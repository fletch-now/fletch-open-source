import { erc20Abi, zeroAddress, type Address, type PublicClient } from "viem";
import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { l2Client } from "./authority/chain";
import { metadataFailureSummary } from "./authority/dex-token-errors";

export interface TokenSupplyObservation {
  value: string | null;
  source: string;
  asOf: string;
  fetchedAt: string;
  blockNumber: string;
  blockHash: string;
  reason: string | null;
}

export interface TokenMetadataObservation {
  metadataError?: string | null;
  fetchedAt?: string;
  supply?: TokenSupplyObservation;
  burn?: TokenSupplyObservation;
  supplyAttemptedAt?: string;
  supplyError?: string | null;
  burnError?: string | null;
  bytecodePresent: boolean | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
  burnedRaw: string | null;
  source: string;
  asOf: string;
  blockNumber: string;
  blockHash: string;
  reason: string | null;
}
export interface HolderObservation {
  value: number | null;
  source: string;
  asOf: string | null;
  reason: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  candidateAddresses?: number;
}

const DEAD = "0x000000000000000000000000000000000000dEaD" as Address;

export async function refreshPriorityMetadata(chainId: number, addresses: readonly string[], client: PublicClient = l2Client(chainId), database: Pool = pool): Promise<{ read: number; failed: number }> {
  if (await client.getChainId() !== chainId) throw new Error("Metadata RPC chain mismatch");
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.number === null || !head.hash) throw new Error("Metadata snapshot head unavailable");
  const at = new Date(Number(head.timestamp) * 1000).toISOString();
  const targets = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 1200);
  let failed = 0;
  const pending: Array<{ address: string; metadata: TokenMetadataObservation; complete: boolean }> = [];
  for (let offset = 0; offset < targets.length; offset += 12) {
    const batch = targets.slice(offset, offset + 12);
    const calls = batch.flatMap((address) => [
      { address: address as Address, abi: erc20Abi, functionName: "name" },
      { address: address as Address, abi: erc20Abi, functionName: "symbol" },
      { address: address as Address, abi: erc20Abi, functionName: "decimals" },
      { address: address as Address, abi: erc20Abi, functionName: "totalSupply" },
      { address: address as Address, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] },
      { address: address as Address, abi: erc20Abi, functionName: "balanceOf", args: [zeroAddress] },
    ]);
    const [results, bytecodes] = await Promise.all([
      client.multicall({ contracts: calls, allowFailure: true, blockNumber: head.number, batchSize: 4096 }),
      Promise.all(batch.map(async (address) => {
        try { const code = await client.getCode({ address: address as Address, blockNumber: head.number! }); return code !== undefined && code !== "0x"; }
        catch { return null; }
      })),
    ]);
    if (results.length !== calls.length || metadataFailureSummary(results, calls).aggregateFailures > 0 || bytecodes.includes(null)) {
      throw new Error("Priority metadata RPC batch unavailable; previous observations and selection retained");
    }
    for (const [index, address] of batch.entries()) {
      const values = results.slice(index * 6, index * 6 + 6).map((result) => result.status === "success" ? result.result : null);
      const complete = bytecodes[index] === true && typeof values[0] === "string" && typeof values[1] === "string" && typeof values[2] === "number"
        && values[2] >= 0 && values[2] <= 255;
      if (!complete || typeof values[3] !== "bigint" || typeof values[4] !== "bigint" || typeof values[5] !== "bigint") failed++;
      const fetchedAt = new Date().toISOString();
      const metadata: TokenMetadataObservation = {
        bytecodePresent: bytecodes[index],
        name: typeof values[0] === "string" ? values[0].slice(0, 200) : null,
        symbol: typeof values[1] === "string" ? values[1].slice(0, 80) : null,
        decimals: typeof values[2] === "number" ? values[2] : null,
        totalSupplyRaw: typeof values[3] === "bigint" ? values[3].toString() : null,
        burnedRaw: typeof values[4] === "bigint" && typeof values[5] === "bigint" ? (values[4] + values[5]).toString() : null,
        fetchedAt,
        source: "Pinned RPC bytecode and ERC-20 name, symbol, decimals, totalSupply and burn-address balanceOf reads",
        asOf: at, blockNumber: head.number.toString(), blockHash: head.hash,
        reason: complete ? null : "One or more ERC-20 metadata calls failed at the pinned snapshot.",
      };
      const snapshot = { asOf: at, fetchedAt, blockNumber: head.number.toString(), blockHash: head.hash };
      metadata.supply = { ...snapshot, value: metadata.totalSupplyRaw, source: "Pinned ERC-20 totalSupply", reason: metadata.totalSupplyRaw === null ? "The totalSupply call failed." : null };
      metadata.burn = { ...snapshot, value: metadata.burnedRaw, source: "Pinned ERC-20 burn-address balanceOf reads", reason: metadata.burnedRaw === null ? "Both burn balances are required." : null };
      metadata.supplyAttemptedAt = fetchedAt;
      metadata.supplyError = metadata.supply.reason;
      metadata.burnError = metadata.burn.reason;
      pending.push({ address, metadata, complete });
    }
  }
  const canonical = await client.getBlock({ blockNumber: head.number });
  if (canonical.hash !== head.hash) throw new Error("Metadata snapshot changed during reads; priority refresh must be retried");
  for (const { address, metadata, complete } of pending) {
      const written = await database.query(`insert into registry_token_observations(chain_id,address,metadata,metadata_attempted_at)
        values($1,$2,$3,clock_timestamp()) on conflict(chain_id,address) do update set metadata=case when excluded.metadata->>'reason' is not null and registry_token_observations.metadata->>'reason' is null
          then registry_token_observations.metadata || jsonb_build_object('metadataError',excluded.metadata->>'reason')
          else excluded.metadata end
        || case when (excluded.metadata->'supply'->>'reason' is not null or
            (registry_token_observations.metadata->'supply'->>'asOf')::timestamptz > (excluded.metadata->'supply'->>'asOf')::timestamptz)
            and registry_token_observations.metadata->'supply'->>'value' is not null
          then jsonb_build_object('supply',registry_token_observations.metadata->'supply','totalSupplyRaw',registry_token_observations.metadata->>'totalSupplyRaw') else '{}'::jsonb end
        || case when (excluded.metadata->'burn'->>'reason' is not null or
            (registry_token_observations.metadata->'burn'->>'asOf')::timestamptz > (excluded.metadata->'burn'->>'asOf')::timestamptz)
            and registry_token_observations.metadata->'burn'->>'value' is not null
          then jsonb_build_object('burn',registry_token_observations.metadata->'burn','burnedRaw',registry_token_observations.metadata->>'burnedRaw') else '{}'::jsonb end,
        metadata_attempted_at=excluded.metadata_attempted_at
        where registry_token_observations.metadata is null
          or (registry_token_observations.metadata->>'asOf') is null
          or (registry_token_observations.metadata->>'asOf')::timestamptz > clock_timestamp()
          or (registry_token_observations.metadata->>'asOf')::timestamptz <= (excluded.metadata->>'asOf')::timestamptz`, [chainId, address, metadata]);
      if (!written.rowCount) continue;
      await database.query("update dex_tokens set bytecode_present=$3 where chain_id=$1 and address=$2", [chainId,address,metadata.bytecodePresent]);
      if (complete) await database.query(`update dex_tokens set name=$3,symbol=$4,decimals=$5,
        total_supply_raw=case when supply_checked_at is null or supply_checked_at<=$8 then coalesce($6,total_supply_raw) else total_supply_raw end,
        burned_raw=case when supply_checked_at is null or supply_checked_at<=$8 then coalesce($7,burned_raw) else burned_raw end,
        checked_at=$8,supply_checked_at=case when $6 is not null and $7 is not null then greatest(supply_checked_at,$8) else supply_checked_at end,
        error=null where chain_id=$1 and address=$2 and (checked_at is null or checked_at<=$8)`,
      [chainId, address, metadata.name, metadata.symbol, metadata.decimals, metadata.totalSupplyRaw, metadata.burnedRaw, metadata.asOf]);
  }
  return { read: targets.length, failed };
}

// Dynamic balances share a pinned snapshot without repeating bytecode, names or decimals.
export async function refreshPrioritySupply(chainId: number, addresses: readonly string[], client: PublicClient, database: Pool = pool): Promise<{ read: number; failed: number }> {
  if (await client.getChainId() !== chainId) throw new Error("Supply RPC chain mismatch");
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.number === null || !head.hash) throw new Error("Supply snapshot head unavailable");
  const targets = [...new Set(addresses.map((address) => address.toLowerCase()))].slice(0, 120);
  const pending: Array<{ address: string; supply: TokenSupplyObservation; burn: TokenSupplyObservation }> = [];
  for (let offset = 0; offset < targets.length; offset += 36) {
    const batch = targets.slice(offset, offset + 36);
    const calls = batch.flatMap((address) => [
      { address: address as Address, abi: erc20Abi, functionName: "totalSupply" },
      { address: address as Address, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] },
      { address: address as Address, abi: erc20Abi, functionName: "balanceOf", args: [zeroAddress] },
    ]);
    const results = await client.multicall({ contracts: calls, allowFailure: true, blockNumber: head.number, batchSize: 8192 });
    if (results.length !== calls.length || results.every((result) => result.status !== "success")) throw new Error("Supply RPC batch unavailable; previous observations retained");
    for (const [index, address] of batch.entries()) {
      const values = results.slice(index * 3, index * 3 + 3).map((result) => result.status === "success" ? result.result : null);
      const snapshot = { asOf: new Date(Number(head.timestamp) * 1000).toISOString(), fetchedAt: new Date().toISOString(), blockNumber: head.number.toString(), blockHash: head.hash };
      const supply = typeof values[0] === "bigint" ? values[0].toString() : null;
      const burn = typeof values[1] === "bigint" && typeof values[2] === "bigint" ? (values[1] + values[2]).toString() : null;
      pending.push({ address,
        supply: { ...snapshot, value: supply, source: "Pinned ERC-20 totalSupply", reason: supply === null ? "The totalSupply call failed." : null },
        burn: { ...snapshot, value: burn, source: "Pinned ERC-20 burn-address balanceOf reads", reason: burn === null ? "Both burn balances are required." : null },
      });
    }
  }
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) throw new Error("Supply snapshot changed during reads; observations not published");
  for (const { address, supply, burn } of pending) {
    const written = await database.query(`update registry_token_observations set metadata=metadata || jsonb_build_object(
        'supplyAttemptedAt',$3::text,'supplyError',$4::text,'burnError',$5::text)
        || case when $4::text is null then jsonb_build_object('supply',$6::jsonb,'totalSupplyRaw',$6::jsonb->>'value') else '{}'::jsonb end
        || case when $5::text is null then jsonb_build_object('burn',$7::jsonb,'burnedRaw',$7::jsonb->>'value') else '{}'::jsonb end
      where chain_id=$1 and address=$2 and metadata is not null
        and (coalesce(metadata->'supply'->>'asOf',metadata->>'asOf') is null
          or coalesce(metadata->'supply'->>'asOf',metadata->>'asOf')::timestamptz > clock_timestamp()
          or coalesce(metadata->'supply'->>'asOf',metadata->>'asOf')::timestamptz <= $8::timestamptz)`,
    [chainId, address, supply.fetchedAt, supply.reason, burn.reason, supply, burn, supply.asOf]);
    if (!written.rowCount) continue;
    if (supply.reason === null && burn.reason === null) await database.query(`update dex_tokens set total_supply_raw=$3,burned_raw=$4,supply_checked_at=$5
      where chain_id=$1 and address=$2 and (supply_checked_at is null or supply_checked_at<=$5)`, [chainId,address,supply.value,burn.value,supply.asOf]);
  }
  return { read: pending.length, failed: pending.filter((row) => row.supply.reason !== null || row.burn.reason !== null).length };
}
