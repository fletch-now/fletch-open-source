import { assertWatcherCapacity, lockWatcherCapacity } from "@/lib/watch/capacity";
// Webhook endpoints: an account registers an HTTPS URL and a watcher delivers
// its alerts there instead of Telegram. CRUD, URL validation, secret minting and
// the signed POST itself all live here, so the outbox loop (deliver.ts), the v1
// routes and the dashboard's test button send exactly the same request.
//
// No "server-only", no next/*, no React, no lib/dal — workers/watch.ts imports
// this module through deliver.ts in a plain `tsx` process.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP, type LookupFunction } from "node:net";
import { lookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { watcherDeliveries, watchers, webhookEndpoints } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/telegram/secret";
import type { DeliveryPayload, WatcherKind } from "@/lib/watch/types";
import { WATCH_LIMITS } from "@/lib/watch/types";

const SECRET_PREFIX = "whsec_";

export interface WebhookEndpointRow {
  id: string;
  name: string;
  url: string;
  // "whsec_abcd…" — enough to tell two secrets apart, never the secret itself.
  secretPrefix: string;
  enabled: boolean;
  createdAt: Date;
  // The last 2xx from this endpoint, a test ping included — not proof an alert
  // was delivered.
  lastDeliveredAt: Date | null;
  lastError: string | null;
  // When lastError was written. A failure three weeks ago and one a minute ago
  // read the same without it.
  lastErrorAt: Date | null;
  lastTestAt: Date | null;
  lastTestStatus: number | null;
  lastTestError: string | null;
  lastAlertAt: Date | null;
  lastAlertStatus: number | null;
  lastAlertError: string | null;
}

// Returned only by create and rotate: the plaintext secret exists in one
// response and is never readable again.
export interface CreatedWebhookEndpoint extends WebhookEndpointRow {
  secret: string;
}

// Thrown for a URL a person can fix, and shown to them verbatim.
export class InvalidWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWebhookUrlError";
  }
}

export class WebhookNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookNotFoundError";
  }
}

// Thrown when an endpoint that is turned off is asked to receive something.
export class WebhookDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookDisabledError";
  }
}

export class WebhookLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookLimitError";
  }
}

// Validate both the registered URL and the address used by the socket.
type HostKind = "public" | "loopback" | "private";

const PRIVATE_NAME_PATTERNS: RegExp[] = [/\.local$/i, /\.internal$/i];
const LOOPBACK_NAME_PATTERN = /(^|\.)localhost\.?$/i;
const PRIVATE_IPV4_PATTERNS: RegExp[] = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^198\.(18|19)\./, /^(22[4-9]|23\d|24\d|25[0-5])\./, /^192\.0\.0\./, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];

// "::ffff:7f00:1" and "::ffff:127.0.0.1" are 127.0.0.1 written two other ways;
// both are unwrapped so one set of IPv4 rules covers every spelling.
function mappedIpv4(address: string): string | null {
  const grouped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (grouped) {
    const high = Number.parseInt(grouped[1], 16);
    const low = Number.parseInt(grouped[2], 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return dotted ? dotted[1] : null;
}

function classifyIpv4(address: string): HostKind {
  if (/^127\./.test(address)) {
    return "loopback";
  }
  if (PRIVATE_IPV4_PATTERNS.some(function matches(pattern) {
    return pattern.test(address);
  })) {
    return "private";
  }
  return "public";
}

// "::" is the unspecified address, which a connect() reaches loopback with;
// fc00::/7 is unique-local and fe80::/10 link-local.
function classifyIpv6(address: string): HostKind {
  if (address === "::1") {
    return "loopback";
  }
  if (address === "::" || /^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address)) {
    return "private";
  }
  // Global unicast only; reject multicast, translation and transition ranges.
  if (!/^[23][0-9a-f]{3}:/.test(address) || (/^2002:/.test(address) || /^2001:(0|10|20):/.test(address)) || /^2001:db8:/.test(address)) return "private";
  return "public";
}

function classifyHost(host: string): HostKind {
  if (LOOPBACK_NAME_PATTERN.test(host)) {
    return "loopback";
  }
  // URL keeps an IPv6 literal in brackets; node:net wants it without them.
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1).toLowerCase() : host;
  const version = isIP(literal);
  if (version === 0) {
    const named = PRIVATE_NAME_PATTERNS.some(function matches(pattern) {
      return pattern.test(host.replace(/\.$/, ""));
    });
    return named ? "private" : "public";
  }
  if (version === 4) {
    return classifyIpv4(literal);
  }
  const unwrapped = mappedIpv4(literal);
  return unwrapped ? classifyIpv4(unwrapped) : classifyIpv6(literal);
}

// A loopback endpoint over http is how a local check receives a signed ping
// (docs/PLAN-AUTHORITY-2.md item C). Allowed off production only, and only for
// loopback: every other private range is refused wherever this runs.
function loopbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function normalizeWebhookUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new InvalidWebhookUrlError("That is not a URL. It should look like https://example.com/fletch.");
  }
  const kind = classifyHost(parsed.hostname);
  const localAllowed = kind === "loopback" && loopbackAllowed();
  if (parsed.protocol !== "https:" && !(localAllowed && parsed.protocol === "http:")) {
    throw new InvalidWebhookUrlError("Use an https:// URL so notifications are encrypted in transit.");
  }
  if (kind !== "public" && !localAllowed) {
    throw new InvalidWebhookUrlError("That address is on a private network. Use a public https:// URL.");
  }
  if (parsed.username || parsed.password) {
    throw new InvalidWebhookUrlError("Leave the username and password out of the URL. Fletch signs each request instead.");
  }
  return parsed.toString();
}

// base64url over 32 bytes: the same construction as an API key's token, with a
// prefix that says what it is when it turns up in someone's logs.
function generateSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64url");
}

function toEndpointRow(row: typeof webhookEndpoints.$inferSelect): WebhookEndpointRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    secretPrefix: row.secretPrefix,
    enabled: row.enabled,
    createdAt: row.createdAt,
    lastDeliveredAt: row.lastDeliveredAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    lastTestError: row.lastTestError,
    lastAlertAt: row.lastAlertAt,
    lastAlertStatus: row.lastAlertStatus,
    lastAlertError: row.lastAlertError,
  };
}

export async function listWebhookEndpoints(userId: string): Promise<WebhookEndpointRow[]> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.userId, userId))
    .orderBy(asc(webhookEndpoints.createdAt));
  return rows.map(toEndpointRow);
}

// The one owner-scoped read every single-endpoint path starts from; the ping
// needs the encrypted secret off the same row, so the full row is selected.
async function findEndpoint(userId: string, id: string): Promise<typeof webhookEndpoints.$inferSelect | null> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWebhookEndpoint(userId: string, id: string): Promise<WebhookEndpointRow | null> {
  const row = await findEndpoint(userId, id);
  return row ? toEndpointRow(row) : null;
}

export interface CreateWebhookInput {
  url: string;
  name?: string;
}

// The owner row is locked before the count, the way lib/build/create.ts locks
// it before spending a credit: a transaction alone would let two concurrent
// requests both read four endpoints and both insert a fifth.
export async function createWebhookEndpoint(userId: string, input: CreateWebhookInput): Promise<CreatedWebhookEndpoint> {
  const url = normalizeWebhookUrl(input.url);
  const secret = generateSecret();
  const name = input.name?.trim() || new URL(url).host;

  return db.transaction(async function run(tx): Promise<CreatedWebhookEndpoint> {
    await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    const existing = await tx.select({ value: count() }).from(webhookEndpoints).where(eq(webhookEndpoints.userId, userId));
    if ((existing[0]?.value ?? 0) >= WATCH_LIMITS.webhookEndpointsPerUser) {
      throw new WebhookLimitError(
        `You've hit your limit of ${WATCH_LIMITS.webhookEndpointsPerUser} webhook endpoints. Delete one to add another.`,
      );
    }
    const inserted = await tx
      .insert(webhookEndpoints)
      .values({
        id: `wh_${randomUUID()}`,
        userId,
        name,
        url,
        secretEnc: encryptSecret(secret),
        secretPrefix: secret.slice(0, SECRET_PREFIX.length + 4),
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("Failed to create webhook endpoint");
    }
    return { ...toEndpointRow(row), secret };
  });
}

export async function rotateWebhookSecret(userId: string, id: string): Promise<CreatedWebhookEndpoint> {
  return updateWebhookEndpoint(userId, id, { rotateSecret: true }) as Promise<CreatedWebhookEndpoint>;
}

// Written on a watcher paused because its endpoint was turned off, and matched
// again when the endpoint comes back: only the watchers this paused resume, and
// one the account paused itself stays paused.
export const PAUSED_BY_DISABLE = "The webhook endpoint this watcher delivers to was disabled.";

// Turning an endpoint off pauses its watchers, the way deleting one does. The
// alternative is a watcher that reads as running while every alert it matches is
// dropped for having nowhere to go.
export async function setWebhookEndpointEnabled(userId: string, id: string, enabled: boolean): Promise<WebhookEndpointRow> {
  return updateWebhookEndpoint(userId, id, { enabled });
}

// Capacity checks and secret rotation must commit together. A failed enable
// must not invalidate a secret the caller never received.
export async function updateWebhookEndpoint(userId: string, id: string, patch: { enabled?: boolean; rotateSecret?: boolean }): Promise<WebhookEndpointRow | CreatedWebhookEndpoint> {
  return db.transaction(async function run(tx): Promise<WebhookEndpointRow | CreatedWebhookEndpoint> {
    await lockWatcherCapacity(tx);
    const changes: Partial<typeof webhookEndpoints.$inferInsert> = {};
    const secret = patch.rotateSecret ? generateSecret() : null;
    if (patch.enabled !== undefined) changes.enabled = patch.enabled;
    if (secret) {
      changes.secretEnc = encryptSecret(secret);
      changes.secretPrefix = secret.slice(0, SECRET_PREFIX.length + 4);
      changes.lastTestAt = null;
      changes.lastTestStatus = null;
      changes.lastTestError = null;
    }
    const [row] = await tx.update(webhookEndpoints).set(changes)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId))).returning();
    if (!row) throw new WebhookNotFoundError("Webhook endpoint not found.");
    const assigned = and(eq(watchers.userId, userId), eq(watchers.webhookId, id));
    if (patch.enabled === true) {
      const resuming = and(assigned, eq(watchers.lastError, PAUSED_BY_DISABLE), eq(watchers.enabled, false));
      const rows = await tx.select({ kind: watchers.kind }).from(watchers).where(resuming);
      await assertWatcherCapacity(tx, userId, rows.map((watcher) => watcher.kind as WatcherKind));
      await tx.update(watchers).set({ enabled: true, status: "catching_up", lastError: null, updatedAt: new Date() }).where(resuming);
    } else if (patch.enabled === false) {
      await tx.update(watchers).set({ enabled: false, status: "paused", lastError: PAUSED_BY_DISABLE, updatedAt: new Date() })
        .where(and(assigned, eq(watchers.enabled, true)));
    }
    if (secret) return { ...toEndpointRow(row), secret };
    return toEndpointRow(row);
  });
}

// The foreign key sets watchers.webhook_id to null on delete, which would leave
// a webhook watcher with nowhere to send. Those watchers are paused in the same
// transaction and told why, rather than silently falling back to Telegram or
// failing every alert from then on.
export async function deleteWebhookEndpoint(userId: string, id: string): Promise<{ pausedWatchers: number }> {
  return db.transaction(async function run(tx): Promise<{ pausedWatchers: number }> {
    await lockWatcherCapacity(tx);
    const paused = await tx
      .update(watchers)
      .set({ enabled: false, status: "paused", lastError: "The webhook endpoint this watcher delivered to was deleted.", updatedAt: new Date() })
      .where(and(eq(watchers.userId, userId), eq(watchers.webhookId, id)))
      .returning({ id: watchers.id });
    // Pausing the watchers stops new matches; the ones already queued would
    // otherwise be picked up by the next outbox pass and dropped with "no
    // webhook endpoint". They are resolved here, with the reason.
    const pausedIds = paused.map(function idOf(watcher) {
      return watcher.id;
    });
    if (pausedIds.length > 0) {
      await tx
        .update(watcherDeliveries)
        .set({ status: "failed", lastError: "the webhook endpoint this alert was queued for was deleted" })
        .where(and(eq(watcherDeliveries.status, "pending"), inArray(watcherDeliveries.watcherId, pausedIds)));
    }
    const deleted = await tx
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)))
      .returning({ id: webhookEndpoints.id });
    if (!deleted[0]) {
      throw new WebhookNotFoundError("Webhook endpoint not found.");
    }
    return { pausedWatchers: paused.length };
  });
}

// ── Sending ──────────────────────────────────────────────────────────────────

// What a receiver gets. `kind` is the payload's own kind ("large_transfer",
// "wallet_activity", "authority") or "ping" for a test delivery; `watcher` is
// null for a ping, which belongs to the endpoint rather than to any watcher.
export interface WebhookEnvelope {
  id: string;
  kind: string;
  payload: DeliveryPayload | { message: string };
  watcher: { id: string; name: string; kind: string } | null;
  // When Fletch matched the event. `sentAt` is when this attempt left; on a
  // retry hours later the two differ, and only `queuedAt` is near the event.
  queuedAt: string;
  // 1 on the first try.
  attempt: number;
  sentAt: string;
}

export interface WebhookSendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  retryAfterMs?: number;
}

// t=<unix seconds>,v1=<hex hmac-sha256 over "<t>.<body>">. The timestamp is
// inside the signed string so a captured body cannot be replayed with a fresh
// header; a receiver should reject a timestamp more than a few minutes old.
export function signWebhookBody(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

export interface WebhookTarget {
  url: string;
  secret: string;
}

// The socket uses exactly the checked DNS answer, with the original hostname
// still used for Host and TLS verification. Reject mixed public/private answers.
export function validateWebhookAddresses(addresses: LookupAddress[]): void {
  if (!addresses.length) throw new Error("The endpoint hostname has no address.");
  for (const entry of addresses) {
    const kind = classifyHost(entry.address);
    if (!isIP(entry.address) || (kind !== "public" && !(kind === "loopback" && loopbackAllowed()))) {
      throw new InvalidWebhookUrlError("The endpoint resolves to a private or reserved address.");
    }
  }
}

const webhookLookup: LookupFunction = function resolve(hostname, options, callback): void {
  lookup(hostname, { all: true, verbatim: true }, function checked(error, addresses): void {
    if (error) { callback(error, "", 4); return; }
    try { validateWebhookAddresses(addresses); }
    catch (failure) { callback(failure as Error, "", 4); return; }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

export function webhookRetryAfterMs(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  return Math.min(milliseconds, 24 * 60 * 60 * 1000);
}

export async function postWebhook(target: WebhookTarget, envelope: WebhookEnvelope): Promise<WebhookSendResult> {
  try {
    const url = new URL(normalizeWebhookUrl(target.url));
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000);
    return await new Promise<WebhookSendResult>(function send(resolve) {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const outgoing = request(url, {
        method: "POST", agent: false, lookup: webhookLookup,
        signal: AbortSignal.timeout(WATCH_LIMITS.webhookTimeoutMs),
        headers: {
          "content-type": "application/json", "content-length": Buffer.byteLength(body),
          "user-agent": "fletch-webhooks/1", "x-fletch-event": envelope.kind,
          "x-fletch-delivery": envelope.id,
          "x-fletch-signature": signWebhookBody(target.secret, body, timestamp),
        },
      }, function received(response): void {
        const status = response.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        let error: string | null = null;
        if (!ok) error = `HTTP ${status}`;
        if (status >= 300 && status < 400) error += ": redirects are not followed; use the final endpoint URL";
        const retryAfterMs = webhookRetryAfterMs(response.headers["retry-after"]);
        // Only acknowledgement headers matter. Never buffer or expose the body.
        response.destroy();
        resolve({ ok, status, error, retryAfterMs });
      });
      outgoing.on("error", function failed(error: NodeJS.ErrnoException): void {
        let message = "The endpoint could not be reached. Check its DNS, TLS certificate and availability.";
        if (error instanceof InvalidWebhookUrlError) message = error.message;
        if (error.code === "ABORT_ERR") message = "The endpoint did not respond within 10 seconds.";
        resolve({ ok: false, status: null, error: message });
      });
      outgoing.end(body);
    });
  } catch (error) {
    const message = error instanceof InvalidWebhookUrlError ? error.message : "Could not prepare the webhook request.";
    return { ok: false, status: null, error: message };
  }
}

// The outbox passes its own transaction so the endpoint's state moves with the
// delivery row it came from; the ping path passes `db`.
export type WebhookWriter = Pick<typeof db, "update">;

export async function recordWebhookResult(client: WebhookWriter, endpointId: string, result: WebhookSendResult, kind: "alert" | "test" = "alert"): Promise<void> {
  const observed = kind === "test"
    ? { lastTestAt: sql`now()`, lastTestStatus: result.status, lastTestError: result.error }
    : { lastAlertAt: sql`now()`, lastAlertStatus: result.status, lastAlertError: result.error };
  if (result.ok) {
    await client
      .update(webhookEndpoints)
      .set({ ...observed, lastDeliveredAt: sql`now()`, lastError: null, lastErrorAt: null })
      .where(eq(webhookEndpoints.id, endpointId));
    return;
  }
  await client
    .update(webhookEndpoints)
    .set({ ...observed, lastError: result.error, lastErrorAt: sql`now()` })
    .where(eq(webhookEndpoints.id, endpointId));
}

// The dashboard's "send a test" button and POST /api/v1/webhooks/{id}/test.
// Sent straight out rather than through the outbox: a test is answered now, and
// nothing about it should be retried for hours if the endpoint is down.
export async function sendWebhookPing(userId: string, id: string): Promise<WebhookSendResult> {
  const row = await findEndpoint(userId, id);
  if (!row) {
    throw new WebhookNotFoundError("Webhook endpoint not found.");
  }
  // The outbox refuses a disabled endpoint, so a test must too: otherwise the
  // row shows a fresh delivery for an endpoint that receives none.
  if (!row.enabled) {
    throw new WebhookDisabledError("Enable this endpoint before testing it.");
  }
  const sentAt = new Date().toISOString();
  const envelope: WebhookEnvelope = {
    id: `ping_${randomUUID()}`,
    kind: "ping",
    payload: { message: "Fletch webhook connection test." },
    watcher: null,
    queuedAt: sentAt,
    attempt: 1,
    sentAt,
  };
  const result = await postWebhook({ url: row.url, secret: decryptSecret(row.secretEnc) }, envelope);
  await recordWebhookResult(db, row.id, result, "test");
  return result;
}
