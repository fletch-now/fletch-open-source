import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { db } from "@/lib/db";
import { emitEvents } from "@/lib/registry/authority/events";
import { registryAssets } from "@/lib/db/schema";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";
import { ROBINHOOD_ASSETS_ENDPOINT, fetchRobinhoodAssets } from "@/lib/registry/robinhood";
import { USDG } from "@/lib/payments/usdg";

// Registry syncs the public stock-token list; verification checks that the
// address it names actually has code on chain. Both stages are independent —
// one flaky RPC call must not throw away a whole sync's worth of upserts.
const VERIFY_CONCURRENCY = 5;

function registryId(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

// "ASSET_STATUS_ACTIVE" is the only value observed from the live endpoint; anything
// else (a future delisted/pending status, or a shape we have not seen) is treated
// as inactive rather than assumed tradable.
function mapStatus(raw: string): string {
  return raw === "ASSET_STATUS_ACTIVE" ? "active" : "inactive";
}

function mainnetClient(): ReturnType<typeof createPublicClient> {
  const rpcUrl = process.env.RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com";
  return createPublicClient({ transport: http(rpcUrl) });
}

async function runWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function worker(): Promise<void> {
    let item = queue.shift();
    while (item !== undefined) {
      await run(item);
      item = queue.shift();
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
}

// Sets verifiedAt on rows whose address has code on chain right now. Never clears
// a previously-set verifiedAt — a transient RPC error should not make a verified
// row look unverified again.
async function verifyOnChain(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = mainnetClient();
  await runWithConcurrency(ids, VERIFY_CONCURRENCY, async function verifyOne(id): Promise<void> {
    const address = id.slice(id.indexOf(":") + 1);
    try {
      const code = await client.getBytecode({ address: address as Address });
      if (code && code !== "0x") {
        await db.update(registryAssets).set({ verifiedAt: new Date() }).where(eq(registryAssets.id, id));
      }
    } catch {
      // Skip verification errors — a bad RPC round trip is not evidence the
      // contract is gone, so the row is left exactly as it was.
    }
  });
}

// Bytecode at an address proves a contract is there. These three calls prove it is
// the contract Robinhood listed: a token that answers with a different symbol or a
// different number of decimals is not the one in the listing, and a watcher built
// on the listing's decimals would report the wrong amount.
const ERC20_METADATA_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Three extra RPC calls per asset, so this runs at most weekly per row rather
// than on every fifteen-minute sync: a deployed token's name does not change.
const METADATA_TTL_DAYS = 7;

async function readMetadata(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const cutoff = new Date(Date.now() - METADATA_TTL_DAYS * 86_400_000);
  const due = await db
    .select({ id: registryAssets.id, address: registryAssets.address })
    .from(registryAssets)
    .where(
      and(
        sql`${registryAssets.id} in ${ids}`,
        or(isNull(registryAssets.metadataCheckedAt), lt(registryAssets.metadataCheckedAt, cutoff)),
      ),
    );
  if (due.length === 0) {
    return;
  }
  const client = mainnetClient();
  await runWithConcurrency(due, VERIFY_CONCURRENCY, async function readOne(row): Promise<void> {
    const address = row.address as Address;
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: ERC20_METADATA_ABI, functionName: "name" }).catch(function unreadable() {
        return null;
      }),
      client.readContract({ address, abi: ERC20_METADATA_ABI, functionName: "symbol" }).catch(function unreadable() {
        return null;
      }),
      client.readContract({ address, abi: ERC20_METADATA_ABI, functionName: "decimals" }).catch(function unreadable() {
        return null;
      }),
    ]);
    // A missing symbol or decimals is a failed RPC round trip on the public
    // endpoint, not a silent contract: the first sync stored six such partial
    // answers and every one read as a mismatch. Leave the row unread so the next
    // sync asks again; only a complete answer is recorded.
    if (typeof symbol !== "string" || typeof decimals !== "number") {
      return;
    }
    await db
      .update(registryAssets)
      .set({
        onchainName: typeof name === "string" ? name : null,
        onchainSymbol: typeof symbol === "string" ? symbol : null,
        onchainDecimals: typeof decimals === "number" ? decimals : null,
        metadataCheckedAt: new Date(),
      })
      .where(eq(registryAssets.id, row.id));
  });
}

// Upserts registry_assets from Robinhood's public stock-token list, mainnet only
// (the endpoint does not list testnet deployments). Never deletes: an asset that
// drops out of the response might just be a paginated or flaky fetch, and a
// watcher already pointed at the address should keep working either way.
export async function syncRegistry(): Promise<{ upserted: number; skipped: number; newListings: number }> {
  const assets = await fetchRobinhoodAssets();
  let upserted = 0;
  // The first sync records the list; later syncs announce what joined it.
  const before = await db.select({ n: sql<number>`count(*)` }).from(registryAssets).where(eq(registryAssets.chainId, RH_MAINNET_ID));
  const announcing = Number(before[0]?.n ?? 0) > 0;
  const newListings: Array<{ id: string; symbol: string; name: string; address: string }> = [];
  let skipped = 0;
  const upsertedIds: string[] = [];

  for (const asset of assets) {
    const deployment = asset.deployments.find(function onMainnet(d): boolean {
      return d.chainId === RH_MAINNET_ID;
    });
    if (!deployment || !isAddress(deployment.contractAddress)) {
      skipped += 1;
      continue;
    }

    const address = deployment.contractAddress.toLowerCase();
    const id = registryId(RH_MAINNET_ID, address);
    const row = {
      id,
      chainId: RH_MAINNET_ID,
      address,
      symbol: asset.tokenSymbol,
      name: asset.tokenName,
      assetType: "stock_token",
      decimals: asset.tokenDecimals,
      status: mapStatus(asset.status),
      source: "robinhood-api",
      sourceUri: ROBINHOOD_ASSETS_ENDPOINT,
      observedAt: new Date(),
      logoUrl: asset.logoUrl ?? null,
      isin: asset.isin ?? null,
      raw: asset,
    };

    const written = await db
      .insert(registryAssets)
      .values(row)
      .onConflictDoUpdate({
        target: registryAssets.id,
        set: {
          symbol: row.symbol,
          name: row.name,
          decimals: row.decimals,
          status: row.status,
          source: row.source,
          sourceUri: row.sourceUri,
          observedAt: row.observedAt,
          logoUrl: row.logoUrl,
          isin: row.isin,
          raw: row.raw,
          // firstSeenAt is deliberately absent: it is written once, by the insert.
        },
      })
      // xmax = 0 is Postgres's own word for "this row was inserted, not updated".
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (announcing && written[0]?.inserted) {
      newListings.push({ id, symbol: row.symbol, name: row.name, address });
    }

    upserted += 1;
    upsertedIds.push(id);
  }

  await verifyOnChain(upsertedIds);
  await readMetadata(upsertedIds);
  await emitEvents(
    newListings.map(function toEvent(listing) {
      return {
        chainId: RH_MAINNET_ID,
        kind: "listing.new" as const,
        assetId: listing.id,
        address: listing.address,
        symbol: listing.symbol,
        detail: { assetType: "stock_token", name: listing.name },
        occurredAt: new Date(),
      };
    }),
  );

  return { upserted, skipped, newListings: newListings.length };
}

// Hand-seeded rows for tokens the stock-token endpoint does not list (it only
// covers stock tokens, not the stablecoin/wrapped-native pair). Every address here
// was read from docs.robinhood.com/chain/contracts or /chain/protocol-contracts and
// confirmed to hold code via eth_getCode before being committed — never invented.
//
// No USDG testnet (46630) row: Robinhood's docs list USDG only for mainnet, and no
// other official page names a testnet USDG address, so it is left out rather than
// guessed. Add it here once a source can be cited.
const SEED_ASSETS: ReadonlyArray<{
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  assetType: string;
  decimals: number;
  sourceUri: string;
}> = [
  {
    chainId: USDG.chainId,
    address: USDG.address,
    symbol: "USDG",
    name: "Global Dollar",
    assetType: "stablecoin",
    decimals: 6,
    sourceUri: "https://docs.robinhood.com/chain/contracts",
  },
  {
    chainId: RH_MAINNET_ID,
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    symbol: "WETH",
    name: "Wrapped Ether",
    assetType: "wrapped_native",
    decimals: 18,
    sourceUri: "https://docs.robinhood.com/chain/contracts",
  },
  {
    chainId: RH_TESTNET_ID,
    address: "0x7943e237c7F95DA44E0301572D358911207852Fa",
    symbol: "WETH",
    name: "Wrapped Ether",
    assetType: "wrapped_native",
    decimals: 18,
    sourceUri: "https://docs.robinhood.com/chain/protocol-contracts",
  },
];

// Idempotent: onConflictDoNothing means a re-run (or a sync that later reaches the
// same address through the live API) never clobbers a hand-verified row.
export async function seedRegistry(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const seed of SEED_ASSETS) {
    const address = seed.address.toLowerCase();
    const result = await db
      .insert(registryAssets)
      .values({
        id: registryId(seed.chainId, address),
        chainId: seed.chainId,
        address,
        symbol: seed.symbol,
        name: seed.name,
        assetType: seed.assetType,
        decimals: seed.decimals,
        status: "active",
        source: "seed",
        sourceUri: seed.sourceUri,
        observedAt: new Date(),
        raw: null,
      })
      .onConflictDoNothing({ target: registryAssets.id })
      .returning({ id: registryAssets.id });
    if (result.length > 0) {
      inserted += 1;
    }
  }
  return { inserted };
}
