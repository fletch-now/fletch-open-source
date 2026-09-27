import { BuildCleanupError } from "@/lib/build/process-cancellation";
import { setTimeout as delay } from "node:timers/promises";
import { STOP_REQUESTED, withBuildCancellation } from "@/lib/build/cancellation";
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { recoverBuildBrief } from "@/lib/build/recover-brief";
import { projectConversation } from "@/lib/build/project-conversation";
import { buildLogs, builds, contracts, projects } from "@/lib/db/schema";
import { getBuilder } from "@/lib/build";
import { applyGeneratedProjectName } from "@/lib/build/project-name";
import { logEvent } from "@/lib/log";
import { RH_TESTNET_ID } from "@/lib/config";
import { walletsForUser } from "@/lib/wallets";
import { getAddress } from "viem";
import type { BuildAttachment, BuildEvent } from "@/lib/build/types";
import { buildCapacity, cancelQueuedBuild, claimNextBuild, failClaimedBuild, finishBuildSuccessfully, requestBuildStop, type QueuedClaim } from "@/lib/build/queue";
import { priorSessionId } from "@/lib/agent/session";
import { providerForBuild } from "@/lib/agent/user-keys";
import type { BuildCost } from "@/lib/build/kimi-builder";
import type { NeedsVerdict } from "@/lib/agent/needs-rules";

// A build runs here, not inside the HTTP request that started it. Closing the tab
// only drops a subscriber; the run continues and every event is persisted, so a
// reconnect replays what was missed. Single-process by design — a restart
// fails interrupted execution at startup; waiting rows survive. Multiple web
// processes still require worker leases and durable cross-process event delivery.

type Listener = (event: BuildEvent) => void;

interface RunState {
  events: BuildEvent[];
  finished: boolean;
  listeners: Set<Listener>;
  controller: AbortController;
}

interface RunnerState {
  runs: Map<string, RunState>;
  inFlight: number;
  draining: Promise<void> | null;
  setupFailures: Map<string, { userId: string; message: string }>;
  poll: ReturnType<typeof setInterval> | null;
}

// Next can bundle instrumentation and routes separately. Both must see the same
// in-process subscriptions and slots when startup drains a build without a tab.
const processState = globalThis as typeof globalThis & { __fletchBuildRunner?: RunnerState };
const runner = processState.__fletchBuildRunner ??= {
  runs: new Map(), inFlight: 0, draining: null, setupFailures: new Map(), poll: null,
};
const { runs, setupFailures } = runner;
const MAX_CONCURRENT = buildCapacity();

export function atCapacity(): boolean {
  return runner.inFlight >= MAX_CONCURRENT;
}

// All callers drain the same FIFO; a POST or reconnect never claims its own ID
// ahead of older rows. The database guard also counts claims not yet in `runs`.
export function startQueuedBuilds(): Promise<void> {
  if (!runner.draining) {
    runner.draining = drainQueue().finally(function releaseDrain() { runner.draining = null; });
  }
  return runner.draining;
}

async function drainQueue(): Promise<void> {
  // A database outage after a claim must not strand the row. Retry the atomic
  // failure/refund before claiming more work; startup recovery covers a restart.
  for (const [buildId, failure] of setupFailures) {
    await failClaimedBuild(buildId, failure.userId, failure.message);
    setupFailures.delete(buildId);
  }
  while (!atCapacity()) {
    const claim = await claimNextBuild();
    if (!claim) return;
    runner.inFlight += 1;
    try {
      if (!(await startClaimedBuild(claim))) runner.inFlight -= 1;
    } catch (cause) {
      runner.inFlight -= 1;
      const message = cause instanceof Error ? cause.message : "Build setup failed";
      setupFailures.set(claim.id, { userId: claim.userId, message });
      await failClaimedBuild(claim.id, claim.userId, message);
      setupFailures.delete(claim.id);
      logEvent("build", { event: "setup-failed", buildId: claim.id, message });
    }
  }
}

// Called only by real Node server startup, after orphan recovery. A browser is
// unnecessary; retries also recover from a transient database/setup failure.
export function startBuildQueue(): void {
  if (runner.poll) return;
  function drain(): void {
    void startQueuedBuilds().catch(function failed(cause: unknown) {
      logEvent("build", { event: "queue-start-failed", message: cause instanceof Error ? cause.message : String(cause) });
    });
  }
  runner.poll = setInterval(drain, 3_000);
  runner.poll.unref();
  drain();
}

function emit(state: RunState, event: BuildEvent): void {
  state.events.push(event);
  for (const listener of state.listeners) {
    listener(event);
  }
}

async function persist(buildId: string, seq: number, event: BuildEvent): Promise<void> {
  if (!event.at) {
    event.at = new Date().toISOString();
  }
  await db.insert(buildLogs).values({
    id: randomUUID(),
    buildId,
    seq,
    level: event.phase,
    chunk: JSON.stringify(event),
  });
}

async function finalizeSuccess(
  buildId: string,
  projectId: string | null,
  event: BuildEvent,
): Promise<boolean> {
  // Guarded on the current status: the reaper may have already failed and refunded
  // a long-running build, and an unguarded write would hand out both a refund and
  // a successful build.
  if (!(await finishBuildSuccessfully(buildId))) return false;
  if (projectId) {
    await applyGeneratedProjectName(projectId).catch(() => logEvent("build", { event: "project-name-unavailable", buildId }));
  }
  if (projectId && event.previewUrl) {
    await db.update(projects).set({ previewUrl: event.previewUrl }).where(eq(projects.id, projectId));
  }
  return true;
}

async function recordContract(buildId: string, event: BuildEvent): Promise<void> {
  if (event.contractAddress) {
    const insert = db.insert(contracts).values({
      id: `${buildId}:contract`,
      buildId,
      chainId: RH_TESTNET_ID,
      address: event.contractAddress,
      txHash: event.txHash ?? null,
      abi: event.abi ?? null,
      sourceHash: event.bytecodeHash ?? null,
      bytecode: event.bytecode ?? null,
      ownerAddress: event.owner ?? null,
      deployer: "platform",
      // Deployed and mined, which is what confirmedAt records. `verified` is
      // Blockscout's own answer from the verification step, never assumed.
      verified: event.verified === true,
      verifiedAt: event.verified === true ? new Date() : null,
      verifyError: event.verifyError ?? null,
      confirmedAt: new Date(),
    });
    // Address-only events carry no new explorer result. A failed lookup cannot
    // erase an earlier confirmation for this same deployed address.
    if (event.verified === undefined) {
      await insert.onConflictDoNothing({ target: contracts.id });
      return;
    }
    await insert.onConflictDoUpdate({
      target: contracts.id,
      set: {
        verified: event.verified === true ? true : sql`${contracts.verified}`,
        verifiedAt: event.verified === true ? sql`coalesce(${contracts.verifiedAt}, ${new Date()})` : sql`${contracts.verifiedAt}`,
        verifyError: event.verifyError ?? null,
      },
      setWhere: sql`lower(${contracts.address}) = lower(${event.contractAddress})`,
    });
  }
}

async function finalizeFailure(buildId: string, userId: string, message: string): Promise<void> {
  await failClaimedBuild(buildId, userId, message);
}

// Drizzle queries are lazy: a `void db.update(...)` is built and never executed.
// Every fire-and-forget write therefore goes through an awaited helper.
async function recordSession(buildId: string, sessionId: string): Promise<void> {
  await db.update(builds).set({ agentSessionId: sessionId }).where(eq(builds.id, buildId));
}

async function recordNeeds(buildId: string, verdict: NeedsVerdict, overridden: boolean): Promise<void> {
  await db
    .update(builds)
    .set({
      needsContract: verdict.contract,
      needsWallet: verdict.wallet,
      needsReason: verdict.reason,
      needsSource: verdict.source,
      needsOverridden: overridden,
    })
    .where(eq(builds.id, buildId));
}

async function recordCost(buildId: string, cost: BuildCost): Promise<void> {
  await db
    .update(builds)
    .set({
      tokensIn: cost.usageComplete === false ? null : cost.inputTokens,
      tokensOut: cost.usageComplete === false ? null : cost.outputTokens,
      costUsd: cost.usageComplete === false ? null : sql`case when ${builds.billingMode} = 'own_key' then null else ${String(cost.usd)}::numeric end`,
    })
    .where(eq(builds.id, buildId));
}

// The project's most recent deploy, so an unchanged contract keeps its address.
async function lastDeployedContract(projectId: string | null, buildId: string): Promise<{ address: string; bytecodeHash: string } | null> {
  if (!projectId) {
    return null;
  }
  const rows = await db
    .select({ address: contracts.address, sourceHash: contracts.sourceHash })
    .from(contracts)
    .innerJoin(builds, eq(contracts.buildId, builds.id))
    .where(and(eq(builds.projectId, projectId), ne(builds.id, buildId), isNotNull(contracts.sourceHash)))
    .orderBy(desc(contracts.createdAt))
    .limit(1);
  const row = rows[0];
  return row?.sourceHash ? { address: row.address, bytecodeHash: row.sourceHash } : null;
}

// The person's first wallet, checksummed, is what every contract they build is
// constructed with as owner. An account without a wallet (a dev login) gets
// null and the deploy step says so.
async function ownerWalletFor(userId: string): Promise<string | null> {
  const wallets = await walletsForUser(userId);
  return wallets[0] ? getAddress(wallets[0]) : null;
}

async function drive(
  buildId: string,
  userId: string,
  prompt: string,
  slug: string,
  projectId: string | null,
  resumeSessionId: string | undefined,
  attachments: BuildAttachment[],
): Promise<void> {
  const state = runs.get(buildId);
  if (!state) {
    return;
  }
  let seq = 0;
  // Each agent turn reports its own usage; the build's number is the sum.
  const totals: BuildCost = { inputTokens: 0, outputTokens: 0, usd: 0, model: "" };
  let costWrites = Promise.resolve();
  const startedAtMs = Date.now();
  logEvent("build", { event: "start", buildId, userId, projectId, resumed: Boolean(resumeSessionId) });
  try {
    if (state.controller.signal.aborted) {
      await finalizeFailure(buildId, userId, "Stopped by you before the agent started. Any Fletch build debit is refunded.");
      const stopped: BuildEvent = { phase: "error", text: "Stopped by you before the agent started." };
      await persist(buildId, seq, stopped);
      emit(state, stopped);
      return;
    }
    // A person who brought their own model key runs on it, and their build spends
    // no credit. Nothing else about the run changes.
    const own = await providerForBuild(userId, buildId);
    const builder = getBuilder({
      provider: own,
      resumeSessionId,
      onCost: function onCost(cost) {
        if (cost.usageComplete === false) totals.usageComplete = false;
        totals.inputTokens += cost.inputTokens;
        totals.outputTokens += cost.outputTokens;
        totals.usd += cost.usd;
        totals.model = cost.model;
        const snapshot = { ...totals };
        costWrites = costWrites.then(() => recordCost(buildId, snapshot));
      },
      onNeeds: function onNeeds(verdict, overridden) {
        void recordNeeds(buildId, verdict, overridden);
      },
      onSession: async function onSession(sessionId) {
        // Stored so a follow-up prompt can resume the same agent conversation.
        await recordSession(buildId, sessionId);
      },
      onBroadcast: async function onBroadcast(txHash) {
        const event: BuildEvent = { phase: "deploying", text: `Transaction broadcast: ${txHash}. Waiting for its receipt.`, txHash };
        await persist(buildId, seq++, event);
        emit(state, event);
      },
    });
    const previousContract = await lastDeployedContract(projectId, buildId);
    const ownerAddress = await ownerWalletFor(userId);
    const previousSuccess = projectId ? await db.select({ id: builds.id }).from(builds)
      .where(and(eq(builds.projectId, projectId), ne(builds.id, buildId), eq(builds.status, "succeeded"))).limit(1) : [];
    const input = await recoverBuildBrief(pool, { buildId, prompt, slug, previousContract, previousBuildSucceeded: previousSuccess.length > 0, ownerAddress, attachments,
      projectConversation: await projectConversation(pool, buildId, userId, projectId),
    }, userId, projectId);
    for await (const event of builder.run(input)) {
      // Keep mined receipts even when Stop arrived during broadcast/reconciliation.
      if (event.contractAddress) await recordContract(buildId, event);
      if (state.controller.signal.aborted) throw new Error(STOP_REQUESTED);
      if (event.phase === "done") {
        if (!(await finalizeSuccess(buildId, projectId, event))) throw new Error("The build is no longer active; completion was not accepted.");
        logEvent("build", { event: "done", buildId, seq, ms: Date.now() - startedAtMs });
      } else if (event.phase === "error") {
        await finalizeFailure(buildId, userId, event.text);
        logEvent("build", { event: "error", buildId, seq, ms: Date.now() - startedAtMs, message: event.text });
      }
      if (state.controller.signal.aborted) throw new Error(STOP_REQUESTED);
      await persist(buildId, seq++, event);
      emit(state, event);
    }
    state.controller.signal.throwIfAborted();
  } catch (cause) {
    if (cause instanceof BuildCleanupError) {
      const pending: BuildEvent = { phase: "note", stopping: true, text: cause.message };
      await persist(buildId, seq++, pending).catch(() => logEvent("build", { event: "cleanup-state-write-failed", buildId }));
      emit(state, pending);
      for (;;) {
        try {
          await cause.retry();
          break;
        } catch {
          logEvent("build", { event: "cleanup-unconfirmed", buildId });
          await delay(3_000);
        }
      }
    }
    const message = state.controller.signal.aborted ? STOP_REQUESTED : cause instanceof Error ? cause.message : "Build failed";
    logEvent("build", { event: "crash", buildId, ms: Date.now() - startedAtMs, message });
    await finalizeFailure(buildId, userId, message);
    const event: BuildEvent = { phase: "error", text: message };
    await persist(buildId, seq, event);
    emit(state, event);
  } finally {
    await costWrites.catch(() => logEvent("build", { event: "usage-write-failed", buildId }));
    if (state.controller.signal.aborted) {
      await recordCost(buildId, { ...totals, usageComplete: false }).catch(() => logEvent("build", { event: "usage-write-failed", buildId }));
    }
    runner.inFlight -= 1;
    state.finished = true;
    // Keep the buffer briefly so a reconnecting tab still gets the tail.
    setTimeout(function evict() {
      runs.delete(buildId);
    }, 120_000);
    void startQueuedBuilds().catch(function logQueueFailure(cause: unknown) {
      logEvent("build", { event: "queue-start-failed", message: cause instanceof Error ? cause.message : String(cause) });
    });
  }
}

export async function ensureBuildRunning(buildId: string): Promise<boolean> {
  if (!runs.has(buildId)) await startQueuedBuilds();
  return runs.has(buildId);
}

async function startClaimedBuild(claim: QueuedClaim): Promise<boolean> {
  const projectRows = claim.projectId
    ? await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, claim.projectId)).limit(1)
    : [];
  const slug = projectRows[0]?.slug ?? claim.id;
  const resumeSessionId = await priorSessionId(claim.projectId, claim.id);
  const [current] = await db.select({ status: builds.status, error: builds.error }).from(builds).where(eq(builds.id, claim.id)).limit(1);
  if (current?.status !== "building") return false;
  const controller = new AbortController();
  if (current.error === STOP_REQUESTED) controller.abort(new Error(STOP_REQUESTED));
  runs.set(claim.id, { events: [], finished: false, listeners: new Set(), controller });
  // The run owns its slot until finally, independent of any HTTP request.
  void withBuildCancellation(controller.signal, () => drive(claim.id, claim.userId, claim.prompt, slug, claim.projectId, resumeSessionId, claim.attachments ?? []))
    .catch(function failed(cause: unknown) {
      logEvent("build", { event: "drive-cleanup-failed", buildId: claim.id, message: cause instanceof Error ? cause.message : String(cause) });
    });
  return true;
}

// Persist intent without releasing the slot or project while cleanup still runs.
// The guarded success update and this update serialize competing Stop/done requests.
export async function cancelBuild(buildId: string, userId: string, database: typeof db = db): Promise<{ stopping: boolean } | null> {
  if (await cancelQueuedBuild(buildId, userId, database)) return { stopping: false };
  const updated = await requestBuildStop(buildId, userId, database);
  if (updated) {
    const state = runs.get(buildId);
    state?.controller.abort(new Error(STOP_REQUESTED));
    if (state && !state.finished) emit(state, { phase: "note", stopping: true, text: "Stop requested. Finishing cleanup and recording any transaction already sent." });
    return { stopping: true };
  }
  return null;
}

export interface Attachment {
  replay: BuildEvent[];
  finished: boolean;
  subscribe: (listener: Listener) => () => void;
}

export function attach(buildId: string): Attachment | null {
  const state = runs.get(buildId);
  if (!state) {
    return null;
  }
  return {
    replay: [...state.events],
    finished: state.finished,
    subscribe(listener: Listener) {
      state.listeners.add(listener);
      return function unsubscribe() {
        state.listeners.delete(listener);
      };
    },
  };
}
