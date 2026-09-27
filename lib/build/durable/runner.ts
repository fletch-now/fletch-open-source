import { settleBuildPricing } from "../pricing-budget";
import { BuildBudgetPause } from "./budget";
import { pauseAgentBudget, restoreAgentContinuation, queueCleanAgentContinuation } from "./continuation";
import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { getAddress } from "viem";
import { db, pool } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";
import { getBuilder } from "@/lib/build";
import { credentialStillActive, providerForBuild } from "@/lib/agent/user-keys";
import { revokeWorkerCredentials } from "@/lib/agent/credential-proxy";
import type { ProviderConfig } from "@/lib/agent/provider";
import { requestBuildStop } from "@/lib/build/queue";
import { priorSessionId } from "@/lib/agent/session";
import { walletsForUser } from "@/lib/wallets";
import { workspaceRoot } from "@/lib/build/workspace";
import { STOP_REQUESTED, withBuildCancellation } from "@/lib/build/cancellation";
import { RH_TESTNET_ID } from "@/lib/config";
import type { BuildCost } from "@/lib/build/kimi-builder";
import type { DeployResult } from "@/lib/build/deploy";
import type { BuildEvent, Builder } from "@/lib/build/types";
import { appendWorkerEvent, lockedWorkerClaim, recoverExpiredWorkers, workerTransaction, type WorkerClaim } from "./ownership";
import { removeOwnedContainer, withWorkerExecution, type BuildExecution } from "./execution";
import { runWorkerOnce, type WorkerOutcome } from "./worker";
import { createSourceCheckpoint } from "./checkpoints";
import { recoverBuildBrief } from "@/lib/build/recover-brief";
import { projectConversation } from "@/lib/build/project-conversation";

async function appendLog(client: PoolClient, buildId: string, event: BuildEvent): Promise<void> {
  event.at ??= new Date().toISOString();
  await client.query(`
    insert into build_logs(id,build_id,seq,level,chunk)
    select $1,$2,coalesce(max(seq),-1)+1,$3,$4 from build_logs where build_id=$2
  `, [randomUUID(), buildId, event.phase, JSON.stringify(event)]);
}

async function ownedWrite(claim: WorkerClaim, write: (client: PoolClient) => Promise<void>): Promise<void> {
  await workerTransaction(pool, async function fenced(client) {
    await lockedWorkerClaim(client, claim, true);
    await write(client);
  });
}

async function saveContract(client: PoolClient, buildId: string, event: BuildEvent): Promise<void> {
  if (!event.contractAddress) return;
  const insert = drizzle(client).insert(contracts).values({
    id: `${buildId}:contract`, buildId, chainId: RH_TESTNET_ID, address: event.contractAddress,
    txHash: event.txHash ?? null, abi: event.abi ?? null, sourceHash: event.bytecodeHash ?? null,
    bytecode: event.bytecode ?? null, ownerAddress: event.owner ?? null, deployer: "platform",
    verified: event.verified === true, verifiedAt: event.verified === true ? new Date() : null,
    verifyError: event.verifyError ?? null, confirmedAt: new Date(),
  });
  // Address-only events carry no new explorer result. A failed lookup cannot
  // erase an earlier confirmation for this same deployed address.
  if (event.verified === undefined) {
    await insert.onConflictDoNothing({ target: contracts.id });
    return;
  }
  await insert.onConflictDoUpdate({ target: contracts.id, set: {
    verified: event.verified === true ? true : sql`${contracts.verified}`,
    verifiedAt: event.verified === true ? sql`coalesce(${contracts.verifiedAt}, ${new Date()})` : sql`${contracts.verifiedAt}`,
    verifyError: event.verifyError ?? null,
  }, setWhere: sql`lower(${contracts.address}) = lower(${event.contractAddress})` });
}

async function saveDeploymentReceipts(client: PoolClient, buildId: string): Promise<void> {
  const existing = await client.query("select 1 from contracts where id=$1", [`${buildId}:contract`]);
  if (existing.rows[0]) return;
  const receipts = await client.query<{ result: DeployResult }>(`
    select receipt->'result' as result from build_worker_effects
    where build_id=$1 and kind='deployment' and state='completed' and receipt->'result'->>'ok'='true'
    order by completed_at
  `, [buildId]);
  for (const { result } of receipts.rows) {
    if (!result.ok) continue;
    await saveContract(client, buildId, { phase: "deploying", text: "Confirmed deployment retained.",
      contractAddress: result.address, txHash: result.txHash ?? undefined, abi: [...result.abi],
      bytecodeHash: result.bytecodeHash, bytecode: result.bytecode, owner: result.owner ?? undefined,
    });
  }
}

async function refundBuild(client: PoolClient, buildId: string, userId: string): Promise<void> {
  if (await settleBuildPricing(client, buildId, "failed")) return;
  await client.query(`
    insert into credit_events(id,user_id,delta,reason,build_id,idempotency_key)
    select $1,user_id,-delta,'refund',build_id,$2 from credit_events
    where user_id=$3 and build_id=$4 and idempotency_key=$5 and reason='build_debit' and delta<0
      and not exists (select 1 from builds where id=$4 and billing_mode='own_key')
    on conflict (idempotency_key) do nothing
  `, [randomUUID(), `refund:${buildId}`, userId, buildId, `build_debit:${buildId}`]);
}

const INTERRUPTED_BUILD = "The build was interrupted. Your source files are saved. Restore the draft and submit it to continue.";

async function finishBuild(client: PoolClient, claim: WorkerClaim, event: BuildEvent, stopped: boolean, failureCheckpoint?: string): Promise<void> {
  await saveDeploymentReceipts(client, claim.buildId);
  if (failureCheckpoint) {
    const unsafe = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' and kind <> 'model' limit 1", [claim.buildId]);
    if (unsafe.rows[0]) throw new Error("An external effect needs reconciliation before failure settlement.");
    await client.query(`
      update build_worker_effects set state='completed',receipt=$2,completed_at=clock_timestamp()
      where build_id=$1 and state='uncertain' and kind='model'
    `, [claim.buildId, { outcome: stopped ? "cancelled_after_cleanup" : "failed_after_cleanup", usage: "unknown" }]);
    await client.query("update build_worker_jobs set checkpoint_hash=$2 where build_id=$1", [claim.buildId, failureCheckpoint]);
    await appendWorkerEvent(client, claim.buildId, "checkpoint", { hash: failureCheckpoint, stage: "failure_after_cleanup" });
  }
  // Confirmed sandbox/proxy cleanup ends local execution, while an aborted
  // model's provider charge remains explicitly unknown. Never replay it.
  if (stopped) await client.query(`
    update build_worker_effects set state='completed',receipt=$2,completed_at=clock_timestamp()
    where build_id=$1 and state='uncertain' and kind in ('model','tool')
  `, [claim.buildId, { outcome: "cancelled_after_cleanup", usage: "unknown" }]);
  const uncertain = await client.query("select kind from build_worker_effects where build_id=$1 and state='uncertain'", [claim.buildId]);
  if (uncertain.rows.length) throw new Error("An external request needs reconciliation before this build can finish.");
  const success = !stopped && event.phase === "done";
  const terminal: BuildEvent = stopped ? { phase: "error", text: STOP_REQUESTED } : event;
  const result = await client.query<{ user_id: string; project_id: string | null }>(`
    update builds set status=$2,error=$3,finished_at=clock_timestamp(),sandbox_id=null
    where id=$1 and status in ('provisioning','building','compiling')
      and ($4 or error is distinct from $5) returning user_id,project_id
  `, [claim.buildId, success ? "succeeded" : "failed", success ? null : terminal.text, stopped, STOP_REQUESTED]);
  const build = result.rows[0];
  if (!build) throw new Error("Build settlement lost ownership.");
  if (stopped || failureCheckpoint) await client.query("update builds set tokens_in=null,tokens_out=null,cost_usd=null where id=$1", [claim.buildId]);
  await saveContract(client, claim.buildId, terminal);
  if (success && terminal.previewUrl && build.project_id) {
    await client.query("update projects set preview_url=$2 where id=$1", [build.project_id, terminal.previewUrl]);
  }
  let pricingOutcome: "stopped" | "succeeded" | "failed" = success ? "succeeded" : "failed";
  if (stopped) pricingOutcome = "stopped";
  const priced = await settleBuildPricing(client, claim.buildId, pricingOutcome);
  if (!success && !priced) await refundBuild(client, claim.buildId, build.user_id);
  await appendLog(client, claim.buildId, terminal);
  await client.query("update build_worker_jobs set state=$2,lease_expires_at=null where build_id=$1", [claim.buildId, stopped ? "stopped" : "completed"]);
  await appendWorkerEvent(client, claim.buildId, "settled", { outcome: success ? "succeeded" : "failed", stopped });
}

async function settle(claim: WorkerClaim, event: BuildEvent, stopped: boolean, failureCheckpoint?: string): Promise<void> {
  await workerTransaction(pool, async function finish(client) {
    await lockedWorkerClaim(client, claim, stopped);
    await finishBuild(client, claim, event, stopped, failureCheckpoint);
  });
}

// Used only by the operator adapter after it proves prior-owner exit, removes
// the recorded sandbox and verifies an immutable copy of the current source.
export async function settleRecoveredModelFailure(client: PoolClient, claim: WorkerClaim, checkpointHash: string): Promise<void> {
  const result = await client.query<{ stop_requested_at: Date | null; error: string | null }>(`
    select j.stop_requested_at,b.error from build_worker_jobs j join builds b on b.id=j.build_id
    where j.build_id=$1 and j.owner_id=$2 and j.fence=$3 and j.attempt=$4
      and j.state='recovery_required' and j.lease_expires_at <= clock_timestamp()
    for update of j,b
  `, [claim.buildId, claim.ownerId, claim.fence, claim.attempt]);
  const job = result.rows[0];
  if (!job || !/^[a-f0-9]{64}$/.test(checkpointHash)) throw new Error("Recovery ownership or checkpoint changed.");
  const stopped = job.stop_requested_at !== null || job.error === STOP_REQUESTED;
  await finishBuild(client, claim, { phase: "error", text: INTERRUPTED_BUILD }, stopped, checkpointHash);
}

export interface ActualWorkerOptions {
  onClaim?: () => void;
  archiveRoot?: string;
  builder?: (options: Parameters<typeof getBuilder>[0]) => Builder;
  leaseMs?: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
}

export async function runBuildWorkerOnce(ownerId: string, options: ActualWorkerOptions = {}): Promise<WorkerOutcome> {
  const archiveRoot = options.archiveRoot ?? process.env.FORGE_CHECKPOINT_ROOT;
  if (!archiveRoot) throw new Error("The build worker requires FORGE_CHECKPOINT_ROOT on persistent storage.");
  let execution: BuildExecution | null = null;
  let provider: ProviderConfig | null = null;
  let terminal: BuildEvent = { phase: "error", text: "The build stopped before producing a final result. Source files were retained." };
  let writes = Promise.resolve();
  const totals: BuildCost = { inputTokens: 0, outputTokens: 0, usd: 0, model: "" };

  return runWorkerOnce(pool, ownerId, {
    async run(context) {
      const [build] = await db.select().from(builds).where(eq(builds.id, context.claim.buildId));
      if (!build) throw new Error("The accepted build is unavailable.");
      if (build.pricingSnapshot && !options.builder && process.env.FORGE_AGENT !== "cli") {
        throw new Error("Accepted allowances require the bounded CLI worker.");
      }
      if (context.claim.attempt > 1) {
        totals.inputTokens = build.tokensIn ?? 0;
        totals.outputTokens = build.tokensOut ?? 0;
        totals.usd = build.costUsd === null ? 0 : Number(build.costUsd);
        if (build.tokensIn === null || build.tokensOut === null) totals.usageComplete = false;
      }
      const [project] = build.projectId ? await db.select().from(projects).where(eq(projects.id, build.projectId)) : [];
      const slug = project?.slug ?? build.id;
      execution = {
        pool, claim: context.claim, workspace: join(workspaceRoot(), slug), archiveRoot, signal: context.signal,
        nextOperation: 0, activeKey: null, containers: new Set(),
      };
      const current = execution;
      if (context.claim.attempt !== 1) current.restoredContext = await restoreAgentContinuation(current);
      const own = await providerForBuild(build.userId, build.id);
      provider = own;
      const session = await priorSessionId(build.projectId, build.id);
      const wallets = await walletsForUser(build.userId);
      const deployed = build.projectId ? await db.select({ address: contracts.address, sourceHash: contracts.sourceHash })
        .from(contracts).innerJoin(builds, eq(contracts.buildId, builds.id))
        .where(and(eq(builds.projectId, build.projectId), ne(builds.id, build.id), isNotNull(contracts.sourceHash)))
        .orderBy(desc(contracts.createdAt)).limit(1) : [];
      const previous = deployed[0];
      const priorSuccess = build.projectId ? await db.select({ id: builds.id }).from(builds)
        .where(and(eq(builds.projectId, build.projectId), ne(builds.id, build.id), eq(builds.status, "succeeded"))).limit(1) : [];
      const builder = (options.builder ?? getBuilder)({
        provider: own, resumeSessionId: session,
        onCost(cost) {
          if (cost.usageComplete === false) totals.usageComplete = false;
          totals.inputTokens += cost.inputTokens; totals.outputTokens += cost.outputTokens; totals.usd += cost.usd;
          const snapshot = { ...totals };
          writes = writes.then(() => ownedWrite(context.claim, async function usage(client) {
            await client.query("update builds set tokens_in=$2,tokens_out=$3,cost_usd=$4 where id=$1", [build.id,
              snapshot.usageComplete === false ? null : snapshot.inputTokens,
              snapshot.usageComplete === false ? null : snapshot.outputTokens,
              snapshot.usageComplete === false || build.billingMode === "own_key" ? null : snapshot.usd,
            ]);
          }));
          void writes.catch(function observed() {});
        },
        onNeeds(verdict, overridden) {
          writes = writes.then(() => ownedWrite(context.claim, async function needs(client) {
            await drizzle(client).update(builds).set({ needsContract: verdict.contract, needsWallet: verdict.wallet,
              needsReason: verdict.reason, needsSource: verdict.source, needsOverridden: overridden }).where(eq(builds.id, build.id));
          }));
          void writes.catch(function observed() {});
        },
        async onSession(id) {
          await ownedWrite(context.claim, async function session(client) { await client.query("update builds set agent_session_id=$2 where id=$1", [build.id, id]); });
        },
        async onBroadcast(txHash) {
          await ownedWrite(context.claim, async function broadcast(client) {
            await appendLog(client, build.id, { phase: "deploying", text: `Transaction broadcast: ${txHash}. Waiting for its receipt.`, txHash });
          });
        },
      });
      await withBuildCancellation(context.signal, () => withWorkerExecution(current, async function drive() {
        let terminalSeen = false;
        const input = await recoverBuildBrief(pool, { buildId: build.id, slug, prompt: build.prompt, attachments: build.attachments ?? [],
          previousContract: previous?.sourceHash ? { address: previous.address, bytecodeHash: previous.sourceHash } : null,
          previousBuildSucceeded: priorSuccess.length > 0, ownerAddress: wallets[0] ? getAddress(wallets[0]) : null,
          projectConversation: await projectConversation(pool, build.id, build.userId, build.projectId),
        }, build.userId, build.projectId);
        for await (const event of builder.run(input)) {
          await writes;
          if (event.contractAddress) await ownedWrite(context.claim, (client) => saveContract(client, build.id, event));
          context.signal.throwIfAborted();
          if (event.phase === "done" || event.phase === "error") {
            if (!terminalSeen) terminal = event;
            terminalSeen = true;
            current.allowOperations = false;
            continue;
          }
          if (terminalSeen) continue;
          await ownedWrite(context.claim, (client) => appendLog(client, build.id, event));
        }
      }));
      await writes;
    },
    async cleanup(claim) {
      await revokeWorkerCredentials(claim);
      if (execution) {
        for (const name of execution.containers) await removeOwnedContainer(name);
        execution.containers.clear();
      }
      await writes;
    },
    async settle(claim, stopped) {
      await settle(claim, terminal, stopped);
    },
    async pauseAfterCleanup(_claim, cause) {
      if (!(cause instanceof BuildBudgetPause) || !execution?.continuationContext || !execution.cleanSession) return false;
      await pauseAgentBudget(execution, cause.reason);
      return true;
    },
    async failAfterCleanup(claim, cause) {
      const unsafe = await pool.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' and kind <> 'model' limit 1", [claim.buildId]);
      if (unsafe.rows[0]) return false;
      let checkpoint: string | undefined;
      if (execution) {
        const current = execution;
        await mkdir(current.workspace, { recursive: true });
        const saved = await createSourceCheckpoint({
          workspace: current.workspace, archiveRoot, buildId: claim.buildId, attempt: claim.attempt, stage: "failure_after_cleanup",
          async assertQuiescent() {
            await ownedWrite(claim, async function checked() {});
            if (current.containers.size) throw new Error("Sandbox cleanup is incomplete.");
          },
        });
        checkpoint = saved.hash;
      }
      let text = INTERRUPTED_BUILD;
      if (cause instanceof Error && ["BuildSelectionError", "NeedsAnalysisError", "BuildBriefError"].includes(cause.name)) text = cause.message;
      if (cause instanceof BuildBudgetPause) text = "This build reached its allowance outside a resumable step. Your source is saved and reserved Fletch credits were released.";
      await settle(claim, { phase: "error", text }, false, checkpoint);
      return true;
    },
    async heartbeat() {
      if (provider?.credentialId && !await credentialStillActive(provider) && provider.buildId && provider.ownerId) {
        await requestBuildStop(provider.buildId, provider.ownerId);
      }
    },
  }, { leaseMs: options.leaseMs, heartbeatMs: options.heartbeatMs, signal: options.signal, onClaim: options.onClaim });
}

export async function reconcileLostBuildWorkers(): Promise<number> {
  await recoverExpiredWorkers(pool);
  const paused = await pool.query<{ build_id: string; sandbox_id: string | null; slug: string | null; state: string }>(`
    select j.build_id,b.sandbox_id,p.slug,j.state from build_worker_jobs j join builds b on b.id=j.build_id
    left join projects p on p.id=b.project_id
    where j.state in ('recovery_required','paused_budget')
  `);
  for (const build of paused.rows) {
    const archiveRoot = process.env.FORGE_CHECKPOINT_ROOT;
    if (build.state === "recovery_required" && !build.sandbox_id && archiveRoot) {
      const queued = await queueCleanAgentContinuation({ pool, archiveRoot, workspace: join(workspaceRoot(), build.slug ?? build.build_id) }, build.build_id).catch(async function reportRecovery(cause) {
        const reason = cause instanceof Error ? cause.message : "Saved continuation could not be verified.";
        await pool.query("update build_worker_jobs set recovery_reason=$2 where build_id=$1 and state='recovery_required' and recovery_reason is distinct from $2", [build.build_id, reason]);
        return false;
      });
      if (queued) continue;
    }
    if (build.sandbox_id) await removeOwnedContainer(build.sandbox_id);
    await workerTransaction(pool, async function reconcile(client) {
      const locked = await client.query("select build_id,state from build_worker_jobs where build_id=$1 and state in ('recovery_required','paused_budget') for update", [build.build_id]);
      if (!locked.rows[0]) return;
      const result = await client.query<{ user_id: string; error: string | null }>("select user_id,error from builds where id=$1 for update", [build.build_id]);
      const current = result.rows[0];
      if (locked.rows[0].state === "paused_budget" && current?.error !== STOP_REQUESTED) {
        const expired = await client.query(`select 1 from builds b where b.id=$1 and
          (select created_at from build_worker_events where build_id=b.id and kind='budget_paused' order by seq desc limit 1)
          + (b.pricing_snapshot->>'approvalWindowSeconds')::integer * interval '1 second' <= clock_timestamp()`, [build.build_id]);
        if (!expired.rowCount) return;
        current.error = "The allowance approval window ended. Your source is saved and reserved Fletch credits were released.";
        await client.query("update builds set error=$2 where id=$1", [build.build_id, current.error]);
      }
      await saveDeploymentReceipts(client, build.build_id);
      await client.query("update builds set sandbox_id=null,tokens_in=null,tokens_out=null,cost_usd=null where id=$1", [build.build_id]);
      const uncertain = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' and kind in ('deployment','publication') limit 1", [build.build_id]);
      if ((current?.error === STOP_REQUESTED || locked.rows[0].state === "paused_budget") && !uncertain.rows[0]) {
        await client.query("update build_worker_effects set state='completed',receipt=$2,completed_at=clock_timestamp() where build_id=$1 and state='uncertain'", [build.build_id, { outcome: "cancelled_after_cleanup", usage: "unknown" }]);
        await client.query("update builds set status='failed',finished_at=clock_timestamp() where id=$1", [build.build_id]);
        const priced = await settleBuildPricing(client, build.build_id, current.error === STOP_REQUESTED ? "stopped" : "failed");
        if (!priced) await refundBuild(client, build.build_id, current.user_id);
        await appendLog(client, build.build_id, { phase: "error", text: current.error ?? STOP_REQUESTED });
        await client.query("update build_worker_jobs set state='stopped',stop_requested_at=coalesce(stop_requested_at,clock_timestamp()) where build_id=$1", [build.build_id]);
        await appendWorkerEvent(client, build.build_id, "settled", { outcome: "failed", stopped: true, recovered: true });
        return;
      }
      const notice = await client.query("select 1 from build_worker_events where build_id=$1 and kind='recovery_notice' limit 1", [build.build_id]);
      if (!notice.rows[0]) {
        await appendLog(client, build.build_id, { phase: "note", text: "Your source files are saved. This build is paused while we check an interruption." });
        await appendWorkerEvent(client, build.build_id, "recovery_notice", {});
      }
    });
  }
  return paused.rows.length;
}
