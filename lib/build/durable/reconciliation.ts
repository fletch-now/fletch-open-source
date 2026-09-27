import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, open, readlink, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { getAddress, keccak256, parseTransaction, TransactionReceiptNotFoundError, type Hex } from "viem";
import { getChainClient } from "@/lib/chain/rpc";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { RH_TESTNET_ID } from "@/lib/config";
import { withSiteLock } from "@/lib/hosting/site-lock";
import { sitesRoot } from "@/lib/hosting/publish";
import { creationData, type DeployResult } from "@/lib/build/deploy";
import { appendWorkerEvent, workerTransaction, type Receipt } from "./ownership";
import { removeOwnedContainer } from "./execution";

type SuccessfulDeploy = Extract<DeployResult, { ok: true }>;
interface Snapshot {
  fence: string;
  attempt: number;
  owner_id: string;
  sandbox_id: string | null;
  kind: "deployment" | "publication";
  detail: Receipt | null;
}
export interface ReconciliationOptions {
  buildId: string;
  effectKey: string;
  apply?: boolean;
  // The CLI verifies the actual service/cgroup is stopped. A lease expiry
  // alone cannot prove a host publication subprocess has exited.
  verifyWorkerStopped: () => Promise<void>;
}
export interface ReconciliationReport {
  buildId: string;
  effectKey: string;
  kind: string;
  outcome: "held" | "ready" | "applied";
  reason: string;
  txHash?: string;
}

async function snapshot(pool: Pool, options: ReconciliationOptions): Promise<Snapshot> {
  const result = await pool.query<Snapshot>(`
    select j.fence,j.attempt,j.owner_id,b.sandbox_id,e.kind,v.detail
    from build_worker_jobs j join builds b on b.id=j.build_id
    join build_worker_effects e on e.build_id=j.build_id and e.effect_key=$2
    left join lateral (select detail from build_worker_events where build_id=j.build_id and attempt=j.attempt
      and kind=case e.kind when 'deployment' then 'transaction_prepared' else 'publication_prepared' end
      and detail->>'effectKey'=e.effect_key order by seq desc limit 1) v on true
    where j.build_id=$1 and j.state='recovery_required' and e.state='uncertain' and e.attempt=j.attempt
      and e.kind in ('deployment','publication') and (j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp())
  `, [options.buildId, options.effectKey]);
  if (!result.rows[0]) throw new Error("No paused uncertain effect with an expired owner was found.");
  return result.rows[0];
}

async function currentRelease(site: string): Promise<string | null> {
  try { return await readlink(join(site, "current")); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
}

async function publicationDirectoryExists(site: string): Promise<boolean> {
  try {
    const info = await lstat(site);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Publication site is not a regular directory.");
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

async function reconcileWorkerEffectInternal(pool: Pool, options: ReconciliationOptions): Promise<ReconciliationReport> {
  const saved = await snapshot(pool, options);
  const report: ReconciliationReport = { buildId: options.buildId, effectKey: options.effectKey, kind: saved.kind, outcome: "held", reason: "External outcome remains unknown." };
  let receipt: Receipt;
  let restorePublication: (() => Promise<void>) | undefined;
  if (!saved.detail) {
    receipt = { outcome: "not_dispatched", reconciled: true };
    report.reason = "No preparation was committed. After verified owner cleanup, this effect can finish without dispatch.";
  } else if (saved.kind === "deployment") {
    const detail = saved.detail;
    if (detail.chainId !== RH_TESTNET_ID || typeof detail.txHash !== "string" || typeof detail.signedTransaction !== "string"
      || keccak256(detail.signedTransaction as Hex) !== detail.txHash || typeof detail.sender !== "string") {
      throw new Error("The saved transaction identity is incomplete or inconsistent.");
    }
    report.txHash = detail.txHash;
    const client = getChainClient(RH_TESTNET_ID);
    if (await client.getChainId() !== RH_TESTNET_ID) throw new Error("The receipt endpoint returned the wrong chain.");
    let mined;
    try { mined = await client.getTransactionReceipt({ hash: detail.txHash as Hex }); }
    catch (cause) {
      if (cause instanceof TransactionReceiptNotFoundError) return { ...report, reason: "No receipt is available. Keep this project reserved; do not send another transaction." };
      throw cause;
    }
    if (mined.transactionHash !== detail.txHash || getAddress(mined.from) !== getAddress(detail.sender) || mined.to !== null) throw new Error("Receipt does not match the prepared deployment.");
    const block = await client.getBlock({ blockNumber: mined.blockNumber });
    if (block.hash !== mined.blockHash) throw new Error("The receipt block is no longer canonical.");
    let result: DeployResult;
    if (mined.status === "reverted") result = { ok: false, skipped: false, error: `Deploy transaction ${detail.txHash} reverted.` };
    else {
      const deployment = detail.deployment as Partial<SuccessfulDeploy> | undefined;
      if (!mined.contractAddress || !deployment?.bytecode || !Array.isArray(deployment.abi) || typeof deployment.contractName !== "string"
        || typeof deployment.contractPath !== "string" || deployment.bytecodeHash !== detail.bytecodeHash || keccak256(deployment.bytecode) !== detail.bytecodeHash) throw new Error("The confirmed deployment lacks its saved contract metadata.");
      const signed = parseTransaction(detail.signedTransaction as Hex);
      if (signed.chainId !== RH_TESTNET_ID || signed.to || signed.data !== creationData(deployment.abi, deployment.bytecode, deployment.owner ?? null)) {
        throw new Error("Saved contract metadata does not match the signed deployment transaction.");
      }
      result = { ...deployment, ok: true, address: mined.contractAddress, txHash: detail.txHash,
        explorerUrl: explorerAddressUrl(RH_TESTNET_ID, mined.contractAddress), reused: false } as SuccessfulDeploy;
    }
    receipt = { outcome: "returned", result, reconciled: true, blockHash: mined.blockHash, blockNumber: mined.blockNumber.toString() };
    report.reason = result.ok ? "The exact transaction has a canonical success receipt; its contract will be retained." : "The exact transaction has a canonical revert receipt.";
  } else {
    const { slug, buildId, previousRelease } = saved.detail;
    if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug) || buildId !== options.buildId
      || previousRelease !== null && (typeof previousRelease !== "string" || !/^[a-zA-Z0-9_-]+$/.test(previousRelease))) throw new Error("The saved publication identity is invalid.");
    const site = join(sitesRoot(), slug);
    const sitePresent = await publicationDirectoryExists(site);
    if (!sitePresent && previousRelease !== null) return { ...report, reason: "The saved previous publication directory is missing. Keep the project reserved." };
    if (previousRelease) {
      const previous = await lstat(join(site, previousRelease as string));
      if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error("The previous release is unavailable.");
    }
    const observed = await currentRelease(site);
    if (observed !== options.buildId && observed !== previousRelease) return { ...report, reason: "Current publication matches neither this attempt nor its saved previous release. Keep the project reserved." };
    restorePublication = async function restore() {
      if (!sitePresent) {
        if (await publicationDirectoryExists(site)) throw new Error("Publication directory appeared during reconciliation.");
        return;
      }
      if (await currentRelease(site) !== observed) throw new Error("Publication changed during reconciliation.");
      if (observed === previousRelease) return;
      if (previousRelease === null) await rm(join(site, "current"));
      else {
        const swap = join(site, `reconcile-${randomUUID()}`);
        try { await symlink(previousRelease as string, swap); await rename(swap, join(site, "current")); }
        finally { await rm(swap, { force: true }); }
      }
      const directory = await open(site, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    };
    receipt = { outcome: "returned", result: { ok: false, error: "The interrupted publication was rolled back to its previous release." }, reconciled: true, previousRelease };
    report.reason = sitePresent
      ? "The recorded publication identity matches; retain the previous release and finish this effect without republishing."
      : "This first publication has no site directory. Finish only after owner cleanup confirms it is still absent.";
  }
  if (!options.apply) return { ...report, outcome: "ready", reason: `${report.reason} Apply requires the worker service and its process group to be stopped.` };
  await options.verifyWorkerStopped();
  if (saved.sandbox_id) await removeOwnedContainer(saved.sandbox_id);
  await workerTransaction(pool, async function apply(client) {
    const locked = await client.query(`
      select j.build_id from build_worker_jobs j join builds b on b.id=j.build_id
      where j.build_id=$1 and j.state='recovery_required' and j.fence=$2 and j.attempt=$3 and j.owner_id=$4
        and b.sandbox_id is not distinct from $5 and (j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp())
      for update of j,b
    `, [options.buildId, saved.fence, saved.attempt, saved.owner_id, saved.sandbox_id]);
    if (!locked.rows[0]) throw new Error("The paused attempt changed during reconciliation.");
    const effect = await client.query("select state from build_worker_effects where build_id=$1 and effect_key=$2 and attempt=$3 for update", [options.buildId, options.effectKey, saved.attempt]);
    if (effect.rows[0]?.state !== "uncertain") throw new Error("This effect was already reconciled.");
    await options.verifyWorkerStopped();
    if (!saved.detail) {
      const prepared = await client.query(`select 1 from build_worker_events where build_id=$1 and attempt=$2
        and kind in ('transaction_prepared','publication_prepared') and detail->>'effectKey'=$3 limit 1`,
      [options.buildId, saved.attempt, options.effectKey]);
      if (prepared.rows[0]) throw new Error("Preparation appeared during reconciliation; inspect its external outcome first.");
    }
    await restorePublication?.();
    await client.query("update build_worker_effects set state='completed',receipt=$3,completed_at=clock_timestamp() where build_id=$1 and effect_key=$2", [options.buildId, options.effectKey, receipt]);
    await client.query("update builds set sandbox_id=null where id=$1", [options.buildId]);
    await appendWorkerEvent(client, options.buildId, "operator_reconciled", { effectKey: options.effectKey, kind: saved.kind, fence: saved.fence });
  });
  return { ...report, outcome: "applied" };
}

export async function reconcileWorkerEffect(pool: Pool, options: ReconciliationOptions): Promise<ReconciliationReport> {
  if (!options.apply) return reconcileWorkerEffectInternal(pool, options);
  const saved = await snapshot(pool, options);
  if (saved.kind !== "publication" || typeof saved.detail?.slug !== "string") return reconcileWorkerEffectInternal(pool, options);
  return withSiteLock(sitesRoot(), saved.detail.slug, async function reconcile(signal) {
    signal.throwIfAborted();
    return reconcileWorkerEffectInternal(pool, options);
  }, { database: pool });
}
