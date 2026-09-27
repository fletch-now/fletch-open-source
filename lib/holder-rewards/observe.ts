import { erc20Abi, type Address, type PublicClient } from "viem";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getChainClient } from "@/lib/chain/rpc";
import { poolQuoteMetric } from "@/lib/registry/metric-observation";
import type { PoolQuoteObservation } from "@/lib/registry/token-markets-types";
import { decimalFraction, HOLDER_PRICE_MAX_AGE_MS, type HolderEvidence, type HolderPolicy } from "./model";

export class HolderReadingError extends Error {}

export interface RewardMarket {
  pool_id: string;
  price_usd: string;
  depth_usd: string;
  observed_at: Date;
  block_number: string;
  block_hash: string;
  reason: string | null;
  quote_observation: PoolQuoteObservation | null;
}

export function validateRewardMarket(row: RewardMarket | undefined, policy: HolderPolicy, now: number): RewardMarket {
  if (!row || row.reason || row.pool_id !== policy.referencePoolId) throw new HolderReadingError("The reference market has no usable token price yet.");
  const age = now - row.observed_at?.getTime();
  if (!Number.isFinite(age) || age < 0 || age > HOLDER_PRICE_MAX_AGE_MS) throw new HolderReadingError("The token price is out of date. Credits will be checked again when it refreshes.");
  const quote = poolQuoteMetric(row.quote_observation, row.observed_at.toISOString(), "Registry reference market", now);
  if (quote.value === null || !Number.isFinite(quote.value) || quote.value <= 0 || quote.observation.status !== "current" || row.quote_observation?.reason) throw new HolderReadingError("A current USD quote is required before holder credits can be awarded.");
  const depth = decimalFraction(row.depth_usd);
  const minimum = decimalFraction(policy.minDepthUsd);
  if (depth.units * minimum.scale < minimum.units * depth.scale) throw new HolderReadingError("The reference market needs more liquidity before holder credits can be awarded.");
  if (decimalFraction(row.price_usd).units <= BigInt(0) || !/^\d+$/.test(row.block_number) || !/^0x[0-9a-fA-F]{64}$/.test(row.block_hash)) throw new HolderReadingError("The token price has incomplete chain evidence.");
  return row;
}

export async function readRewardMarket(policy: HolderPolicy): Promise<RewardMarket> {
  const result = await db.execute<RewardMarket & Record<string, unknown>>(sql`
    select pp.pool_id,pp.price_usd::text,pp.depth_usd::text,
      pp.observed_at,pp.block_number::text,
      pp.block_hash,pp.reason,pp.quote_observation
    from registry_priority_pools pp
    join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
      and pp.factory_created_block=p.created_block
      and pp.factory_created_hash is not distinct from p.created_block_hash
    where pp.chain_id=${policy.chainId} and pp.address=${policy.tokenAddress}
      and pp.pool_id=${policy.referencePoolId} limit 1
  `);
  return validateRewardMarket(result.rows[0], policy, Date.now());
}

// Reads only. Users never approve token spending or send a transaction to qualify.
// Both a settled balance and a fresh balance must qualify; the lower one controls.
export async function observeHolding(policy: HolderPolicy, wallet: string, dependencies: {
  client?: PublicClient; readMarket?: typeof readRewardMarket;
} = {}): Promise<HolderEvidence> {
  if (policy.chainId !== 4663 || !policy.tokenAddress || !/^0x[0-9a-f]{40}$/.test(wallet)) throw new HolderReadingError("The official token is not configured on a supported network.");
  const client = dependencies.client ?? getChainClient(policy.chainId);
  const [market, chainId, safe, latest] = await Promise.all([
    (dependencies.readMarket ?? readRewardMarket)(policy), client.getChainId(), client.getBlock({ blockTag: "safe" }), client.getBlock({ blockTag: "latest" }),
  ]);
  const now = Date.now();
  if (chainId !== policy.chainId || safe.number === null || latest.number === null || !safe.hash || !latest.hash || safe.number > latest.number ||
      now - Number(latest.timestamp) * 1000 > 120_000 || Number(latest.timestamp) * 1000 > now + 15_000 ||
      Number(safe.timestamp) > Number(latest.timestamp) || now - Number(safe.timestamp) * 1000 > 7_200_000) throw new HolderReadingError("Waiting for current, settled chain data.");
  const token = policy.tokenAddress as Address;
  const address = wallet as Address;
  const [safeBalance, latestBalance, decimals, code, priceBlock] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address], blockNumber: safe.number }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address], blockNumber: latest.number }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber: safe.number }),
    client.getCode({ address: token, blockNumber: safe.number }),
    client.getBlock({ blockNumber: BigInt(market.block_number) }),
  ]);
  if (!code || code === "0x" || priceBlock.hash?.toLowerCase() !== market.block_hash.toLowerCase()) throw new HolderReadingError("The token or price block could not be verified.");
  const [confirmedSafe, confirmedLatest] = await Promise.all([
    client.getBlock({ blockNumber: safe.number }), client.getBlock({ blockNumber: latest.number }),
  ]);
  if (confirmedSafe.hash !== safe.hash || confirmedLatest.hash !== latest.hash) throw new HolderReadingError("The chain changed during this check. Fletch will retry.");
  validateRewardMarket(market, policy, Date.now());
  return {
    address: wallet, chainId, tokenAddress: token, balanceRaw: (safeBalance < latestBalance ? safeBalance : latestBalance).toString(),
    decimals, priceUsd: market.price_usd, poolId: market.pool_id, depthUsd: market.depth_usd,
    priceAt: market.observed_at.toISOString(), checkedAt: new Date().toISOString(),
    safeBlock: safe.number.toString(), safeBlockHash: safe.hash, latestBlock: latest.number.toString(),
  };
}
