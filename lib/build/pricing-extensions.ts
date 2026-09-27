import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { workerBuildsEnabled } from "./durable/routing";
import { validateBudgetContinuation } from "./durable/continuation";
import { readBuildAllowance } from "./pricing-budget";
import { pricingDigest, quotedTotal, type PricingSnapshot } from "./pricing-policy";
import { PricingError, type QuoteApproval } from "./pricing-quotes";

async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

async function lockOwner(client: PoolClient, userId: string, buildId: string): Promise<{ snapshot: PricingSnapshot; checkpoint: string; authorization: string; packages: number; state: string }> {
  await client.query('select id from "user" where id=$1 for update', [userId]);
  // Worker dispatch and Stop lock the job before its build; keep that order.
  const job = await client.query("select j.state,j.checkpoint_hash,j.stop_requested_at from build_worker_jobs j join builds b on b.id=j.build_id where j.build_id=$1 and b.user_id=$2 for update of j", [buildId, userId]);
  const build = await client.query("select pricing_snapshot from builds where id=$1 and user_id=$2 for update", [buildId, userId]);
  if (!build.rows[0]) throw new PricingError("Build not found.", 404);
  if (!build.rows[0].pricing_snapshot) throw new PricingError("This build keeps its original pricing agreement.");
  if (!job.rows[0] || job.rows[0].stop_requested_at) throw new PricingError("This build cannot accept another allowance.");
  const auth = await client.query("select id,packages from build_budget_authorizations where build_id=$1 order by packages desc limit 1", [buildId]);
  if (!auth.rows[0]) throw new PricingError("The accepted allowance is unavailable.");
  return { snapshot: build.rows[0].pricing_snapshot, checkpoint: job.rows[0].checkpoint_hash, authorization: auth.rows[0].id, packages: auth.rows[0].packages, state: job.rows[0].state };
}

export async function readOwnerBuildBudget(userId: string, buildId: string): Promise<unknown> {
  return transaction(async function read(client) {
    const current = await lockOwner(client, userId, buildId);
    const reading = await readBuildAllowance(client, buildId);
    return { ...reading, snapshot: current.snapshot, packages: current.packages, state: current.state,
      approvedMaximum: current.snapshot.fixedCredits * current.packages };
  });
}

export async function issueExtensionQuote(userId: string, buildId: string): Promise<unknown> {
  return transaction(async function issue(client) {
    if (!workerBuildsEnabled()) throw new PricingError("Priced builds require the budget-enabled worker.", 503);
    const current = await lockOwner(client, userId, buildId);
    await validateBudgetContinuation(client, buildId);
    const issued = await client.query("select count(*)::int as n from build_pricing_quotes where user_id=$1 and issued_at>clock_timestamp()-interval '1 hour'", [userId]);
    if (issued.rows[0].n >= 60) throw new PricingError("Too many price reviews. Try again later.", 429);
    const total = quotedTotal(current.snapshot, current.packages + 1);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + current.snapshot.quoteLifetimeSeconds * 1000).toISOString();
    const fingerprint = pricingDigest({ buildId, authorization: current.authorization, checkpoint: current.checkpoint });
    const digest = pricingDigest({ id, userId, fingerprint, snapshot: current.snapshot, expiresAt });
    await client.query(`insert into build_pricing_quotes(id,user_id,build_id,fingerprint,digest,snapshot,prior_authorization_id,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8)`, [id, userId, buildId, fingerprint, digest, current.snapshot, current.authorization, expiresAt]);
    return { id, digest, expiresAt, ...current.snapshot, approvedMaximum: total.credits, packages: current.packages + 1 };
  });
}

export async function acceptExtensionQuote(userId: string, buildId: string, approval: QuoteApproval): Promise<{ buildId: string; approvedMaximum: number }> {
  return transaction(async function accept(client) {
    await client.query('select id from "user" where id=$1 for update', [userId]);
    const previous = await client.query(`select a.build_id,a.quote_id,a.cumulative_credits,q.digest from build_budget_authorizations a
      join build_pricing_quotes q on q.id=a.quote_id where a.user_id=$1 and a.client_request_id=$2`, [userId, approval.requestId]);
    if (previous.rows[0]) {
      const row = previous.rows[0];
      if (row.build_id !== buildId || row.quote_id !== approval.quoteId || row.digest !== approval.digest) throw new PricingError("This approval ID was already used.");
      return { buildId, approvedMaximum: row.cumulative_credits };
    }
    if (!workerBuildsEnabled()) throw new PricingError("Priced builds require the budget-enabled worker.", 503);
    const current = await lockOwner(client, userId, buildId);
    const quote = (await client.query(`select *,expires_at<=clock_timestamp() as expired from build_pricing_quotes
      where id=$1 and user_id=$2 and build_id=$3 for update`, [approval.quoteId, userId, buildId])).rows[0];
    const fingerprint = pricingDigest({ buildId, authorization: current.authorization, checkpoint: current.checkpoint });
    if (!quote || quote.expired || quote.accepted_at || quote.digest !== approval.digest || quote.fingerprint !== fingerprint || quote.prior_authorization_id !== current.authorization) throw new PricingError("This allowance quote changed or expired. Review a fresh quote.");
    await validateBudgetContinuation(client, buildId);
    const total = quotedTotal(current.snapshot, current.packages + 1);
    const credits = current.snapshot.fixedCredits;
    if (credits > 0) {
      const balance = await client.query("select coalesce(sum(delta),0)::int as credits from credit_events where user_id=$1", [userId]);
      if (balance.rows[0].credits < credits) throw new PricingError("You do not have enough credits for this allowance.", 402);
    }
    const id = randomUUID();
    await client.query(`insert into build_budget_authorizations(id,user_id,build_id,quote_id,prior_authorization_id,packages,incremental_credits,cumulative_credits,allowance,client_request_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, userId, buildId, quote.id, current.authorization, current.packages + 1, credits, total.credits, total.allowance, approval.requestId]);
    if (credits) await client.query("insert into credit_events(id,user_id,delta,reason,build_id,idempotency_key) values($1,$2,$3,'build_reserve',$4,$5)", [randomUUID(), userId, -credits, buildId, `reserve:${id}`]);
    await client.query("update build_pricing_quotes set accepted_build_id=$1,accepted_at=clock_timestamp() where id=$2", [buildId, quote.id]);
    await client.query("update build_worker_jobs set state='queued',owner_id=null,fence=null,lease_expires_at=null,heartbeat_at=null,recovery_reason=null where build_id=$1", [buildId]);
    await client.query("update builds set status='queued',error=null where id=$1", [buildId]);
    return { buildId, approvedMaximum: total.credits };
  });
}
