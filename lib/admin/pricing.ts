import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { PricingPolicySchema, pricingDigest, type PricingPolicy, type PublishedPricingPolicy } from "@/lib/build/pricing-policy";

interface PricingActor { userId: string | null; name: string }
export interface PricingDraft { id: string; revision: number; digest: string; policy: PricingPolicy }

export async function savePricingDraft(actor: PricingActor, raw: unknown, id: string | null, revision: number): Promise<PricingDraft> {
  const policy = PricingPolicySchema.parse(raw);
  if (id && !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid draft ID.");
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid draft revision.");
  return db.transaction(async function save(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(46630,5701)`);
    const draftId = id ?? randomUUID(), key = `build.pricing.draft.${draftId}`;
    const existing = await tx.execute<{ value: string }>(sql`select value from app_settings where key=${key} for update`);
    const before = existing.rows[0] ? JSON.parse(existing.rows[0].value) as PricingDraft : null;
    if ((before?.revision ?? 0) !== revision) throw new Error("This draft changed. Reload before editing it.");
    const draft = { id: draftId, revision: revision + 1, digest: pricingDigest(policy), policy };
    await tx.execute(sql`insert into app_settings(key,value,updated_by) values(${key},${JSON.stringify(draft)},${actor.name})
      on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=clock_timestamp()`);
    await tx.execute(sql`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values(${`al_${randomUUID()}`},${actor.userId},'user','admin.pricing.draft','setting',${key},${JSON.stringify({ revision: draft.revision, digest: draft.digest })}::jsonb)`);
    return draft;
  });
}

export async function publishPricingDraft(actor: PricingActor, input: { id: string; revision: number; digest: string; expectedActive: string | null; reason: string }): Promise<PublishedPricingPolicy> {
  if (!input.reason.trim() || input.reason.length > 300) throw new Error("Give a publication reason (up to 300 characters).");
  return db.transaction(async function publish(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(46630,5701)`);
    const active = await tx.execute<{ value: string }>(sql`select value from app_settings where key='build.pricing.active' for update`);
    const previous = active.rows[0] ? JSON.parse(active.rows[0].value) : null;
    if ((previous?.version ?? null) !== input.expectedActive) throw new Error("The active policy changed. Review again before publishing.");
    const rows = await tx.execute<{ value: string }>(sql`select value from app_settings where key=${`build.pricing.draft.${input.id}`} for update`);
    if (!rows.rows[0]) throw new Error("Draft not found.");
    const draft = JSON.parse(rows.rows[0].value) as PricingDraft;
    const policy = PricingPolicySchema.parse(draft.policy);
    if (draft.revision !== input.revision || draft.digest !== input.digest || pricingDigest(policy) !== input.digest) throw new Error("The reviewed draft changed. Preview it again.");
    const published = { version: randomUUID(), digest: draft.digest, publishedAt: new Date().toISOString(), publishedBy: actor.userId ?? actor.name, policy };
    await tx.execute(sql`insert into app_settings(key,value,updated_by) values(${`build.pricing.policy.${published.version}`},${JSON.stringify(published)},${actor.name})`);
    await tx.execute(sql`insert into app_settings(key,value,updated_by) values('build.pricing.active',${JSON.stringify({ version: published.version, digest: published.digest })},${actor.name})
      on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=clock_timestamp()`);
    await tx.execute(sql`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values(${`al_${randomUUID()}`},${actor.userId},'user','admin.pricing.publish','setting','build.pricing.active',${JSON.stringify({ previous: previous?.version ?? null, version: published.version, digest: published.digest, reason: input.reason.trim() })}::jsonb)`);
    return published;
  });
}
