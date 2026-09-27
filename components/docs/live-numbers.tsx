import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { readPublicRegistryNumbers, registryNumberStats } from "@/lib/registry/public-numbers";

export async function DocsLiveNumbers(): Promise<ReactElement> {
  const numbers = await readPublicRegistryNumbers();
  const observations = numbers ? [
    { label: "Latest listing observation", at: numbers.observedAt.listings },
    { label: "Latest beacon check", at: numbers.observedAt.canonical },
    { label: "Latest feed read", at: numbers.observedAt.feeds },
    { label: "Last successful lookalike scan", at: numbers.observedAt.lookalikeScan },
    { label: "Latest recorded change", at: numbers.observedAt.changes },
  ] : [];

  return (
    <section aria-label="Recorded Registry numbers" className="mb-10 rounded-card border border-line bg-panel/40 p-5">
      <h2 className="text-[13px] font-medium uppercase tracking-[0.12em] text-ink-faint">Registry observations</h2>
      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3">
        {registryNumberStats(numbers).map(function stat(row) {
          return (
            <div key={row.label}>
              <dt className="text-[12px] leading-5 text-ink-soft">{row.label}</dt>
              <dd className="mt-1 font-mono text-[24px] leading-tight tabular-nums text-ink">{row.value}</dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-5 text-[12px] leading-5 text-ink-soft">
        {numbers ? <>Reading checked <time dateTime={numbers.checkedAt.toISOString()}>{numbers.checkedAt.toISOString()}</time>. {numbers.summary}</> : "This reading is unavailable. The counts will be retried on the next request."}{" "}
        <Link href="/registry/status" className="underline underline-offset-4">Inspect source status and coverage</Link>.
      </p>
      <p className="mt-3 text-[12px] leading-5 text-ink-soft">
        Verified listings require recorded bytecode confirmation and matching symbol and decimals. Beacon and feed totals count stored observations, including older readings. Scan matches exclude contracts recorded as unlisted Stock Tokens. Changes cover the last seven days of observation time.
      </p>
      {numbers ? (
        <>
          <dl className="mt-4 grid gap-x-5 gap-y-2 text-[11px] leading-5 sm:grid-cols-2">
            {observations.map(function observation(row) {
              return (
                <div key={row.label}>
                  <dt className="text-ink-faint">{row.label}</dt>
                  <dd className="font-mono tabular-nums text-ink-soft">{row.at ? <time dateTime={row.at.toISOString()}>{row.at.toISOString()}</time> : "unread"}</dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-3 text-[11px] leading-5 text-ink-faint">These are the newest source observations. Individual assets may be older and discovery may be incomplete. The shared reading is cached for up to ten seconds; the time above stays with that reading.</p>
        </>
      ) : null}
    </section>
  );
}
