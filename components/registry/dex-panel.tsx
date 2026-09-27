import { TableShell } from "@/components/registry/table-shell";
import { stateReadIsCurrent } from "@/lib/registry/authority/dex-state-freshness";
import { zeroAddress } from "viem";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { DexPool, VenueScan } from "@/lib/registry/authority/dex";
import type { AssetState } from "@/lib/registry/authority/read";
import { venueTitle } from "@/lib/registry/authority/constants";
import { blockText, shortHex } from "@/components/registry/format";

interface DexPanelProps {
  symbol: string;
  chainId: number;
  pools: DexPool[];
  symbols: Map<string, string>;
  state: AssetState | null;
  scans: VenueScan[];
}

// What the pool list can and cannot be trusted to be complete about. A venue
// whose discovery has never run holds pools nobody has looked for, and one
// still reading history holds pools not reached yet; either way the page says
// so rather than implying the list is the whole market.
function discoveryNote(scans: VenueScan[]): string | null {
  const parts: string[] = [];
  const never = scans.filter((scan) => !scan.scanned);
  if (never.length > 0) {
    parts.push(`${never.map((scan) => venueTitle(scan.venue)).join(" and ")} pool discovery has not run yet, so no pool from there is listed.`);
  }
  const filling = scans.filter((scan) => scan.filling);
  if (filling.length > 0) {
    const where = filling.map((scan) => `${venueTitle(scan.venue)} at block ${blockText(scan.block)} of ${blockText(scan.head)}`).join("; ");
    parts.push(`Pool discovery is still reading history (${where}), so a pool created outside the blocks read so far is not listed yet.`);
  }
  return parts.length === 0 ? null : parts.join(" ");
}

function emptyText(symbol: string, scans: VenueScan[]): string {
  const read = scans.filter((scan) => scan.scanned);
  if (read.length === 0) {
    return "Pool discovery has not run yet.";
  }
  return `No pool on ${read.map((scan) => venueTitle(scan.venue)).join(" or ")} trades ${symbol} against a listed quote.`;
}

function money(value: string | number | null): string {
  if (value === null || value === "") {
    return "—";
  }
  const n = Number(value);
  return n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`;
}

function liquidityText(value: string | null): string {
  if (!value) {
    return "—";
  }
  const n = Number(value.split(".")[0]);
  if (n >= 1e18) {
    return `${(n / 1e18).toFixed(2)}e18`;
  }
  return n.toLocaleString("en-US");
}

function poolPriceText(pool: DexPool, quote: string): string {
  if (!stateReadIsCurrent(pool.stateCheckedAt)) return pool.stateCheckedAt ? "— stale" : "— unread";
  if (pool.priceUsd) {
    return money(pool.priceUsd);
  }
  if (pool.priceInQuote) {
    return `${Number(pool.priceInQuote).toPrecision(4)} ${quote}`;
  }
  return "—";
}

function countText(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function premiumText(value: string | null): { text: string; tone: string } {
  if (!value) {
    return { text: "—", tone: "text-ink-faint" };
  }
  const n = Number(value);
  const tone = Math.abs(n) > 2 ? "text-amber-700" : "text-hood-deep";
  return { text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`, tone };
}

export function DexPanel({ symbol, chainId, pools, symbols, state, scans }: DexPanelProps) {
  const premium = premiumText(state?.dexPremiumPct ?? null);
  const bestVenue = pools.find((pool) => pool.id === state?.dexPoolId)?.venue ?? null;
  const note = discoveryNote(scans);
  return (
    <section id="dex" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">On the DEX</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        Recorded Uniswap v4 and v3 pools that trade {symbol}, with the price each reports and activity over its indexed 24-hour window. V3 quote holdings and V4 bounded 1% estimates are different measurements and remain separate.
        {state && stateReadIsCurrent(state.dexCheckedAt) ? (
          <>
            {" "}
            The selected pool{bestVenue ? ` (${venueTitle(bestVenue)})` : ""} prices {symbol} at {money(state.dexPriceUsd)},{" "}
            <span className={premium.tone}>{premium.text}</span> against the Chainlink feed, which already includes the multiplier.
          </>
        ) : null}{" "}
        <a href={`/api/v1/chains/${chainId}/assets/${encodeURIComponent(symbol)}/pools`} className="underline underline-offset-4 hover:text-ink">
          Pools as JSON
        </a>
        .
      </p>
      {pools.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-5 py-6 text-[14px] text-ink-soft">{emptyText(symbol, scans)}</p>
      ) : (
        <TableShell label="Dex Panel" className="mt-4">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="px-4 py-3 font-medium">Pair</th>
                <th className="px-4 py-3 font-medium">Venue</th>
                <th className="px-4 py-3 font-medium">Fee</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Quote holdings / 1% estimate</th>
                <th className="px-4 py-3 text-right font-medium">Liquidity (L)</th>
                <th className="px-4 py-3 text-right font-medium">Swaps</th>
                <th className="px-4 py-3 text-right font-medium">Volume</th>
                <th className="px-4 py-3 font-medium">Hooks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pools.map(function renderPool(pool) {
                const quote = pool.quoteAssetId ? (symbols.get(pool.quoteAssetId) ?? "?") : "memecoin";
                return (
                  <tr key={pool.id}>
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink">
                      {symbol}/{quote}
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-soft">
                      {pool.poolAddress ? (
                        <a href={explorerAddressUrl(chainId, pool.poolAddress)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                          {venueTitle(pool.venue)}
                        </a>
                      ) : (
                        venueTitle(pool.venue)
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-soft">{(pool.fee & 0x800000) !== 0 ? "dynamic" : `${(pool.fee / 10_000).toFixed(2)}%`}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{poolPriceText(pool, quote)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{money(stateReadIsCurrent(pool.stateCheckedAt) ? pool.depthUsd : null)}<p className="mt-1 text-[10px] text-ink-faint">{pool.poolAddress ? "V3 quote holdings" : "V4 bounded 1% estimate"}</p></td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] tabular-nums text-ink-soft">{liquidityText(stateReadIsCurrent(pool.stateCheckedAt) ? pool.liquidity : null)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{countText(pool.swaps24h)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{money(pool.volumeUsd24h)}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-ink-faint">
                      {pool.hooks === zeroAddress ? (
                        "none"
                      ) : (
                        <a href={explorerAddressUrl(chainId, pool.hooks)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                          {shortHex(pool.hooks)}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
      {pools.length > 0 ? (
        <p className="mt-3 max-w-3xl text-[12.5px] leading-5 text-ink-faint">
          V3 quote holdings are the USD value of the quote tokens held by that pool. V4&apos;s bounded estimate describes quote needed for a 1% price move within the observed range, not a pool balance.
          Neither measure is a token-wide TVL figure, and the two are not added together. Liquidity (L) is Uniswap&apos;s raw in-range liquidity and can only compare pools of the same pair.
          Swaps use recorded block times; volume also needs USD valuation for the indexed window. Missing valuation or history remains unavailable.
        </p>
      ) : null}
      {note ? <p className="mt-3 text-[12.5px] leading-5 text-ink-faint">{note}</p> : null}
    </section>
  );
}
