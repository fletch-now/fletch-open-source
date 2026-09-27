import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { snapshotSelection, type ExecutionSnapshot } from "@/lib/agent/user-keys";
import { validateAttachments } from "./attachment-images";
import type { BuildAttachment } from "./types";
import type { BuildSelection } from "@/lib/agent/selection";
import { PricingPolicySchema, packageSnapshot, pricingDigest, type PricingSnapshot, type PricingTier, type PublishedPricingPolicy } from "./pricing-policy";
import { workerBuildsEnabled } from "./durable/routing";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface QuoteApproval { quoteId: string; digest: string; requestId: string }
export interface PreparedQuote { id: string; digest: string; snapshot: PricingSnapshot; requestId: string }
export class PricingError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "PricingError"; }
}
export interface QuoteInput { prompt: string; projectId?: string; attachments?: BuildAttachment[]; selection: BuildSelection; tier: PricingTier }

export async function activePricing(tx: Transaction): Promise<PublishedPricingPolicy | null> {
  const result = await tx.execute<{ value: string }>(sql`select value from app_settings where key='build.pricing.active'`);
  if (!result.rows[0]) return null;
  const pointer = JSON.parse(result.rows[0].value);
  const record = await tx.execute<{ value: string }>(sql`select value from app_settings where key=${`build.pricing.policy.${pointer.version}`}`);
  if (!record.rows[0]) throw new PricingError("Pricing is temporarily unavailable.", 503);
  const published = JSON.parse(record.rows[0].value) as PublishedPricingPolicy;
  published.policy = PricingPolicySchema.parse(published.policy);
  if (published.digest !== pointer.digest || pricingDigest(published.policy) !== published.digest) throw new PricingError("Pricing is temporarily unavailable.", 503);
  if (!workerBuildsEnabled()) throw new PricingError("Priced builds require the budget-enabled worker.", 503);
  return published;
}

async function contextFingerprint(tx: Transaction, userId: string, projectId: string | undefined): Promise<unknown> {
  if (!projectId) return null;
  const result = await tx.execute(sql`select p.id,p.source_r2_key,p.preview_url,
    (select id from builds where project_id=p.id order by created_at desc,id desc limit 1) as latest_build,
    (select j.checkpoint_hash from builds b left join build_worker_jobs j on j.build_id=b.id where b.project_id=p.id order by b.created_at desc,b.id desc limit 1) as source_checkpoint
    from projects p where id=${projectId} and user_id=${userId} for update`);
  if (!result.rows[0]) throw new PricingError("Project not found.", 404);
  return result.rows[0];
}

export async function quoteFingerprint(tx: Transaction, userId: string, input: Omit<QuoteInput, "tier">, execution: ExecutionSnapshot): Promise<string> {
  return pricingDigest({ prompt: pricingDigest(input.prompt), attachments: (input.attachments ?? []).map(file => pricingDigest(file)),
    context: await contextFingerprint(tx, userId, input.projectId), execution,
    image: process.env.FORGE_AGENT_IMAGE ?? null, chainId: 46630 });
}

export async function issueBuildQuote(userId: string, input: QuoteInput): Promise<unknown> {
  const attachments = await validateAttachments(input.attachments ?? []);
  return db.transaction(async function issue(tx) {
    const user = await tx.execute(sql`select id from "user" where id=${userId} for update`);
    if (!user.rowCount) throw new PricingError("Sign in to build.", 401);
    const published = await activePricing(tx);
    if (!published) return { legacy: true, credits: input.selection.billingMode === "own_key" ? 0 : 1 };
    const issued = await tx.execute<{ n: number }>(sql`select count(*)::int as n from build_pricing_quotes where user_id=${userId} and issued_at>clock_timestamp()-interval '1 hour'`);
    if (issued.rows[0].n >= 60) throw new PricingError("Too many price reviews. Try again later.", 429);
    const execution = await snapshotSelection(tx, userId, input.selection);
    const fingerprint = await quoteFingerprint(tx, userId, { ...input, attachments }, execution);
    const snapshot = packageSnapshot(published, input.tier, execution.billingMode === "own_key");
    const id = randomUUID(), expiresAt = new Date(Date.now() + published.policy.quoteLifetimeSeconds * 1000).toISOString();
    const digest = pricingDigest({ id, userId, fingerprint, snapshot, expiresAt });
    await tx.execute(sql`insert into build_pricing_quotes(id,user_id,project_id,fingerprint,digest,snapshot,expires_at)
      values(${id},${userId},${input.projectId ?? null},${fingerprint},${digest},${JSON.stringify(snapshot)}::jsonb,${expiresAt}::timestamptz)`);
    return { legacy: false, id, digest, expiresAt, ...snapshot, approvedMaximum: snapshot.fixedCredits,
      estimate: { mode: "fixed_package", additionalCredits: [0, snapshot.fixedCredits], note: "Work may pause at the included limit. Another package needs your approval; it is not charged automatically." },
      tiers: Object.entries(published.policy.tiers).map(([tier, pack]) => ({ tier, credits: execution.billingMode === "own_key" ? 0 : pack.credits, allowance: pack.allowance })) };
  });
}

export async function replayPricingAcceptance(tx: Transaction, userId: string, approval?: QuoteApproval): Promise<Record<string, unknown> | null> {
  if (!approval) return null;
  const result = await tx.execute(sql`select b.id as "buildId",b.project_id as "projectId",p.slug,b.billing_mode as "billingMode",b.custody_mode as "custodyMode",b.provider,b.model,b.credential_id as "credentialId",b.credential_version as "credentialVersion",b.capabilities,a.quote_id,q.digest
    from build_budget_authorizations a join builds b on b.id=a.build_id join projects p on p.id=b.project_id join build_pricing_quotes q on q.id=a.quote_id
    where a.user_id=${userId} and a.client_request_id=${approval.requestId} and q.build_id is null`);
  const previous = result.rows[0];
  if (!previous) return null;
  if (previous.quote_id !== approval.quoteId || previous.digest !== approval.digest) throw new PricingError("This request ID was already used for another agreement.");
  return previous;
}

export async function prepareQuoteAcceptance(tx: Transaction, userId: string, input: Omit<QuoteInput, "tier">, execution: ExecutionSnapshot, approval?: QuoteApproval): Promise<PreparedQuote | null> {
  if (!approval) {
    if (await activePricing(tx)) throw new PricingError("Review and approve the current build price before starting.");
    return null;
  }
  if (!workerBuildsEnabled()) throw new PricingError("Priced builds require the budget-enabled worker.", 503);
  const result = await tx.execute<{ id: string; fingerprint: string; digest: string; snapshot: PricingSnapshot; accepted_build_id: string | null; expired: boolean }>(sql`
    select *,expires_at<=clock_timestamp() as expired from build_pricing_quotes where id=${approval.quoteId} and user_id=${userId} and build_id is null for update`);
  const quote = result.rows[0];
  if (!quote || quote.expired || quote.accepted_build_id || quote.digest !== approval.digest) throw new PricingError("This quote changed, expired, or was already used. Review a fresh quote.");
  if (quote.fingerprint !== await quoteFingerprint(tx, userId, input, execution)) throw new PricingError("Your draft, project or connection changed. Review a fresh quote.");
  return { id: quote.id, digest: quote.digest, snapshot: quote.snapshot, requestId: approval.requestId };
}

export async function recordQuoteAcceptance(tx: Transaction, userId: string, buildId: string, quote: PreparedQuote): Promise<void> {
  const id = randomUUID();
  await tx.execute(sql`insert into build_budget_authorizations(id,user_id,build_id,quote_id,packages,incremental_credits,cumulative_credits,allowance,client_request_id)
    values(${id},${userId},${buildId},${quote.id},1,${quote.snapshot.fixedCredits},${quote.snapshot.fixedCredits},${JSON.stringify(quote.snapshot.allowance)}::jsonb,${quote.requestId})`);
  if (quote.snapshot.fixedCredits > 0) await tx.execute(sql`insert into credit_events(id,user_id,delta,reason,build_id,idempotency_key)
    values(${randomUUID()},${userId},${-quote.snapshot.fixedCredits},'build_reserve',${buildId},${`reserve:${id}`})`);
  await tx.execute(sql`update build_pricing_quotes set accepted_build_id=${buildId},accepted_at=clock_timestamp() where id=${quote.id}`);
}
