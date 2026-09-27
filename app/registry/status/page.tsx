import { RegistryPageIntro } from "@/components/registry/page-intro";
import { Suspense } from "react";
import { ago } from "@/components/registry/format";
import { ScoutingCoverage } from "@/components/registry/scouting-coverage";
import { AppCatalogHealth } from "@/components/registry/app-status";
import { readAppCatalog } from "@/lib/registry/app-catalog";
import { SwapIndexerPanel } from "@/components/registry/swap-indexer-reading";
import { publicPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { CheckpointedScanners, FigureTable, FreshnessBanner, JobTable, VerdictLegend } from "@/components/registry/freshness-panel";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { publicReadCache } from "@/lib/public-cache";
import { RH_MAINNET_ID } from "@/lib/config";
import { freshness, type Freshness } from "@/lib/registry/authority/freshness";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata("/registry/status");

// A reading runs roughly forty DB queries. Share it across visible tabs while
// retaining the original measured timestamp, matching the API's ten-second TTL.
const cachedReading = publicReadCache<Freshness>(10_000, 1);

export default function StatusPage(): React.ReactElement {

  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Registry status" actions={<><a href={`/api/v1/chains/${RH_MAINNET_ID}/status`}>JSON</a><Link href="/developers">API guide</Link><RefreshReading /></>}>
          Job results, observation ages and scan coverage. A running worker does not mean every source is current.
        </RegistryPageIntro>
        <Suspense fallback={<p role="status" className="rounded-lg border border-line p-5">Reading job status…</p>}><StatusReading /></Suspense>
      </main>
      <RegistryFooter />
    </div>
  );
}

async function StatusReading(): Promise<React.ReactElement> {
  const [reading, catalog] = await Promise.all([
    cachedReading(String(RH_MAINNET_ID), function read() { return freshness(RH_MAINNET_ID); }),
    readAppCatalog(),
  ]);
  const coverage = reading.lookalikes;
  const priority = ["failing", "stalled", "late", "never", "unread", "filling", "fresh"];
  const jobs = [...reading.jobs].sort((a, b) => priority.indexOf(a.verdict) - priority.indexOf(b.verdict));
  return <>
    <FreshnessBanner reading={reading} />
    <JobTable jobs={jobs} />
    {coverage ? <section className="mt-6 rounded-xl border border-line p-4" aria-labelledby="lookalike-coverage"><h2 id="lookalike-coverage" className="text-[17px] font-medium">Lookalike scan coverage</h2>
      <p className="mt-2 text-[14px]">{coverage.completed} of {coverage.assets} assets fully searched within six hours. {coverage.pending} pending; {coverage.failed} with failed searches.</p>
      <p className="mt-2 text-[13px] text-ink-soft">Each minute continues the saved search position. A successful pass does not mean the entire catalog has been checked. {coverage.beaconPending} contract checks pending; {coverage.beaconFailed} failed.</p>
      <p className="mt-2 text-[12px] text-ink-soft">Last source observation {coverage.lastObservedAt ? <time dateTime={coverage.lastObservedAt}>{ago(new Date(coverage.lastObservedAt))}</time> : "not yet"}. Local token scan last completed {coverage.localCompletedAt ? <time dateTime={coverage.localCompletedAt}>{ago(new Date(coverage.localCompletedAt))}</time> : "not yet"}.</p>
    </section> : null}
    <AppCatalogHealth reading={catalog} />
    {reading.scouting ? <ScoutingCoverage reading={reading.scouting} /> : <p role="status" className="my-4 rounded-lg border border-line p-4 text-[13px] text-ink-soft">Scouting coverage has not been published yet. The next completed priority scan records it.</p>}
    <SwapIndexerPanel reading={reading.swapIndexer} chainId={RH_MAINNET_ID} showStatusLink={false} />
    <details className="mt-6"><summary className="cursor-pointer text-[17px] font-medium">Historical scan checkpoints</summary><CheckpointedScanners jobs={reading.jobs} /></details>
    <FigureTable figures={reading.figures} />
    <VerdictLegend />
  </>;
}
