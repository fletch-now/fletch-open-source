import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/dal";
import type { PricingDraft } from "@/lib/admin/pricing";
import type { PublishedPricingPolicy } from "@/lib/build/pricing-policy";
import { PricingEditor, PricingPublisher } from "./forms";

export default async function PricingAdminPage({ searchParams }: { searchParams: Promise<{ draft?: string; copy?: string }> }): Promise<ReactElement> {
  await requireAdmin();
  const params = await searchParams;
  const result = await db.execute<{ key: string; value: string }>(sql`select key,value from app_settings where key like 'build.pricing.%' order by updated_at desc limit 100`);
  const records = new Map(result.rows.map(row => [row.key, JSON.parse(row.value)]));
  const activeRows = await db.execute<{ value: string }>(sql`select value from app_settings where key='build.pricing.active'`);
  const active = activeRows.rows[0] ? JSON.parse(activeRows.rows[0].value).version as string : null;
  const requiredKeys = [active ? `build.pricing.policy.${active}` : "", params.copy ? `build.pricing.policy.${params.copy}` : "", params.draft ? `build.pricing.draft.${params.draft}` : ""].filter(Boolean);
  for (const key of requiredKeys) {
    const row = await db.execute<{ value: string }>(sql`select value from app_settings where key=${key}`);
    if (row.rows[0]) records.set(key, JSON.parse(row.rows[0].value));
  }
  const draft = (records.get(`build.pricing.draft.${params.draft}`) ?? null) as PricingDraft | null;
  const copied = records.get(`build.pricing.policy.${params.copy}`) as PublishedPricingPolicy | undefined;
  const editor = copied ? { id: "", revision: 0, digest: copied.digest, policy: copied.policy } : draft;
  const current = records.get(`build.pricing.policy.${active}`) as PublishedPricingPolicy | undefined;
  return <main className="mx-auto w-full max-w-4xl space-y-8 p-6 text-ink">
    <header><h1 className="text-2xl font-medium">Build pricing</h1><p className="mt-2 text-sm">Testnet fixed packages. {active ? `Active version: ${active}` : "No policy published. Existing one-credit platform and zero-credit BYOK pricing remains active."}</p></header>
    <section><h2 className="mb-3 text-lg font-medium">Draft</h2><p className="mb-3 text-sm">Set each package’s credit price and included work, then set the shared limits. New fields are blank until you enter reviewed values. Save a draft to preview the terms before publishing; saving alone does not activate prices.</p><PricingEditor draft={editor} /></section>
    {draft ? <section><h2 className="text-lg font-medium">Review and settlement preview</h2><p className="mt-2 break-all text-xs">Revision {draft.revision} · {draft.digest}</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Package</th><th>Current → draft credits</th><th>Requests / platform tools / active minutes</th><th>Failure or Stop charge</th></tr></thead><tbody>{(["small", "medium", "large"] as const).map(function row(tier) { const pack = draft.policy.tiers[tier]; return <tr key={tier} className="border-t border-line"><td className="py-3 capitalize">{tier}</td><td>{current?.policy.tiers[tier].credits ?? "Legacy 1"} → {pack.credits}</td><td>{pack.allowance.modelRequests} / {pack.allowance.toolRuns} / {Math.round(pack.allowance.activeSeconds / 60)}</td><td>0 credits; full reserved amount released</td></tr>; })}</tbody></table></div><p className="mt-3 text-sm">Success costs the accepted fixed package price. An extra package requires separate approval. BYOK reserves and charges zero Fletch credits; provider cost remains unknown. Missing provider usage never creates an extra charge.</p><PricingPublisher draft={draft} active={active} /></section> : null}
    <section><h2 className="text-lg font-medium">Drafts and published versions</h2><ul className="mt-3 space-y-2 text-sm">{result.rows.filter(row => row.key !== "build.pricing.active").map(function item(row) { const published = row.key.startsWith("build.pricing.policy."); const id = row.key.split(".").at(-1); return <li key={row.key}><Link className="underline" href={`/trafalgar/pricing?${published ? "copy" : "draft"}=${id}`}>{published ? "Copy published prices into a new draft" : "Review draft"}: {id}</Link></li>; })}</ul><p className="mt-3 text-sm">To roll back, copy a previous version and publish it as a new reviewed policy. Published history is immutable.</p></section>
  </main>;
}
