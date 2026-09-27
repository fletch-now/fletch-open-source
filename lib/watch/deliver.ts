// The outbox loop (docs/MVP.md, ticket 6): claim a batch of pending deliveries
// with SKIP LOCKED (safe even if a second daemon instance is ever run), send each
// to wherever its watcher delivers — Telegram, or a signed POST to a webhook
// endpoint — and resolve its status: sent, rescheduled, or given up on.
//
// Claiming, sending and recording are separate transactions. A webhook POST can
// take the whole 10 s timeout, and twenty rows pointing at endpoints that
// blackhole packets would hold one batch-wide transaction — its pooled
// connection and its row locks with it — for minutes, re-sending every POST in
// the batch if the commit then failed.
//
// No "server-only", no next/*, no React, no lib/dal — workers/watch.ts (a plain
// `tsx` process) imports this module directly.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { watcherDeliveries, watchers } from "@/lib/db/schema";
import { getTelegramAccount } from "@/lib/telegram/link";
import { getUserBotToken } from "@/lib/telegram/bots";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { decryptSecret } from "@/lib/telegram/secret";
import { formatTelegram } from "@/lib/watch/format";
import type { DeliveryChannel, DeliveryPayload } from "@/lib/watch/types";
import { WATCH_LIMITS } from "@/lib/watch/types";
import type { WebhookEnvelope } from "@/lib/watch/webhooks";
import { postWebhook, recordWebhookResult } from "@/lib/watch/webhooks";
import { logEvent } from "@/lib/log";

// Anything that writes one delivery's outcome: the pool for a single statement,
// a transaction where two rows have to move together.
type DeliveryWriter = Pick<typeof db, "update">;

const CLAIM_BATCH_SIZE = 20;
// Reserve enough time for a whole sequential batch at the network timeout,
// plus database work. A crash releases the batch when this lease expires.
// Telegram's own ceiling is 1 message/second per chat; this daemon has only one
// process today, so a plain per-chat "last sent" map inside one batch is enough.
const CHAT_MIN_INTERVAL_MS = 1_000;
const CLAIM_RESERVE_MS = CLAIM_BATCH_SIZE * (WATCH_LIMITS.webhookTimeoutMs + CHAT_MIN_INTERVAL_MS) + 120_000;
const BACKOFF_CAP_MS = 300_000;
const BACKOFF_BASE_MS = 2_000;

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  watcher_id: string;
  user_id: string;
  payload: DeliveryPayload;
  attempts: number;
  created_at_ms: string;
  delivery: DeliveryChannel;
  watcher_name: string;
  watcher_kind: string;
  endpoint_id: string | null;
  endpoint_url: string | null;
  endpoint_secret_enc: string | null;
  endpoint_enabled: boolean | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(function schedule(resolve) {
    setTimeout(resolve, ms);
  });
}

// Full jitter (AWS Architecture Blog, "Exponential Backoff And Jitter", cited in
// docs/MVP.md): a uniform random draw up to the exponential ceiling, not the
// ceiling itself — spreads retries instead of having them all land together.
function fullJitterBackoffMs(attempts: number): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempts);
  return Math.floor(Math.random() * ceiling);
}

// Shared by both the generic-SendResult-failure path and processDelivery's own
// last-resort catch, so an exception thrown outside sendTelegramMessage's own
// result type (a DB blip in getTelegramAccount, say) still ages out through
// maxDeliveryAttempts instead of retrying every 1.5s forever with no backoff.
async function failOrBackoff(writer: DeliveryWriter, deliveryId: string, attempts: number, lastError: string, retryAfterMs = 0): Promise<void> {
  if (attempts >= WATCH_LIMITS.maxDeliveryAttempts) {
    await writer.update(watcherDeliveries).set({ status: "failed", attempts, lastError }).where(and(eq(watcherDeliveries.id, deliveryId), eq(watcherDeliveries.status, "pending")));
    return;
  }
  const backoffMs = Math.max(fullJitterBackoffMs(attempts), retryAfterMs);
  await writer
    .update(watcherDeliveries)
    .set({ attempts, nextAttemptAt: sql`now() + (${backoffMs} * interval '1 millisecond')`, lastError })
    .where(and(eq(watcherDeliveries.id, deliveryId), eq(watcherDeliveries.status, "pending")));
}

async function giveUp(writer: DeliveryWriter, deliveryId: string, lastError: string): Promise<void> {
  await writer.update(watcherDeliveries).set({ status: "failed", lastError }).where(and(eq(watcherDeliveries.id, deliveryId), eq(watcherDeliveries.status, "pending")));
}

// The alert was detected; only the channel is missing. Held rows leave the
// queue and come back as pending the moment Telegram is linked.
async function hold(writer: DeliveryWriter, deliveryId: string, lastError: string): Promise<void> {
  await writer.update(watcherDeliveries).set({ status: "held", lastError }).where(and(eq(watcherDeliveries.id, deliveryId), eq(watcherDeliveries.status, "pending")));
}

export const HELD_TELEGRAM_NOT_LINKED = "telegram not linked";
export const HELD_NO_BOT = "no telegram bot configured";

async function markSent(writer: DeliveryWriter, deliveryId: string, watcherId: string): Promise<void> {
  const sent = await writer
    .update(watcherDeliveries)
    .set({ status: "sent", sentAt: sql`now()`, lastError: null })
    .where(and(eq(watcherDeliveries.id, deliveryId), eq(watcherDeliveries.status, "pending")))
    .returning({ id: watcherDeliveries.id });
  if (!sent.length) return;
  await writer.update(watchers).set({ lastTriggeredAt: sql`now()` }).where(eq(watchers.id, watcherId));
}

function toEnvelope(row: ClaimedRow): WebhookEnvelope {
  return {
    id: row.id,
    kind: row.payload.kind,
    payload: row.payload,
    watcher: { id: row.watcher_id, name: row.watcher_name, kind: row.watcher_kind },
    queuedAt: new Date(Number(row.created_at_ms)).toISOString(),
    attempt: row.attempts + 1,
    sentAt: new Date().toISOString(),
  };
}

// A watcher whose endpoint is gone has nowhere to send, and deleting an endpoint
// already fails the rows queued for it — one that reaches here belongs to a
// watcher re-pointed at nothing, and no retry recovers it. A disabled endpoint
// is different: deliveries queued before it was turned off are held and retried,
// because turning it back on is one click away.
async function processWebhookDelivery(row: ClaimedRow): Promise<void> {
  const endpointId = row.endpoint_id;
  if (!endpointId || !row.endpoint_url || !row.endpoint_secret_enc) {
    await giveUp(db, row.id, "no webhook endpoint");
    return;
  }
  if (row.endpoint_enabled === false) {
    await db.update(watcherDeliveries).set({ nextAttemptAt: sql`now() + interval '1 minute'`, lastError: "webhook endpoint disabled" })
      .where(and(eq(watcherDeliveries.id, row.id), eq(watcherDeliveries.status, "pending")));
    return;
  }

  const result = await postWebhook({ url: row.endpoint_url, secret: decryptSecret(row.endpoint_secret_enc) }, toEnvelope(row));
  if (result.ok) {
    await db.transaction(async function record(tx): Promise<void> {
      await recordWebhookResult(tx, endpointId, result);
      await markSent(tx, row.id, row.watcher_id);
    });
    return;
  }
  await recordWebhookResult(db, endpointId, result);
  await failOrBackoff(db, row.id, row.attempts + 1, result.error ?? "webhook delivery failed", result.retryAfterMs);
}

async function processTelegramDelivery(row: ClaimedRow, lastSentAtByChat: Map<string, number>): Promise<void> {
  const account = await getTelegramAccount(row.user_id);
  if (!account) {
    await hold(db, row.id, HELD_TELEGRAM_NOT_LINKED);
    return;
  }

  const lastSentAt = lastSentAtByChat.get(account.chatId);
  if (lastSentAt !== undefined) {
    const elapsed = Date.now() - lastSentAt;
    if (elapsed < CHAT_MIN_INTERVAL_MS) {
      await sleep(CHAT_MIN_INTERVAL_MS - elapsed);
    }
  }

  // A person's own bot (Settings) delivers their alerts; the platform bot is the
  // fallback, and with neither configured the row fails with a reason that says so.
  const ownToken = await getUserBotToken(row.user_id);
  if (!ownToken && !process.env.TELEGRAM_BOT_TOKEN) {
    await hold(db, row.id, HELD_NO_BOT);
    return;
  }
  const result = await sendTelegramMessage(account.chatId, formatTelegram(row.payload), ownToken ?? undefined);
  lastSentAtByChat.set(account.chatId, Date.now());

  if (result.ok) {
    await db.transaction(function record(tx): Promise<void> {
      return markSent(tx, row.id, row.watcher_id);
    });
    return;
  }

  // 429: Telegram is telling us exactly how long to wait, so trust that number
  // rather than folding it into the generic backoff/attempts count.
  if (result.retryAfterMs !== undefined) {
    await db
      .update(watcherDeliveries)
      .set({ nextAttemptAt: sql`now() + (${result.retryAfterMs} * interval '1 millisecond')`, lastError: result.error })
      .where(eq(watcherDeliveries.id, row.id));
    return;
  }

  // 403: bot blocked, or the chat no longer exists. Neither recovers on retry.
  if (result.blocked) {
    await giveUp(db, row.id, result.error);
    return;
  }

  await failOrBackoff(db, row.id, row.attempts + 1, result.error);
}


// FOR UPDATE OF d SKIP LOCKED: this is the single-node job queue docs/MVP.md
// names — a second daemon instance (there isn't one in v1, but the query doesn't
// assume that) would claim a disjoint batch instead of blocking or
// double-sending. Only the delivery row is locked; the watcher and endpoint rows
// joined in are read, not claimed. created_at is read through the session's own
// zone because the column has none: `extract(epoch from …)` alone would read a
// wall-clock time as if it were UTC.
async function claimBatch(): Promise<ClaimedRow[]> {
  return db.transaction(async function run(tx): Promise<ClaimedRow[]> {
    const claimed = await tx.execute<ClaimedRow>(sql`
      SELECT
        d.id, d.watcher_id, d.user_id, d.payload, d.attempts,
        (extract(epoch from d.created_at at time zone current_setting('TimeZone')) * 1000)::bigint AS created_at_ms,
        w.delivery, w.name AS watcher_name, w.kind AS watcher_kind,
        e.id AS endpoint_id, e.url AS endpoint_url, e.secret_enc AS endpoint_secret_enc, e.enabled AS endpoint_enabled
      FROM watcher_deliveries d
      JOIN watchers w ON w.id = d.watcher_id
      LEFT JOIN webhook_endpoints e ON e.id = w.webhook_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= now()
        AND (w.delivery <> 'webhook' OR e.enabled IS DISTINCT FROM false)
      ORDER BY d.next_attempt_at
      LIMIT ${CLAIM_BATCH_SIZE}
      FOR UPDATE OF d SKIP LOCKED
    `);
    const rows = claimed.rows;
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map(function idOf(row) {
      return row.id;
    });
    await tx.execute(sql`
      UPDATE watcher_deliveries
      SET next_attempt_at = now() + (${CLAIM_RESERVE_MS} * interval '1 millisecond')
      WHERE id IN ${ids}
    `);
    return rows;
  });
}

const COMBINE_MAX = 8;

// Telegram rows for one person claimed in the same batch travel as one
// message with a line per alert, instead of a burst of separate pings. Webhook
// rows stay one envelope each, since an endpoint expects that.
function combineTelegram(rows: ClaimedRow[]): ClaimedRow[][] {
  const groups = new Map<string, ClaimedRow[]>();
  const order: ClaimedRow[][] = [];
  for (const row of rows) {
    if (row.delivery === "webhook") {
      order.push([row]);
      continue;
    }
    const current = groups.get(row.user_id);
    if (current && current.length < COMBINE_MAX) {
      current.push(row);
      continue;
    }
    const group = [row];
    groups.set(row.user_id, group);
    order.push(group);
  }
  return order;
}

async function processTelegramGroup(rows: ClaimedRow[], lastSentAtByChat: Map<string, number>): Promise<void> {
  if (rows.length === 1) {
    await processTelegramDelivery(rows[0], lastSentAtByChat);
    return;
  }
  const lead = rows[0];
  const account = await getTelegramAccount(lead.user_id);
  if (!account) {
    for (const row of rows) {
      await hold(db, row.id, HELD_TELEGRAM_NOT_LINKED);
    }
    return;
  }
  const ownToken = await getUserBotToken(lead.user_id);
  if (!ownToken && !process.env.TELEGRAM_BOT_TOKEN) {
    for (const row of rows) {
      await hold(db, row.id, HELD_NO_BOT);
    }
    return;
  }
  const lastSentAt = lastSentAtByChat.get(account.chatId);
  if (lastSentAt !== undefined && Date.now() - lastSentAt < CHAT_MIN_INTERVAL_MS) {
    await sleep(CHAT_MIN_INTERVAL_MS - (Date.now() - lastSentAt));
  }
  const text = `${rows.length} alerts\n\n${rows.map((row) => formatTelegram(row.payload)).join("\n\n")}`;
  const result = await sendTelegramMessage(account.chatId, text, ownToken ?? undefined);
  lastSentAtByChat.set(account.chatId, Date.now());
  if (result.ok) {
    await db.transaction(async function record(tx): Promise<void> {
      for (const row of rows) {
        await markSent(tx, row.id, row.watcher_id);
      }
    });
    return;
  }
  // The combined send did not go through; each row takes the single path
  // next time, with its own backoff, so one bad row never blocks the others.
  for (const row of rows) {
    if (result.blocked) {
      await giveUp(db, row.id, result.error);
    } else {
      await failOrBackoff(db, row.id, row.attempts + 1, result.error);
    }
  }
}

export async function deliverOnce(): Promise<void> {
  const rows = await claimBatch();
  const lastSentAtByChat = new Map<string, number>();
  for (const group of combineTelegram(rows)) {
    try {
      if (group[0].delivery === "webhook") {
        await processWebhookDelivery(group[0]);
      } else {
        await processTelegramGroup(group, lastSentAtByChat);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of group) {
        logEvent("watch", { event: "deliver-row-failed", deliveryId: row.id, error: message });
        await failOrBackoff(db, row.id, row.attempts + 1, message);
      }
    }
  }
}
