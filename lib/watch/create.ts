import { assertWatcherCapacity, lockWatcherCapacity, WatchLimitError } from "@/lib/watch/capacity";
export { WatchLimitError } from "@/lib/watch/capacity";
// Watcher CRUD with caps (docs/MVP.md, ticket 4).
//
// No "server-only", no next/*, no React, no lib/dal: workers/watch.ts imports this
// module directly in a plain `tsx` process, and any of those imports would break
// that build. Route handlers bring their own session check before calling in.

import { randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexTokens, projects, registryAssets, watchers, watcherDeliveries, telegramAccounts, webhookEndpoints } from "@/lib/db/schema";
import type { DeliveryChannel, WatcherKind, WatcherStatus } from "@/lib/watch/types";
import { isAuthorityWatcherKind } from "@/lib/watch/types";
import { RH_MAINNET_ID } from "@/lib/config";
import { ACCESS_CONTROLS_REGISTRY, UNISWAP_V4_POOL_MANAGER } from "@/lib/registry/authority/constants";
import { truncateAddress } from "@/lib/watch/format";
import { readTokenProbe } from "@/lib/watch/token-meta";
import { PAUSED_BY_DISABLE } from "@/lib/watch/webhooks";
import { getHead } from "@/lib/chain/rpc";

export interface CreateWatcherInput {
  // Every kind but registry_event and new_pool names an asset. registry_event
  // watches the issuer's registry contract itself; new_pool watches the chain.
  assetId?: string;
  // Any contract on the chain, given instead of assetId. The registry is a
  // provenance stamp, not an allowlist: a token Robinhood does not list is
  // watchable, and its alerts say what it is.
  address?: string;
  // Create the watcher even though the address did not answer as an ERC-20.
  // Recorded on the row, so a watcher that never fires can be explained.
  watchAnyway?: boolean;
  // Defaults to "0" for the event kinds, which have no amount to compare.
  threshold?: string;
  // Defaults to "large_transfer" — every caller before wallet_activity existed
  // leaves this unset and gets the old behaviour unchanged.
  kind?: WatcherKind;
  // Required, and only meaningful, for kind: "wallet_activity".
  wallet?: string;
  name?: string;
  projectId?: string;
  // An endpoint from lib/watch/webhooks.ts. Given, this watcher delivers a
  // signed POST there instead of a Telegram message.
  webhookId?: string;
  // new_pool only: hear about a new pool only when its token borrows a listed
  // ticker or name.
  lookalikesOnly?: boolean;
  // Set by a caller that needs a deterministic id (the v1 API's Idempotency-Key
  // handling — see app/api/v1/watchers/route.ts). Omitted, a random id is minted
  // as before; every existing caller leaves this unset.
  id?: string;
}

export interface CreatedWatcher {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  kind: WatcherKind;
  chainId: number;
  address: string;
  assetId: string | null;
  threshold: string;
  wallet: string | null;
  delivery: DeliveryChannel;
  webhookId: string | null;
  enabled: boolean;
  status: WatcherStatus;
  createdAt: Date;
}

// Thrown for a missing/inactive asset, or a watcher/project the caller doesn't own.
// One class for all three: every case maps to the same 404 at the route.
export class WatchNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchNotFoundError";
  }
}

export class InvalidThresholdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidThresholdError";
  }
}

export class InvalidDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDeliveryError";
  }
}

export class InvalidWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWalletError";
  }
}

// Human message the route surfaces as-is on a 429.
// The pasted string is not an address at all.
export class InvalidTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTargetError";
  }
}

// The address is well formed and the contract there answered nothing. The
// caller may retry with watchAnyway once the person has been told.
export class UnreadableTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableTokenError";
  }
}


const THRESHOLD_PATTERN = /^\d+(\.\d+)?$/;
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// A non-negative decimal string with no exponent/sign/comma noise — the same
// shape `numeric` will accept, checked here so a bad value fails before it
// reaches SQL. large_transfer additionally requires it to be positive: "alert
// on every transfer" isn't a large-transfer watcher, it's a wallet-activity one
// with threshold "0", so a zero threshold here is a mistake rather than a
// choice.
function assertValidThreshold(threshold: string, kind: WatcherKind): void {
  if (!THRESHOLD_PATTERN.test(threshold)) {
    throw new InvalidThresholdError("Threshold must be a number, e.g. \"1000\" or \"1000.5\".");
  }
  if (kind === "large_transfer" && Number(threshold) <= 0) {
    throw new InvalidThresholdError("Threshold must be a positive number, e.g. \"1000\" or \"1000.5\".");
  }
}

// Stored lowercased so every later comparison (poll.ts, the detail page) can
// compare addresses without re-normalizing them.
function assertValidWallet(wallet: string): string {
  if (!WALLET_PATTERN.test(wallet)) {
    throw new InvalidWalletError("Wallet must be a 0x-prefixed 40-character hex address.");
  }
  return wallet.toLowerCase();
}

function defaultName(kind: WatcherKind, symbol: string, threshold: string, wallet: string | null): string {
  switch (kind) {
    case "wallet_activity":
      return wallet ? `${symbol} activity for ${truncateAddress(wallet)}` : `${symbol} activity`;
    case "listing_event":
      return "Robinhood app changes";
    case "registry_event":
      return "Robinhood Chain registry events";
    case "new_pool":
      return "New pools on Robinhood Chain";
    case "token_event":
      return `${symbol} registry events`;
    default:
      return `${symbol} transfers over ${threshold}`;
  }
}

interface WatchTarget {
  chainId: number;
  address: string;
  assetId: string | null;
  symbol: string;
}

type WatchTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// An endpoint alerts can actually land on: owned by this account and turned on.
// Shared by creating a watcher and re-pointing one, so neither can leave a
// watcher delivering somewhere its alerts would be dropped.
async function assertDeliverableEndpoint(tx: WatchTx, userId: string, webhookId: string): Promise<void> {
  const rows = await tx
    .select({ id: webhookEndpoints.id, enabled: webhookEndpoints.enabled })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, webhookId), eq(webhookEndpoints.userId, userId)))
    .limit(1);
  const endpoint = rows[0];
  if (!endpoint) {
    throw new WatchNotFoundError("Webhook endpoint not found.");
  }
  if (!endpoint.enabled) {
    throw new InvalidDeliveryError("That webhook endpoint is disabled. Enable it, or pick another target.");
  }
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

// A pasted address becomes a target after one question the chain can answer:
// is there an ERC-20 here. Nothing is verified by this — a lookalike answers
// name, symbol and decimals as readily as the token it imitates — but a
// contract that answers none of the three has no amount to compare a threshold
// against, so the person is told before the watcher is made.
async function resolveAddress(tx: WatchTx, kind: WatcherKind, raw: string, watchAnyway: boolean): Promise<WatchTarget> {
  if (!ADDRESS_PATTERN.test(raw)) {
    throw new InvalidTargetError("That is not a contract address. Paste the 0x… address of the token.");
  }
  const address = raw.toLowerCase();
  // A listed address pasted by hand still links its registry row, so the
  // watcher reads as the verified asset everywhere it is shown.
  const listed = await tx.select().from(registryAssets).where(and(eq(registryAssets.chainId, RH_MAINNET_ID), eq(registryAssets.address, address))).limit(1);
  const asset = listed[0];
  if (asset && asset.status === "active") {
    return { chainId: asset.chainId, address: asset.address, assetId: asset.id, symbol: asset.symbol };
  }
  if (isAuthorityWatcherKind(kind)) {
    throw new WatchNotFoundError("Token events come from the registry, so that kind of watcher needs a listed asset.");
  }
  const meta = await readTokenProbe(RH_MAINNET_ID, address);
  const sane = meta.bytecodePresent === true && meta.decimals !== null;
  if (!sane && !watchAnyway) {
    throw new UnreadableTokenError("Could not confirm bytecode and decimals at that address. It may not be an ERC-20, or the chain may be busy.");
  }
  // Provenance for a token nobody has listed: the same row the factory scan
  // writes, marked as having come from a person rather than a pool.
  await tx
    .insert(dexTokens)
    .values({
      id: `${RH_MAINNET_ID}:${address}`,
      chainId: RH_MAINNET_ID,
      address,
      symbol: meta?.symbol ?? null,
      name: meta?.name ?? null,
      decimals: meta?.decimals ?? null,
      source: "user_submitted",
      bytecodePresent: meta.bytecodePresent,
      firstSeenBlock: meta.blockNumber,
      checkedAt: new Date(),
      error: sane ? null : "could not confirm bytecode and decimals",
    })
    .onConflictDoNothing();
  return { chainId: RH_MAINNET_ID, address, assetId: null, symbol: meta?.symbol ?? truncateAddress(address) };
}

// registry_event has no asset row to point at: its address is the issuer's
// AccessControlsRegistry and its chain is mainnet, where that contract lives.
async function resolveTarget(tx: WatchTx, kind: WatcherKind, input: CreateWatcherInput): Promise<WatchTarget> {
  if (kind === "listing_event") {
    return { chainId: RH_MAINNET_ID, address: "", assetId: null, symbol: "Robinhood app" };
  }
  if (kind === "registry_event") {
    return { chainId: RH_MAINNET_ID, address: ACCESS_CONTROLS_REGISTRY.toLowerCase(), assetId: null, symbol: "Registry" };
  }
  // A new-pool watcher has no token at all: the target is every DEX on the
  // chain, and the address it stores is the venue that creates the pools.
  if (kind === "new_pool") {
    return { chainId: RH_MAINNET_ID, address: UNISWAP_V4_POOL_MANAGER.toLowerCase(), assetId: null, symbol: "New pools" };
  }
  if (input.address) {
    return resolveAddress(tx, kind, input.address, input.watchAnyway === true);
  }
  if (!input.assetId) {
    throw new WatchNotFoundError("Name an asset or paste a contract address.");
  }
  const assetRows = await tx.select().from(registryAssets).where(eq(registryAssets.id, input.assetId)).limit(1);
  const asset = assetRows[0];
  if (!asset || asset.status !== "active") {
    throw new WatchNotFoundError("That asset isn't in the registry.");
  }
  return { chainId: asset.chainId, address: asset.address, assetId: asset.id, symbol: asset.symbol };
}

// Shared by every mutation below so the row-to-API shape lives in one place.
// `fallbackAssetId` covers rows written before assetId was backfilled, where
// the column can still be null; each caller supplies what it knows to fill
// that gap.
function toCreatedWatcher(row: typeof watchers.$inferSelect, fallbackAssetId: string | null): CreatedWatcher {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    name: row.name,
    kind: row.kind,
    chainId: row.chainId,
    address: row.address,
    assetId: row.assetId ?? fallbackAssetId,

    threshold: row.threshold,
    wallet: row.wallet,
    delivery: row.delivery,
    webhookId: row.webhookId,
    enabled: row.enabled,
    status: row.status,
    createdAt: row.createdAt,
  };
}

// Resolves the target from the registry and enforces both caps inside one
// transaction, so two concurrent requests can't both slip past a limit that a
// plain count-then-insert would let through.
export async function createWatcher(userId: string, input: CreateWatcherInput): Promise<CreatedWatcher> {
  const kind: WatcherKind = input.kind ?? "large_transfer";
  const threshold = input.threshold ?? (isAuthorityWatcherKind(kind) || kind === "new_pool" ? "0" : "");
  assertValidThreshold(threshold, kind);
  let wallet: string | null = null;
  if (kind === "wallet_activity") {
    if (!input.wallet) {
      throw new InvalidWalletError("Wallet activity watchers need a wallet address.");
    }
    wallet = assertValidWallet(input.wallet);
  }
  const poolStart = kind === "new_pool" ? await getHead(RH_MAINNET_ID) : null;

  return db.transaction(async function run(tx): Promise<CreatedWatcher> {
    const target = await resolveTarget(tx, kind, input);
    const delivery: DeliveryChannel = input.webhookId ? "webhook" : "telegram";
    if (input.webhookId) {
      await assertDeliverableEndpoint(tx, userId, input.webhookId);
    }

    if (input.projectId) {
      const projectRows = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.userId, userId)))
        .limit(1);
      if (!projectRows[0]) {
        throw new WatchNotFoundError("Project not found.");
      }
    }

    await lockWatcherCapacity(tx);
    await assertWatcherCapacity(tx, userId, [kind]);
    const userCountRows = await tx
      .select({ value: count() })
      .from(watchers)
      .where(and(eq(watchers.userId, userId), eq(watchers.enabled, true)));
    // A wallet is free to mint; a Telegram account is not. One watcher is allowed
    // before linking so the first run can be tried; more need a place to deliver.
    const enabledCount = userCountRows[0]?.value ?? 0;
    if (enabledCount >= 1 && delivery === "telegram") {
      const linked = await tx
        .select({ userId: telegramAccounts.userId })
        .from(telegramAccounts)
        .where(eq(telegramAccounts.userId, userId))
        .limit(1);
      if (!linked[0]) {
        throw new WatchLimitError("Link Telegram in Settings, or add a webhook endpoint, to add more watchers.");
      }
    }
    const id = input.id ?? `wt_${randomUUID()}`;
    const name = input.name?.trim() || defaultName(kind, target.symbol, threshold, wallet);
    const inserted = await tx
      .insert(watchers)
      .values({
        id,
        userId,
        projectId: input.projectId ?? null,
        name,
        kind,
        chainId: target.chainId,
        address: target.address,
        assetId: target.assetId,
        threshold,
        wallet,
        delivery,
        webhookId: input.webhookId ?? null,
        enabled: true,
        unverifiedAck: input.watchAnyway === true && target.assetId === null,
        lookalikesOnly: kind === "new_pool" && input.lookalikesOnly === true,
        status: "catching_up",
        lastCheckedBlock: poolStart?.number ?? null,
        lastCheckedBlockHash: poolStart?.hash ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("Failed to create watcher");
    }

    return toCreatedWatcher(row, target.assetId);
  });
}

export interface WatcherPatch {
  enabled?: boolean;
  webhookId?: string | null;
}

// Keep the checkpoint. A combined channel change and resume either both commit
// or both roll back, including when the account has reached its watcher limit.
export async function updateWatcher(userId: string, id: string, patch: WatcherPatch): Promise<CreatedWatcher> {
  return db.transaction(async function run(tx): Promise<CreatedWatcher> {
    await lockWatcherCapacity(tx);
    const [current] = await tx.select().from(watchers).where(and(eq(watchers.id, id), eq(watchers.userId, userId))).limit(1).for("update");
    if (!current) throw new WatchNotFoundError("Watcher not found.");
    const changes: Partial<typeof watchers.$inferInsert> = { updatedAt: new Date() };
    let delivery = current.delivery;
    let webhookId = current.webhookId;
    if (patch.webhookId !== undefined) {
      if (patch.webhookId) await assertDeliverableEndpoint(tx, userId, patch.webhookId);
      webhookId = patch.webhookId;
      delivery = webhookId ? "webhook" : "telegram";
      changes.webhookId = webhookId;
      changes.delivery = delivery;
      if (current.lastError === PAUSED_BY_DISABLE) changes.lastError = null;
    }
    if (patch.enabled !== undefined) {
      if (patch.enabled && delivery === "webhook" && webhookId === null) {
        throw new InvalidDeliveryError("This watcher's webhook endpoint was deleted. Choose another notification channel before resuming.");
      }
      if (patch.enabled && delivery === "webhook" && webhookId) await assertDeliverableEndpoint(tx, userId, webhookId);
      if (patch.enabled && !current.enabled) await assertWatcherCapacity(tx, userId, [current.kind as WatcherKind]);
      changes.enabled = patch.enabled;
      changes.status = patch.enabled ? "catching_up" : "paused";
      changes.lastError = null;
    }
    const [updated] = await tx.update(watchers).set(changes).where(and(eq(watchers.id, id), eq(watchers.userId, userId))).returning();
    if (!updated) throw new WatchNotFoundError("Watcher not found.");
    if (patch.webhookId && patch.webhookId !== current.webhookId) {
      await tx.update(watcherDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: sql`now()`, lastError: null })
        .where(and(eq(watcherDeliveries.watcherId, id), eq(watcherDeliveries.status, "held"), gt(watcherDeliveries.createdAt, sql`now() - interval '24 hours'`)));
    }
    return toCreatedWatcher(updated, null);
  });
}

export async function setWatcherEnabled(userId: string, id: string, enabled: boolean): Promise<CreatedWatcher> {
  return updateWatcher(userId, id, { enabled });
}

export async function updateWatcherDelivery(userId: string, id: string, webhookId: string | null): Promise<CreatedWatcher> {
  return updateWatcher(userId, id, { webhookId });
}

export async function deleteWatcher(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(watchers)
    .where(and(eq(watchers.id, id), eq(watchers.userId, userId)))
    .returning({ id: watchers.id });
  if (!deleted[0]) {
    throw new WatchNotFoundError("Watcher not found.");
  }
}
