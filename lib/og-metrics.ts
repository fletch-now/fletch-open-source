import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexPriceSamples, registryAssets } from "@/lib/db/schema";
import { RH_MAINNET_ID } from "@/lib/config";
import { priceFloorUsd } from "@/lib/admin/settings";
import { registryVerdict } from "@/lib/registry/authority/freshness";

export interface CardMetric {
  text: string;
  at: Date;
}

export async function registryCardMetric(): Promise<CardMetric> {
  const [row] = await db.select({ total: count() }).from(registryAssets)
    .where(and(eq(registryAssets.chainId, RH_MAINNET_ID), eq(registryAssets.status, "active")));
  return { text: `${row.total.toLocaleString("en-US")} listed tokens`, at: new Date() };
}

export async function marketCardMetric(): Promise<CardMetric> {
  const [row] = await db.select({ total: count() }).from(dexPools).where(eq(dexPools.chainId, RH_MAINNET_ID));
  return { text: `${row.total.toLocaleString("en-US")} indexed pools`, at: new Date() };
}

export async function statusCardMetric(): Promise<CardMetric> {
  const reading = await registryVerdict(RH_MAINNET_ID);
  return { text: `Registry status: ${reading.verdict}`, at: reading.checkedAt };
}

export async function tokenCardMetric(address: string, assetId?: string): Promise<CardMetric | null> {
  const floor = await priceFloorUsd();
  const target = assetId ? eq(dexPools.assetId, assetId) : eq(dexPools.tokenAddress, address);
  // Use the sample's own price and timestamp as a pair. state_checked_at does
  // not advance when the faster price sampler writes a new price.
  const rows = await db.select({ poolId: dexPools.id }).from(dexPools)
    .where(and(eq(dexPools.chainId, RH_MAINNET_ID), target, gte(dexPools.depthUsd, String(floor))))
    .orderBy(sql`${dexPools.depthUsd} desc nulls last`, dexPools.id).limit(1);
  if (!rows[0]) return null;
  const [sample] = await db.select().from(dexPriceSamples).where(eq(dexPriceSamples.poolId, rows[0].poolId))
    .orderBy(desc(dexPriceSamples.at)).limit(1);
  if (!sample) return null;
  const amount = Number(sample.priceUsd);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const price = amount > 0 && amount < 0.01 ? amount.toPrecision(3) : amount.toLocaleString("en-US", { maximumFractionDigits: 2, notation: "compact" });
  return { text: `DEX price: $${price}`, at: sample.at };
}
