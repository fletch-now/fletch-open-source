import { AssetTable, type AssetTableRow } from "@/components/dashboard/registry/asset-table";
import { FilterBar } from "@/components/registry/filter-bar";
import { multiplierText, priceText } from "@/components/registry/format";
import { assetTrust, browseAssets, browseFacets, browseSummary, parseFilters } from "@/lib/registry/browse";
import { statesFor } from "@/lib/registry/authority/read";
import { ROBINHOOD_ASSETS_ENDPOINT } from "@/lib/registry/robinhood";
import { RH_MAINNET_ID } from "@/lib/config";

// Verbatim from docs/DEPLOY.md §9 "Registry sync timer" — the one-time install for
// the systemd timer that keeps this table from ever showing up empty in production.
const SYNC_TIMER_COMMAND = `cp scripts/fletch-registry-sync.service scripts/fletch-registry-sync.timer \\
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fletch-registry-sync.timer
systemctl list-timers fletch-registry-sync.timer`;

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function countText(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toLocaleString("en-US");
}

// Guests can browse — this is the trustworthy address book, not an account
// surface. Only the "Watch" link off each row needs a wallet, and that page
// (/dashboard/watch/new) already handles a signed-out visitor itself.
export default async function RegistryPage({ searchParams }: PageProps<"/dashboard/registry">) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const [rows, summary, facets] = await Promise.all([browseAssets(RH_MAINNET_ID, filters), browseSummary(RH_MAINNET_ID), browseFacets(RH_MAINNET_ID)]);
  const states = await statesFor(rows.map((row) => row.id));

  // The table is a client component (copy buttons), so every cell it shows is
  // rendered to text here rather than handing it a Map of state rows.
  const tableRows: AssetTableRow[] = rows.map(function toRow(row) {
    const state = states.get(row.id);
    return {
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      assetType: row.assetType,
      address: row.address,
      trust: assetTrust(row).level,
      verified: assetTrust(row).level === "verified",
      multiplier: multiplierText(state?.uiMultiplier),
      price: priceText(state?.feedPrice),
      holders: countText(state?.blockscoutHolders),
      lookalikes: row.lookalikeCount,
      paused: state?.tokenPaused === true || state?.oraclePaused === true,
      halted: state?.apiTradingHalt === true,
    };
  });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="display text-[26px] text-ink">Registry — Robinhood Chain {RH_MAINNET_ID}</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-6 text-ink-soft">
          Synced from Robinhood&apos;s public asset API ({ROBINHOOD_ASSETS_ENDPOINT}), checked on chain for bytecode, and kept
          live by the registry daemon: multiplier, Chainlink price, holders, pauses, halts and lookalikes.
        </p>
        {summary.total > 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-faint">
            {summary.total} assets, {summary.verified} checked on chain
            {summary.lastObservedAt ? `, last synced ${formatRelative(summary.lastObservedAt)}` : ""}. Each symbol opens a public
            page with the contract address, live state, lookalikes and a watch button.
          </p>
        ) : null}
      </div>

      {summary.total === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <p className="text-[15px] text-ink">Registry not synced yet.</p>
          <p className="mx-auto mt-2 max-w-lg text-[14px] leading-6 text-ink-soft">
            An operator needs to install the sync timer once (docs/DEPLOY.md §9):
          </p>
          <pre className="mx-auto mt-4 max-w-lg overflow-x-auto rounded-md border border-line bg-raised px-4 py-3 text-left font-mono text-[12px] leading-5 text-ink-soft">
            {SYNC_TIMER_COMMAND}
          </pre>
        </div>
      ) : (
        <>
          <FilterBar basePath="/dashboard/registry" filters={filters} facets={facets} typeCounts={summary.byType} shown={rows.length} />
          <div className="mt-6">
            <AssetTable rows={tableRows} />
          </div>
        </>
      )}
    </div>
  );
}
