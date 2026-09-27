import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/dal";
import { db } from "@/lib/db";
import { readHolderPolicy } from "@/lib/holder-rewards/store";
import { HolderPolicyForm } from "./form";

export const metadata = { title: "$FLTX holder credits", robots: { index: false, follow: false } };

export default async function HolderCreditsAdminPage(): Promise<React.ReactNode> {
  await requireAdmin();
  const [policy, recent] = await Promise.all([
    readHolderPolicy(),
    db.execute<{ id: string; address: string; credits: number; period: string; created_at: Date }>(sql`select id,address,credits,period,created_at from holder_credit_claims order by created_at desc limit 30`),
  ]);
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header><h1 className="display text-3xl">$FLTX holder credits</h1><p className="mt-2 text-sm leading-6 text-ink-soft">Configure the official token and reward terms. The feature starts off. Saving an enabled policy verifies the token and reference market first.</p></header>
      <HolderPolicyForm key={policy.revision} policy={policy} />
      <section className="overflow-hidden rounded-xl border border-line bg-raised">
        <h2 className="border-b border-line p-4 font-medium">Recent grants</h2>
        {recent.rows.length === 0 ? <p className="p-4 text-sm text-ink-soft">No holder credits have been awarded.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Wallet</th><th className="p-3">Period</th><th className="p-3">Credits</th><th className="p-3">Awarded (UTC)</th></tr></thead><tbody>
            {recent.rows.map(row => <tr key={row.id} className="border-t border-line"><td className="p-3 font-mono" title={row.address}>{row.address.slice(0, 8)}…{row.address.slice(-6)}</td><td className="p-3">{row.period}</td><td className="p-3">{row.credits}</td><td className="whitespace-nowrap p-3">{row.created_at.toISOString()}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}
