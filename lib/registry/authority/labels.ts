// What an address is, so a holder list stops being hex. Three sources, in
// order of authority: contracts this chain's own infrastructure is built from
// (the Uniswap v4 PoolManager, every Uniswap v3 pool, the bridge gateways), the wallets a Stock
// Token's mints are sent to, and a code probe over every holder with a
// material share that separates a contract from a person's wallet. A label is
// a fact about an address, not about an asset, so it is written once and read
// by every asset it holds.
//
// Verified on chain 2026-09-04 against the local holder ledger: the v4
// PoolManager 0x8366a3…40951 is the largest holder of AMC, SNAP, PFE and DJT,
// and 0xcfaece…60a94 is the top mint recipient of 193 of the 194 Stock Tokens
// — the two addresses that decide most of the float on this chain.

import { and, eq, gt, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Address } from "viem";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { dexPools, holderBalances, holderLabels, registryAssets, registrySupplyEvents } from "@/lib/db/schema";
import { isRateLimit, l2Client, RATE_LIMIT_PAUSE_MS } from "@/lib/registry/authority/chain";
import { L2_CUSTOM_GATEWAY, L2_ERC20_GATEWAY, L2_GATEWAY_ROUTER, UNISWAP_V4_POOL_MANAGER, venueTitle } from "@/lib/registry/authority/constants";
import type { RunOutcome } from "@/lib/registry/authority/runs";

// The kinds a label can carry. `eoa` is the cached answer of the code probe
// when an address has no bytecode: without it every run would re-probe the
// same tens of thousands of ordinary wallets over a rate-limited RPC.
export type LabelKind = "pool_manager" | "dex_pool" | "issuer" | "bridge_gateway" | "locker" | "contract" | "exchange" | "eoa";

// The five places a supply can sit, plus what has not been checked yet. The
// shares over these add to 100, which is the only reason float means anything.
export const FLOAT_BUCKETS = ["pools", "issuer", "bridge", "contracts", "unknown", "float"] as const;

export type FloatBucket = (typeof FLOAT_BUCKETS)[number];

export function bucketOf(kind: string | null): FloatBucket {
  switch (kind) {
    case "pool_manager":
    case "dex_pool":
      return "pools";
    case "issuer":
      return "issuer";
    case "bridge_gateway":
      return "bridge";
    case "locker":
    case "contract":
    case "exchange":
      return "contracts";
    case "eoa":
      return "float";
    default:
      return "unknown";
  }
}

export const BUCKET_MEANING: Record<FloatBucket, string> = {
  pools: "sitting in a DEX pool, quotable by anyone",
  issuer: "held by a wallet the issuer mints to: inventory, not an investor's holding",
  bridge: "escrowed in a bridge gateway on this chain",
  contracts: "held by some other contract",
  unknown: "held by an address the code probe has not checked; it checks every holder above a ten-thousandth of a token's supply, so smaller holdings stay here",
  float: "held in ordinary wallets",
};

interface AddressLabel {
  address: string;
  label: string;
  kind: LabelKind;
}

// Uniswap v4 keeps every pool's tokens in the PoolManager's own balance, so
// one address carries the whole chain's v4 liquidity and its dex_pools rows are
// pool ids with no address of their own. Uniswap v3 pools are contracts holding
// their own liquidity, and poolLabels below names each one `dex_pool`.
const SEED_LABELS: readonly AddressLabel[] = [
  { address: UNISWAP_V4_POOL_MANAGER, label: "Uniswap v4 PoolManager", kind: "pool_manager" },
  { address: L2_ERC20_GATEWAY, label: "Arbitrum standard ERC-20 gateway", kind: "bridge_gateway" },
  { address: L2_CUSTOM_GATEWAY, label: "Arbitrum custom gateway", kind: "bridge_gateway" },
  { address: L2_GATEWAY_ROUTER, label: "Arbitrum gateway router", kind: "bridge_gateway" },
];

// How much of an asset an address must hold before the probe asks what it is:
// a ten-thousandth of the balances the ledger holds for that asset. Rank is the
// wrong test, because the 300th holder of one token can matter more than the
// 5th of another, and a holding under this cannot move a share by a hundredth
// of a percent. The tail below it is never probed, which is why float is
// published as a floor rather than a final answer.
const PROBE_SHARE_DENOMINATOR = 10_000;
// How long "this address has no code" is trusted. An address can hold tokens
// before its contract is deployed (a counterfactual CREATE2 or Safe address)
// and a wallet can adopt an EIP-7702 delegation later, so the cached answer
// expires instead of standing forever.
const EOA_RECHECK_DAYS = 30;
// One run's budget of eth_getCode calls, and how fast it may spend it. The
// public RPC refuses at a few dozen calls a second and this job shares it with
// the log scanners, so the probe is paced, backs off once when refused, and
// stops at a deadline rather than holding the daemon's slot. A fresh database
// needs several runs to name its holders and the run detail says how many are
// left.
const PROBE_BUDGET = 2_000;
const PROBE_CONCURRENCY = 4;
const PROBE_PACE_MS = 250;
const PROBE_DEADLINE_MS = 4 * 60_000;

async function writeLabels(rows: AddressLabel[], source: string): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const now = new Date();
  await db
    .insert(holderLabels)
    .values(rows.map((row) => ({ address: row.address.toLowerCase(), label: row.label, kind: row.kind, source })))
    .onConflictDoUpdate({
      target: holderLabels.address,
      // firstSeenAt is not in the set: it is when the registry first named
      // this address and a re-run must not move it.
      set: { label: sql`excluded.label`, kind: sql`excluded.kind`, source: sql`excluded.source`, checkedAt: now },
    });
}

export interface MintRecipient {
  assetId: string;
  counterparty: string;
  mints: number;
  assetMints: number;
  assetType: string;
}

// The address each asset's mints are sent to most often, with how many of that
// asset's mints it took: one read, used here to label issuer wallets and by the
// daily concentration for each asset's own issuerAddress.
export async function topMintRecipients(chainId: number): Promise<MintRecipient[]> {
  const rows = await db.execute<{ asset_id: string; counterparty: string; mints: string; asset_mints: string; asset_type: string }>(sql`
    select asset_id, counterparty, mints::text as mints, asset_mints::text as asset_mints, asset_type
    from (
      select
        e.asset_id,
        e.counterparty,
        a.asset_type,
        count(*) as mints,
        sum(count(*)) over (partition by e.asset_id) as asset_mints,
        row_number() over (partition by e.asset_id order by count(*) desc, e.counterparty) as rn
      from ${registrySupplyEvents} e
      join ${registryAssets} a on a.id = e.asset_id
      where e.kind = 'mint' and e.chain_id = ${chainId}
      group by e.asset_id, e.counterparty, a.asset_type
    ) ranked
    where rn = 1
  `);
  return rows.rows.map(function shape(row) {
    return {
      assetId: row.asset_id,
      counterparty: row.counterparty,
      mints: Number(row.mints),
      assetMints: Number(row.asset_mints),
      assetType: row.asset_type,
    };
  });
}

// A Stock Token's mints are the issuer creating inventory and they go to one
// wallet, which is the case this label was designed for. Mints of the
// stablecoin and of the bridged assets are user deposits — USDG has 1,746
// distinct mint recipients on this chain, UNI exactly one mint — so their top
// recipient is a depositor, and labelling it issuer would subtract a stranger's
// balance from float in every asset. Hence Stock Tokens only, and only where
// one address took most of a run of mints.
const ISSUER_MIN_MINTS = 10;

function issuerWallets(recipients: MintRecipient[]): AddressLabel[] {
  const assetsPer = new Map<string, number>();
  for (const row of recipients) {
    const issuer = row.assetType === "stock_token" && row.mints >= ISSUER_MIN_MINTS && row.mints * 2 > row.assetMints;
    if (issuer) {
      assetsPer.set(row.counterparty, (assetsPer.get(row.counterparty) ?? 0) + 1);
    }
  }
  return [...assetsPer].map(function name([address, assets]) {
    return { address, label: assets > 1 ? `Issuer mint wallet (${assets} assets)` : "Issuer mint wallet", kind: "issuer" as const };
  });
}

// Every address holding a material share of some asset that carries no current
// label, with the largest share it holds anywhere: one definition, asked for as
// a list to probe and as a count to report what is still unnamed. A `contract`,
// `issuer` or seed label settles an address for good; an `eoa` label only until
// it expires.
const UNLABELLED_MATERIAL_HOLDERS = sql`
  select b.holder, max(b.raw_balance / t.total) as share
  from ${holderBalances} b
  join (select asset_id, sum(raw_balance) as total from ${holderBalances} where raw_balance > 0 group by asset_id) t on t.asset_id = b.asset_id
  where b.raw_balance > 0
    and b.raw_balance * ${PROBE_SHARE_DENOMINATOR} >= t.total
    and not exists (
      select 1 from ${holderLabels} l
      where l.address = b.holder
        and (l.kind <> 'eoa' or l.checked_at > now() - ${sql.raw(`interval '${EOA_RECHECK_DAYS} days'`)})
    )
  group by b.holder
`;

// Largest share first, so a budget that runs out leaves the smallest holdings
// unknown.
async function unlabelledMaterialHolders(limit: number): Promise<string[]> {
  const rows = await db.execute<{ holder: string }>(sql`select holder from (${UNLABELLED_MATERIAL_HOLDERS}) pending order by share desc limit ${limit}`);
  return rows.rows.map((row) => row.holder);
}

async function countUnlabelledMaterialHolders(): Promise<number> {
  const rows = await db.execute<{ n: string }>(sql`select count(*)::text as n from (${UNLABELLED_MATERIAL_HOLDERS}) pending`);
  return Number(rows.rows[0]?.n ?? 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise(function later(resolve) {
    setTimeout(resolve, ms);
  });
}

interface ProbeOutcome {
  probed: number;
  contracts: number;
  stoppedBy: "rate limit" | "deadline" | "error" | null;
  error?: string;
}

// eth_getCode per address: Multicall3 cannot ask what an address's code is, so
// there is no way to batch this. Each batch is written before the next is
// asked for, so a run cut short by the RPC or the deadline keeps everything it
// learned and the next run starts where it stopped.
async function probeCode(chainId: number, addresses: string[]): Promise<ProbeOutcome> {
  const client = l2Client(chainId);
  const until = Date.now() + PROBE_DEADLINE_MS;
  let probed = 0;
  let contracts = 0;
  let backedOff = false;
  let start = 0;
  while (start < addresses.length) {
    if (Date.now() > until) {
      return { probed, contracts, stoppedBy: "deadline" };
    }
    const batch = addresses.slice(start, start + PROBE_CONCURRENCY);
    let codes: Array<`0x${string}` | undefined>;
    try {
      codes = await Promise.all(batch.map((address) => client.getCode({ address: address as Address })));
    } catch (cause) {
      if (!isRateLimit(cause)) {
        // Anything but a refusal stops the probe with its reason on the run, so
        // a dead RPC does not read like a pass that checked every address.
        return { probed, contracts, stoppedBy: "error", error: cause instanceof Error ? cause.message : String(cause) };
      }
      if (backedOff) {
        // A second refusal after a full pause is the RPC telling the daemon to
        // come back later, not a hiccup; the labels already written stand.
        return { probed, contracts, stoppedBy: "rate limit" };
      }
      backedOff = true;
      await sleep(RATE_LIMIT_PAUSE_MS);
      continue;
    }
    const labels = batch.map(function classify(address, index): AddressLabel {
      const code = codes[index];
      const isContract = code !== undefined && code !== "0x";
      return { address, label: isContract ? "Contract" : "Wallet", kind: isContract ? "contract" : "eoa" };
    });
    await writeLabels(labels, "code-probe");
    probed += labels.length;
    contracts += labels.filter((label) => label.kind === "contract").length;
    start += PROBE_CONCURRENCY;
    await sleep(PROBE_PACE_MS);
  }
  return { probed, contracts, stoppedBy: null };
}

// An address that no longer qualifies must lose the label rather than keep it:
// a stale `issuer` row goes on subtracting somebody's balance from float in
// every asset they hold.
async function dropStaleIssuers(keep: AddressLabel[]): Promise<number> {
  const addresses = keep.map((row) => row.address.toLowerCase());
  const written = eq(holderLabels.source, "mint-recipient");
  const where = addresses.length === 0 ? written : and(written, notInArray(holderLabels.address, addresses));
  const dropped = await db.delete(holderLabels).where(where).returning({ address: holderLabels.address });
  return dropped.length;
}

// Pools that hold their own liquidity, named from dex_pools: their balances are
// depth on a DEX, not somebody's holding, and without a label the code probe
// would file each one under `contracts`.
async function poolLabels(chainId: number): Promise<AddressLabel[]> {
  const quoteAssets = alias(registryAssets, "quote_assets");
  const rows = await db
    .select({ address: dexPools.poolAddress, venue: dexPools.venue, symbol: registryAssets.symbol, quote: quoteAssets.symbol })
    .from(dexPools)
    .innerJoin(registryAssets, eq(registryAssets.id, dexPools.assetId))
    .leftJoin(quoteAssets, eq(quoteAssets.id, dexPools.quoteAssetId))
    .where(and(eq(dexPools.chainId, chainId), isNotNull(dexPools.poolAddress)));
  return rows.map(function toLabel(row): AddressLabel {
    const pair = row.quote ? `${row.symbol}/${row.quote}` : row.symbol;
    return { address: row.address as string, label: `${venueTitle(row.venue)} pool ${pair}`, kind: "dex_pool" };
  });
}

export async function refreshHolderLabels(chainId: number): Promise<RunOutcome> {
  await writeLabels([...SEED_LABELS], "constant");
  const pools = await poolLabels(chainId);
  await writeLabels(pools, "dex-pool");
  const issuers = issuerWallets(await topMintRecipients(chainId));
  await writeLabels(issuers, "mint-recipient");
  const droppedIssuers = await dropStaleIssuers(issuers);
  const probe = await probeCode(chainId, await unlabelledMaterialHolders(PROBE_BUDGET));
  return {
    rows: SEED_LABELS.length + pools.length + issuers.length + probe.probed,
    detail: {
      seeded: SEED_LABELS.length,
      pools: pools.length,
      issuers: issuers.length,
      droppedIssuers,
      probed: probe.probed,
      contracts: probe.contracts,
      // Counted after the writes, so it is what the next run will face.
      remaining: await countUnlabelledMaterialHolders(),
      stoppedBy: probe.stoppedBy,
      error: probe.error ?? null,
    },
  };
}

export interface HolderLabel {
  address: string;
  label: string;
  kind: LabelKind;
  bucket: FloatBucket;
}

// Labels for a page's or a route's handful of addresses, `eoa` rows included:
// an address the probe checked and found to be a wallet counts as float, one it
// has never checked counts as unknown, and a caller cannot tell those apart
// from a missing row. A page that has nothing to show for "this is a wallet"
// filters on the kind.
export async function labelsFor(addresses: string[]): Promise<Map<string, HolderLabel>> {
  if (addresses.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(holderLabels)
    .where(inArray(holderLabels.address, addresses.map((address) => address.toLowerCase())));
  return new Map(rows.map((row) => [row.address, { address: row.address, label: row.label, kind: row.kind as LabelKind, bucket: bucketOf(row.kind) }]));
}

// Every balance of one asset with whatever the address is known to be: what
// the daily concentration reading groups into shares. Unlike labelsFor this
// keeps `eoa` rows, because a wallet the probe has checked is float and one it
// has not is unknown, and the difference is the point.
export async function labelledBalances(assetId: string): Promise<Array<{ holder: string; rawBalance: string; kind: string | null }>> {
  return db
    .select({ holder: holderBalances.holder, rawBalance: holderBalances.rawBalance, kind: holderLabels.kind })
    .from(holderBalances)
    .leftJoin(holderLabels, eq(holderLabels.address, holderBalances.holder))
    .where(and(eq(holderBalances.assetId, assetId), gt(holderBalances.rawBalance, sql`0`)))
    .orderBy(sql`${holderBalances.rawBalance} desc`);
}
