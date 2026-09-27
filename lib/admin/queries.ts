import "server-only";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  abuseSignals,
  apiKeys,
  auditLog,
  builds,
  contracts,
  creditEvents,
  projects,
  rateCounters,
  registryAssets,
  telegramAccounts,
  user,
  walletAddress,
  watcherDeliveries,
  watchers,
  authorityEvents,
  bridgeFlows,
  dexPools,
  dexTokens,
  feedRounds,
  holderBalances,
  issuerDocuments,
} from "@/lib/db/schema";
import { RUNNING_BUILD_STATUSES, type BuildStatus } from "@/lib/build/status";
import { readBuildCapacity } from "@/lib/build/capacity";
import { readHeartbeat, type HeartbeatRow } from "@/lib/watch/heartbeat";
import { usingPublicRpc } from "@/lib/chain/rpc";
import { telegramConfigured } from "@/lib/telegram/client";
import { platformProvider } from "@/lib/agent/provider";
import { sandboxImage } from "@/lib/agent/sandbox";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";
import { WATCH_LIMITS, type DeliveryStatus, type WatcherKind, type WatcherStatus } from "@/lib/watch/types";
import type { BuildEvent } from "@/lib/build/types";
import { directoryBytes, workspaceRoot } from "@/lib/build/workspace";

// Every read the admin console makes. Nothing here mutates; the actions live in
// lib/admin/actions.ts. Postgres returns count()/sum() as strings, so every
// aggregate passes through `n()`.

function n(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

const DAY_MS = 86_400_000;

function since(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface PlatformCounts {
  users: number;
  signups24h: number;
  signups7d: number;
  buildsTotal: number;
  builds24h: number;
  builds7d: number;
  buildsSucceeded7d: number;
  buildsFailed7d: number;
  buildsRunning: number;
  creditsGranted: number;
  creditsSpent: number;
  creditsRefunded: number;
  purchases: number;
  creditsPurchased: number;
  projects: number;
  contracts: number;
  watchersTotal: number;
  watchersEnabled: number;
  watchersDegraded: number;
  deliveries24h: number;
  deliveriesFailed24h: number;
  deliveriesPending: number;
  apiKeysActive: number;
  telegramLinked: number;
}

export async function platformCounts(): Promise<PlatformCounts> {
  const [users, buildRows, creditRows, projectRows, contractRows, watcherRows, deliveryRows, keyRows, telegramRows] =
    await Promise.all([
      db
        .select({
          total: sql<string>`count(*)`,
          d1: sql<string>`count(*) filter (where ${user.createdAt} > now() - interval '24 hours')`,
          d7: sql<string>`count(*) filter (where ${user.createdAt} > now() - interval '7 days')`,
        })
        .from(user),
      db
        .select({
          total: sql<string>`count(*)`,
          d1: sql<string>`count(*) filter (where ${builds.createdAt} > now() - interval '24 hours')`,
          d7: sql<string>`count(*) filter (where ${builds.createdAt} > now() - interval '7 days')`,
          ok7: sql<string>`count(*) filter (where ${builds.status} = 'succeeded' and ${builds.createdAt} > now() - interval '7 days')`,
          bad7: sql<string>`count(*) filter (where ${builds.status} in ('failed', 'killed') and ${builds.createdAt} > now() - interval '7 days')`,
          running: sql<string>`count(*) filter (where ${builds.status} in ('queued', 'provisioning', 'building', 'compiling'))`,
        })
        .from(builds),
      db
        .select({
          granted: sql<string>`coalesce(sum(${creditEvents.delta}) filter (where ${creditEvents.reason} in ('free_grant', 'holder_grant', 'purchase', 'admin_adjust') and ${creditEvents.delta} > 0), 0)`,
          spent: sql<string>`coalesce(-sum(${creditEvents.delta}) filter (where ${creditEvents.reason} = 'build_debit'), 0)`,
          refunded: sql<string>`coalesce(sum(${creditEvents.delta}) filter (where ${creditEvents.reason} = 'refund'), 0)`,
          purchases: sql<string>`count(*) filter (where ${creditEvents.reason} = 'purchase')`,
          purchased: sql<string>`coalesce(sum(${creditEvents.delta}) filter (where ${creditEvents.reason} = 'purchase'), 0)`,
        })
        .from(creditEvents),
      db.select({ total: sql<string>`count(*)` }).from(projects),
      db.select({ total: sql<string>`count(*)` }).from(contracts),
      db
        .select({
          total: sql<string>`count(*)`,
          enabled: sql<string>`count(*) filter (where ${watchers.enabled})`,
          degraded: sql<string>`count(*) filter (where ${watchers.enabled} and ${watchers.status} = 'degraded')`,
        })
        .from(watchers),
      db
        .select({
          d1: sql<string>`count(*) filter (where ${watcherDeliveries.createdAt} > now() - interval '24 hours')`,
          failed1: sql<string>`count(*) filter (where ${watcherDeliveries.status} = 'failed' and ${watcherDeliveries.createdAt} > now() - interval '24 hours')`,
          pending: sql<string>`count(*) filter (where ${watcherDeliveries.status} = 'pending')`,
        })
        .from(watcherDeliveries),
      db.select({ active: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null)` }).from(apiKeys),
      db.select({ total: sql<string>`count(*)` }).from(telegramAccounts),
    ]);

  return {
    users: n(users[0]?.total),
    signups24h: n(users[0]?.d1),
    signups7d: n(users[0]?.d7),
    buildsTotal: n(buildRows[0]?.total),
    builds24h: n(buildRows[0]?.d1),
    builds7d: n(buildRows[0]?.d7),
    buildsSucceeded7d: n(buildRows[0]?.ok7),
    buildsFailed7d: n(buildRows[0]?.bad7),
    buildsRunning: n(buildRows[0]?.running),
    creditsGranted: n(creditRows[0]?.granted),
    creditsSpent: n(creditRows[0]?.spent),
    creditsRefunded: n(creditRows[0]?.refunded),
    purchases: n(creditRows[0]?.purchases),
    creditsPurchased: n(creditRows[0]?.purchased),
    projects: n(projectRows[0]?.total),
    contracts: n(contractRows[0]?.total),
    watchersTotal: n(watcherRows[0]?.total),
    watchersEnabled: n(watcherRows[0]?.enabled),
    watchersDegraded: n(watcherRows[0]?.degraded),
    deliveries24h: n(deliveryRows[0]?.d1),
    deliveriesFailed24h: n(deliveryRows[0]?.failed1),
    deliveriesPending: n(deliveryRows[0]?.pending),
    apiKeysActive: n(keyRows[0]?.active),
    telegramLinked: n(telegramRows[0]?.total),
  };
}

export interface DayPoint {
  day: string;
  total: number;
  ok: number;
  bad: number;
}

// One point per calendar day for the last `days`, zero-filled, so a sparkline
// shows a flat line for a quiet day instead of skipping it.
function fillDays(days: number, rows: { day: string; total: string; ok: string; bad: string }[]): DayPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const points: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = since(i).toISOString().slice(0, 10);
    const row = byDay.get(day);
    points.push({ day, total: n(row?.total), ok: n(row?.ok), bad: n(row?.bad) });
  }
  return points;
}

export async function buildsPerDay(days = 14): Promise<DayPoint[]> {
  const result = await db.execute<{ day: string; total: string; ok: string; bad: string }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
           count(*) AS total,
           count(*) FILTER (WHERE status = 'succeeded') AS ok,
           count(*) FILTER (WHERE status IN ('failed', 'killed')) AS bad
    FROM builds
    WHERE created_at > now() - (${days} * interval '1 day')
    GROUP BY 1
  `);
  return fillDays(days, result.rows);
}

export async function deliveriesPerDay(days = 14): Promise<DayPoint[]> {
  const result = await db.execute<{ day: string; total: string; ok: string; bad: string }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
           count(*) AS total,
           count(*) FILTER (WHERE status = 'sent') AS ok,
           count(*) FILTER (WHERE status = 'failed') AS bad
    FROM watcher_deliveries
    WHERE created_at > now() - (${days} * interval '1 day')
    GROUP BY 1
  `);
  return fillDays(days, result.rows);
}

export async function signupsPerDay(days = 14): Promise<DayPoint[]> {
  const result = await db.execute<{ day: string; total: string; ok: string; bad: string }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day, count(*) AS total, 0 AS ok, 0 AS bad
    FROM "user"
    WHERE created_at > now() - (${days} * interval '1 day')
    GROUP BY 1
  `);
  return fillDays(days, result.rows);
}

// ── Users ───────────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  banned: boolean;
  createdAt: Date;
  wallet: string | null;
  credits: number;
  buildCount: number;
  projectCount: number;
  watcherCount: number;
  telegramLinked: boolean;
  lastBuildAt: Date | null;
}

const USER_COLUMNS = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  banned: user.banned,
  createdAt: user.createdAt,
  wallet: sql<string | null>`(select min(address) from wallet_address w where w.user_id = ${user.id})`,
  credits: sql<string>`coalesce((select sum(delta) from credit_events ce where ce.user_id = ${user.id}), 0)`,
  buildCount: sql<string>`(select count(*) from builds b where b.user_id = ${user.id})`,
  projectCount: sql<string>`(select count(*) from projects p where p.user_id = ${user.id})`,
  watcherCount: sql<string>`(select count(*) from watchers w where w.user_id = ${user.id})`,
  telegramLinked: sql<boolean>`exists (select 1 from telegram_accounts t where t.user_id = ${user.id})`,
  lastBuildAt: sql<Date | null>`(select max(created_at) from builds b where b.user_id = ${user.id})`,
};

function toUserRow(row: {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  banned: boolean | null;
  createdAt: Date;
  wallet: string | null;
  credits: string;
  buildCount: string;
  projectCount: string;
  watcherCount: string;
  telegramLinked: boolean;
  lastBuildAt: Date | null;
}): AdminUserRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: row.banned ?? false,
    createdAt: row.createdAt,
    wallet: row.wallet,
    credits: n(row.credits),
    buildCount: n(row.buildCount),
    projectCount: n(row.projectCount),
    watcherCount: n(row.watcherCount),
    telegramLinked: row.telegramLinked,
    lastBuildAt: row.lastBuildAt ? new Date(row.lastBuildAt) : null,
  };
}

export async function listUsers(query: string, limit = 100): Promise<AdminUserRow[]> {
  const trimmed = query.trim();
  const rows = await db
    .select(USER_COLUMNS)
    .from(user)
    .where(
      trimmed
        ? or(
            ilike(user.name, `%${trimmed}%`),
            ilike(user.email, `%${trimmed}%`),
            eq(user.id, trimmed),
            sql`exists (select 1 from wallet_address w where w.user_id = ${user.id} and w.address ilike ${`%${trimmed}%`})`,
          )
        : undefined,
    )
    .orderBy(desc(user.createdAt))
    .limit(limit);
  return rows.map(toUserRow);
}

export interface AdminUserDetail {
  user: AdminUserRow;
  wallets: { address: string; chainId: number; createdAt: Date }[];
  ledger: (typeof creditEvents.$inferSelect)[];
  builds: AdminBuildRow[];
  watchers: AdminWatcherRow[];
  keys: { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }[];
  telegram: { username: string | null; linkedAt: Date } | null;
  abuse: (typeof abuseSignals.$inferSelect)[];
  audit: AdminAuditRow[];
}

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  const rows = await db.select(USER_COLUMNS).from(user).where(eq(user.id, id)).limit(1);
  const found = rows[0];
  if (!found) {
    return null;
  }
  const detail = toUserRow(found);
  const [wallets, ledger, userBuilds, userWatchers, keys, telegram, audit] = await Promise.all([
    db
      .select({ address: walletAddress.address, chainId: walletAddress.chainId, createdAt: walletAddress.createdAt })
      .from(walletAddress)
      .where(eq(walletAddress.userId, id)),
    db.select().from(creditEvents).where(eq(creditEvents.userId, id)).orderBy(desc(creditEvents.createdAt)).limit(50),
    listBuilds({ userId: id, limit: 50 }),
    listWatchers({ userId: id }),
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, id))
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select({ username: telegramAccounts.username, linkedAt: telegramAccounts.linkedAt })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, id))
      .limit(1),
    listAudit({ userId: id, limit: 50 }),
  ]);
  const walletList = wallets.map((row) => row.address.toLowerCase());
  const abuse = await db
    .select()
    .from(abuseSignals)
    .where(
      walletList.length > 0
        ? or(eq(abuseSignals.userId, id), inArray(abuseSignals.wallet, walletList))
        : eq(abuseSignals.userId, id),
    )
    .orderBy(desc(abuseSignals.createdAt))
    .limit(20);
  return {
    user: detail,
    wallets,
    ledger,
    builds: userBuilds,
    watchers: userWatchers,
    keys: keys.map((key) => ({ ...key, scopes: Array.isArray(key.scopes) ? (key.scopes as string[]) : [] })),
    telegram: telegram[0] ?? null,
    abuse,
    audit,
  };
}

// ── Builds ──────────────────────────────────────────────────────────────────

export interface BuildNeeds {
  needsContract: boolean | null;
  needsWallet: boolean | null;
  needsReason: string | null;
  needsSource: string | null;
  needsOverridden: boolean;
}

export interface AdminBuildRow extends BuildNeeds {
  id: string;
  userId: string;
  userName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  prompt: string;
  provider: string;
  model: string | null;
  status: BuildStatus;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationSeconds: number | null;
}

export interface ListBuildsOptions {
  status?: BuildStatus | "running" | "all";
  userId?: string;
  limit?: number;
}

function durationSeconds(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt) {
    return null;
  }
  const end = finishedAt ?? new Date();
  return Math.round((end.getTime() - startedAt.getTime()) / 1000);
}

function buildStatusFilter(status: ListBuildsOptions["status"]) {
  if (!status || status === "all") {
    return undefined;
  }
  if (status === "running") {
    return inArray(builds.status, RUNNING_BUILD_STATUSES);
  }
  return eq(builds.status, status);
}

export async function listBuilds(options: ListBuildsOptions = {}): Promise<AdminBuildRow[]> {
  const filters = [buildStatusFilter(options.status), options.userId ? eq(builds.userId, options.userId) : undefined].filter(
    Boolean,
  );
  const rows = await db
    .select({
      id: builds.id,
      userId: builds.userId,
      userName: user.name,
      projectId: builds.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      prompt: builds.prompt,
      provider: builds.provider,
      model: builds.model,
      status: builds.status,
      error: builds.error,
      createdAt: builds.createdAt,
      startedAt: builds.startedAt,
      finishedAt: builds.finishedAt,
      needsContract: builds.needsContract,
      needsWallet: builds.needsWallet,
      needsReason: builds.needsReason,
      needsSource: builds.needsSource,
      needsOverridden: builds.needsOverridden,
    })
    .from(builds)
    .leftJoin(user, eq(builds.userId, user.id))
    .leftJoin(projects, eq(builds.projectId, projects.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(builds.createdAt))
    .limit(options.limit ?? 100);
  return rows.map((row) => ({ ...row, durationSeconds: durationSeconds(row.startedAt, row.finishedAt) }));
}

export interface AdminBuildDetail {
  build: AdminBuildRow;
  events: BuildEvent[];
  contracts: (typeof contracts.$inferSelect)[];
  credits: (typeof creditEvents.$inferSelect)[];
}

export async function getBuildDetail(id: string): Promise<AdminBuildDetail | null> {
  const found = await db
    .select({
      id: builds.id,
      userId: builds.userId,
      userName: user.name,
      projectId: builds.projectId,
      projectName: projects.name,
      projectSlug: projects.slug,
      prompt: builds.prompt,
      provider: builds.provider,
      model: builds.model,
      status: builds.status,
      error: builds.error,
      createdAt: builds.createdAt,
      startedAt: builds.startedAt,
      finishedAt: builds.finishedAt,
      needsContract: builds.needsContract,
      needsWallet: builds.needsWallet,
      needsReason: builds.needsReason,
      needsSource: builds.needsSource,
      needsOverridden: builds.needsOverridden,
    })
    .from(builds)
    .leftJoin(user, eq(builds.userId, user.id))
    .leftJoin(projects, eq(builds.projectId, projects.id))
    .where(eq(builds.id, id))
    .limit(1);
  const row = found[0];
  if (!row) {
    return null;
  }
  const [logRows, contractRows, creditRows] = await Promise.all([
    db.execute<{ chunk: string | null }>(sql`SELECT chunk FROM build_logs WHERE build_id = ${id} ORDER BY seq ASC`),
    db.select().from(contracts).where(eq(contracts.buildId, id)),
    db.select().from(creditEvents).where(eq(creditEvents.buildId, id)).orderBy(desc(creditEvents.createdAt)),
  ]);
  const events: BuildEvent[] = [];
  for (const log of logRows.rows) {
    if (!log.chunk) {
      continue;
    }
    try {
      events.push(JSON.parse(log.chunk) as BuildEvent);
    } catch {
      // A truncated chunk is still worth showing the rest of the log for.
    }
  }
  return {
    build: { ...row, durationSeconds: durationSeconds(row.startedAt, row.finishedAt) },
    events,
    contracts: contractRows,
    credits: creditRows,
  };
}

// ── Watchers and deliveries ─────────────────────────────────────────────────

export interface AdminWatcherRow {
  id: string;
  userId: string;
  userName: string | null;
  name: string;
  kind: WatcherKind;
  chainId: number;
  address: string;
  symbol: string | null;
  threshold: string;
  wallet: string | null;
  enabled: boolean;
  status: WatcherStatus;
  lastCheckedBlock: string | null;
  lastTriggeredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  deliveries: number;
  failedDeliveries: number;
}

export interface ListWatchersOptions {
  status?: WatcherStatus | "all";
  userId?: string;
}

export async function listWatchers(options: ListWatchersOptions = {}): Promise<AdminWatcherRow[]> {
  const filters = [
    options.status && options.status !== "all" ? eq(watchers.status, options.status) : undefined,
    options.userId ? eq(watchers.userId, options.userId) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({
      id: watchers.id,
      userId: watchers.userId,
      userName: user.name,
      name: watchers.name,
      kind: watchers.kind,
      chainId: watchers.chainId,
      address: watchers.address,
      symbol: registryAssets.symbol,
      threshold: watchers.threshold,
      wallet: watchers.wallet,
      enabled: watchers.enabled,
      status: watchers.status,
      lastCheckedBlock: watchers.lastCheckedBlock,
      lastTriggeredAt: watchers.lastTriggeredAt,
      lastError: watchers.lastError,
      createdAt: watchers.createdAt,
      deliveries: sql<string>`(select count(*) from watcher_deliveries d where d.watcher_id = ${watchers.id})`,
      failedDeliveries: sql<string>`(select count(*) from watcher_deliveries d where d.watcher_id = ${watchers.id} and d.status = 'failed')`,
    })
    .from(watchers)
    .leftJoin(user, eq(watchers.userId, user.id))
    .leftJoin(registryAssets, eq(watchers.assetId, registryAssets.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(watchers.createdAt))
    .limit(200);
  return rows.map((row) => ({
    ...row,
    lastCheckedBlock: row.lastCheckedBlock === null ? null : row.lastCheckedBlock.toString(),
    deliveries: n(row.deliveries),
    failedDeliveries: n(row.failedDeliveries),
  }));
}

export interface AdminDeliveryRow {
  id: string;
  watcherId: string;
  watcherName: string | null;
  userId: string;
  userName: string | null;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  txHash: string;
  symbol: string | null;
  amount: string | null;
  explorerUrl: string | null;
}

export async function listDeliveries(status: DeliveryStatus | "all", limit = 100): Promise<AdminDeliveryRow[]> {
  const rows = await db
    .select({
      id: watcherDeliveries.id,
      watcherId: watcherDeliveries.watcherId,
      watcherName: watchers.name,
      userId: watcherDeliveries.userId,
      userName: user.name,
      status: watcherDeliveries.status,
      attempts: watcherDeliveries.attempts,
      nextAttemptAt: watcherDeliveries.nextAttemptAt,
      lastError: watcherDeliveries.lastError,
      createdAt: watcherDeliveries.createdAt,
      sentAt: watcherDeliveries.sentAt,
      txHash: watcherDeliveries.txHash,
      symbol: sql<string | null>`${watcherDeliveries.payload} ->> 'symbol'`,
      amount: sql<string | null>`${watcherDeliveries.payload} ->> 'amount'`,
      explorerUrl: sql<string | null>`${watcherDeliveries.payload} ->> 'explorerUrl'`,
    })
    .from(watcherDeliveries)
    .leftJoin(watchers, eq(watcherDeliveries.watcherId, watchers.id))
    .leftJoin(user, eq(watcherDeliveries.userId, user.id))
    .where(status === "all" ? undefined : eq(watcherDeliveries.status, status))
    .orderBy(desc(watcherDeliveries.createdAt))
    .limit(limit);
  return rows;
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AdminAuditRow {
  id: string;
  userId: string | null;
  userName: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface ListAuditOptions {
  userId?: string;
  action?: string;
  limit?: number;
}

export async function listAudit(options: ListAuditOptions = {}): Promise<AdminAuditRow[]> {
  const filters = [
    options.userId ? eq(auditLog.userId, options.userId) : undefined,
    options.action ? ilike(auditLog.action, `${options.action}%`) : undefined,
  ].filter(Boolean);
  return db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: user.name,
      actorType: auditLog.actorType,
      actorId: auditLog.actorId,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(options.limit ?? 100);
}

// ── Registry ────────────────────────────────────────────────────────────────

export interface RegistrySummary {
  total: number;
  verified: number;
  active: number;
  byType: { assetType: string; count: number }[];
  lastObservedAt: Date | null;
  lastVerifiedAt: Date | null;
}

export async function registrySummary(): Promise<RegistrySummary> {
  const [totals, types] = await Promise.all([
    db
      .select({
        total: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${registryAssets.verifiedAt} is not null)`,
        active: sql<string>`count(*) filter (where ${registryAssets.status} = 'active')`,
        lastObservedAt: sql<Date | null>`max(${registryAssets.observedAt})`,
        lastVerifiedAt: sql<Date | null>`max(${registryAssets.verifiedAt})`,
      })
      .from(registryAssets)
      .where(eq(registryAssets.chainId, RH_MAINNET_ID)),
    db
      .select({ assetType: registryAssets.assetType, count: sql<string>`count(*)` })
      .from(registryAssets)
      .where(eq(registryAssets.chainId, RH_MAINNET_ID))
      .groupBy(registryAssets.assetType),
  ]);
  const row = totals[0];
  return {
    total: n(row?.total),
    verified: n(row?.verified),
    active: n(row?.active),
    byType: types.map((t) => ({ assetType: t.assetType, count: n(t.count) })),
    lastObservedAt: row?.lastObservedAt ? new Date(row.lastObservedAt) : null,
    lastVerifiedAt: row?.lastVerifiedAt ? new Date(row.lastVerifiedAt) : null,
  };
}

export async function listRegistry(query: string): Promise<(typeof registryAssets.$inferSelect)[]> {
  const trimmed = query.trim();
  return db
    .select()
    .from(registryAssets)
    .where(
      trimmed
        ? and(
            eq(registryAssets.chainId, RH_MAINNET_ID),
            or(ilike(registryAssets.symbol, `%${trimmed}%`), ilike(registryAssets.name, `%${trimmed}%`), ilike(registryAssets.address, `%${trimmed}%`)),
          )
        : eq(registryAssets.chainId, RH_MAINNET_ID),
    )
    .orderBy(registryAssets.symbol)
    .limit(300);
}

// ── System ──────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  root: string;
  directories: number;
  bytes: number;
  oldestMtime: Date | null;
}

async function workspaceInfo(): Promise<WorkspaceInfo> {
  const root = workspaceRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(function missing() {
    return [];
  });
  let bytes = 0;
  let oldest: number | null = null;
  let directories = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    directories += 1;
    const info = await stat(join(root, entry.name));
    oldest = oldest === null ? info.mtimeMs : Math.min(oldest, info.mtimeMs);
    bytes += await directoryBytes(join(root, entry.name));
  }
  return { root, directories, bytes, oldestMtime: oldest === null ? null : new Date(oldest) };
}

export interface SystemStatus {
  heartbeat: HeartbeatRow | null;
  rpc: { chainId: number; configured: boolean }[];
  telegramConfigured: boolean;
  provider: { model: string; baseUrl: string } | null;
  sandbox: {
    image: string | null;
    agent: string;
    memory: string;
    cpus: string;
    maxConcurrent: number;
    repairRounds: number;
    timeoutMs: number;
  };
  limits: {
    buildsPerUserHour: number;
    buildsPerIpHour: number;
    buildsGlobalDay: number;
    watchersPerUser: number;
    watchersPlatform: number;
    rpcCallsPerDay: number;
  };
  counters: { bucket: string; count: number; windowStart: Date }[];
  workspaces: WorkspaceInfo;
  env: { name: string; set: boolean }[];
}

// Environment variables the console reports as present or missing. Values are
// never read into the page; only whether the operator has set them.
const REPORTED_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "MOONSHOT_API_KEY",
  "FORGE_AGENT_IMAGE",
  "FORGE_WORKSPACE_ROOT",
  "INTERNAL_CRON_SECRET",
  "RPC_URL_4663",
  "RPC_URL_46630",
  "RPC_URL_1",
  "RPC_URL_1_ARCHIVE",
  "CHAINLINK_STREAMS_URL",
  "CHAINLINK_STREAMS_ID",
  "CHAINLINK_STREAMS_SECRET",
  "ADMIN_PASSWORD_HASH",
  "FORGE_MAINNET_DEPLOYS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "FLETCH_TREASURY_ADDRESS",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
  "ADMIN_WALLETS",
];

export async function systemStatus(): Promise<SystemStatus> {
  const provider = platformProvider();
  const [heartbeat, counters, workspaces] = await Promise.all([
    readHeartbeat(),
    db
      .select({ bucket: rateCounters.bucket, count: rateCounters.count, windowStart: rateCounters.windowStart })
      .from(rateCounters)
      .where(gte(rateCounters.windowStart, since(1)))
      .orderBy(desc(rateCounters.count))
      .limit(40),
    workspaceInfo(),
  ]);
  return {
    heartbeat,
    rpc: [RH_MAINNET_ID, RH_TESTNET_ID].map((chainId) => ({ chainId, configured: !usingPublicRpc(chainId) })),
    telegramConfigured: telegramConfigured(),
    provider: provider ? { model: provider.model, baseUrl: provider.baseUrl } : null,
    sandbox: {
      image: sandboxImage(),
      agent: process.env.FORGE_AGENT ?? "single-call",
      memory: process.env.FORGE_AGENT_MEMORY ?? "2g",
      cpus: process.env.FORGE_AGENT_CPUS ?? "2",
      maxConcurrent: await readBuildCapacity(),
      repairRounds: Number(process.env.FORGE_AGENT_REPAIR_ROUNDS ?? 1),
      timeoutMs: Number(process.env.FORGE_AGENT_TIMEOUT_MS ?? 600_000),
    },
    limits: {
      buildsPerUserHour: Number(process.env.FORGE_BUILDS_PER_USER_HOUR ?? 10),
      buildsPerIpHour: Number(process.env.FORGE_BUILDS_PER_IP_HOUR ?? 20),
      buildsGlobalDay: Number(process.env.FORGE_BUILDS_GLOBAL_DAY ?? 500),
      watchersPerUser: WATCH_LIMITS.watchersPerUser,
      watchersPlatform: WATCH_LIMITS.watchersPlatform,
      rpcCallsPerDay: WATCH_LIMITS.rpcCallsPerDay,
    },
    counters,
    workspaces,
    env: REPORTED_ENV.map((name) => ({ name, set: Boolean(process.env[name]) })),
  };
}

export interface AuthorityCounts {
  dexPools: number;
  dexPriced: number;
  bridgeFlows: number;
  bridgeFlows24h: number;
  issuerDocuments: number;
  feedRounds: number;
  holderBalances: number;
  eventsToday: number;
  eventsUnmatched: number;
}

// Row counts behind the authority tables, for the admin registry page. The
// public status page judges freshness; this says how much has been read.
export async function authorityCounts(): Promise<AuthorityCounts> {
  const dayAgo = since(1);
  const [pools, priced, flows, flows24h, documents, rounds, balances, eventsToday, unmatched] = await Promise.all([
    db.select({ n: count() }).from(dexPools),
    db.select({ n: count() }).from(dexPools).where(isNotNull(dexPools.priceUsd)),
    db.select({ n: count() }).from(bridgeFlows),
    db.select({ n: count() }).from(bridgeFlows).where(gte(bridgeFlows.occurredAt, dayAgo)),
    db.select({ n: count() }).from(issuerDocuments).where(isNull(issuerDocuments.goneAt)),
    db.select({ n: count() }).from(feedRounds),
    db.select({ n: count() }).from(holderBalances).where(sql`${holderBalances.rawBalance} > 0`),
    db.select({ n: count() }).from(authorityEvents).where(gte(authorityEvents.observedAt, dayAgo)),
    db.select({ n: count() }).from(authorityEvents).where(isNull(authorityEvents.matchedAt)),
  ]);
  return {
    dexPools: Number(pools[0]?.n ?? 0),
    dexPriced: Number(priced[0]?.n ?? 0),
    bridgeFlows: Number(flows[0]?.n ?? 0),
    bridgeFlows24h: Number(flows24h[0]?.n ?? 0),
    issuerDocuments: Number(documents[0]?.n ?? 0),
    feedRounds: Number(rounds[0]?.n ?? 0),
    holderBalances: Number(balances[0]?.n ?? 0),
    eventsToday: Number(eventsToday[0]?.n ?? 0),
    eventsUnmatched: Number(unmatched[0]?.n ?? 0),
  };
}


export interface DiscoveredToken {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  source: string;
  hidden: boolean;
  firstSeenAt: Date;
  checkedAt: Date | null;
  error: string | null;
  pools: number;
  depthUsd: number | null;
}

export interface DiscoveredTokenCounts {
  total: number;
  read: number;
  unread: number;
  hidden: number;
  userSubmitted: number;
}

export async function discoveredTokenCounts(chainId: number): Promise<DiscoveredTokenCounts> {
  const rows = await db
    .select({
      total: count(),
      read: sql<number>`count(*) filter (where ${dexTokens.decimals} is not null)`,
      hidden: sql<number>`count(*) filter (where ${dexTokens.hidden})`,
      userSubmitted: sql<number>`count(*) filter (where ${dexTokens.source} = 'user_submitted')`,
    })
    .from(dexTokens)
    .where(eq(dexTokens.chainId, chainId));
  const row = rows[0];
  const total = Number(row?.total ?? 0);
  const read = Number(row?.read ?? 0);
  return { total, read, unread: total - read, hidden: Number(row?.hidden ?? 0), userSubmitted: Number(row?.userSubmitted ?? 0) };
}

// Newest first, with the depth of the deepest pool holding each token, so an
// operator can see what discovery is actually finding and hide what is spam.
export async function listDiscoveredTokens(chainId: number, q: string, limit = 100): Promise<DiscoveredToken[]> {
  const term = q.trim().replace(/[%_]/g, "").slice(0, 42);
  const filters = [eq(dexTokens.chainId, chainId)];
  if (term) {
    filters.push(
      or(sql`${dexTokens.symbol} ilike ${"%" + term + "%"}`, sql`${dexTokens.name} ilike ${"%" + term + "%"}`, sql`${dexTokens.address} ilike ${"%" + term.toLowerCase() + "%"}`) as ReturnType<typeof or> & object,
    );
  }
  const rows = await db
    .select({
      address: dexTokens.address,
      symbol: dexTokens.symbol,
      name: dexTokens.name,
      decimals: dexTokens.decimals,
      source: dexTokens.source,
      hidden: dexTokens.hidden,
      firstSeenAt: dexTokens.firstSeenAt,
      checkedAt: dexTokens.checkedAt,
      error: dexTokens.error,
      pools: sql<number>`(select count(*) from dex_pools p where p.chain_id = ${chainId} and p.token_address = ${dexTokens.address})`,
      depthUsd: sql<number | null>`(select max(p.depth_usd) from dex_pools p where p.chain_id = ${chainId} and p.token_address = ${dexTokens.address})`,
    })
    .from(dexTokens)
    .where(and(...filters))
    .orderBy(desc(dexTokens.firstSeenAt))
    .limit(limit);
  return rows.map(function shape(row) {
    return { ...row, pools: Number(row.pools), depthUsd: row.depthUsd === null ? null : Number(row.depthUsd) };
  });
}
