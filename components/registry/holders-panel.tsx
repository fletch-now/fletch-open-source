import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { FloatShares } from "@/lib/registry/authority/concentration";
import { BUCKET_MEANING, type FloatBucket, type HolderLabel } from "@/lib/registry/authority/labels";
import type { LedgerProgress } from "@/lib/registry/authority/ledger";
import type { ActivityDay, Concentration, HolderRow } from "@/lib/registry/authority/read";
import { sharePctText, shortHex, supplyText } from "@/components/registry/format";

interface HoldersPanelProps {
  symbol: string;
  chainId: number;
  decimals: number;
  totalSupplyRaw: string | null;
  holders: HolderRow[];
  holderCount: number;
  concentration: Concentration | null;
  labels: Map<string, HolderLabel>;
  activity: ActivityDay[];
  progress: LedgerProgress;
  // Blockscout's count, the one number about holders that is complete today.
  blockscoutHolders: number | null;
}

const COMPLETE_WITHIN_BLOCKS = BigInt(10_000);

interface FloatSegment {
  bucket: FloatBucket;
  label: string;
  swatch: string;
}

// Float first: it is the answer the section exists to give, and the rest of
// the bar is what has been taken out of it.
const FLOAT_SEGMENTS: readonly FloatSegment[] = [
  { bucket: "float", label: "Ordinary wallets", swatch: "bg-hood-deep" },
  { bucket: "pools", label: "DEX pools", swatch: "bg-hood/50" },
  { bucket: "issuer", label: "Issuer wallets", swatch: "bg-ink-soft" },
  { bucket: "contracts", label: "Other contracts", swatch: "bg-ink-faint" },
  { bucket: "bridge", label: "Bridge gateways", swatch: "bg-amber-600" },
  { bucket: "unknown", label: "Not checked yet", swatch: "bg-line-strong" },
];

function num(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function sharesOf(row: Concentration | null): FloatShares {
  return {
    float: num(row?.floatPct),
    pools: num(row?.poolsPct),
    issuer: num(row?.issuerPct),
    contracts: num(row?.contractsPct),
    bridge: num(row?.bridgePct),
    unknown: num(row?.unknownPct),
  };
}

function share(raw: string, totalSupplyRaw: string | null): string {
  if (!totalSupplyRaw || BigInt(totalSupplyRaw) === BigInt(0)) {
    return "—";
  }
  return `${(Number((BigInt(raw.split(".")[0]) * BigInt(1_000_000)) / BigInt(totalSupplyRaw)) / 10_000).toFixed(2)}%`;
}

function ratio(part: number, whole: number): string {
  return whole === 0 ? "—" : `${((part / whole) * 100).toFixed(0)}%`;
}

export function HoldersPanel({ symbol, chainId, decimals, totalSupplyRaw, holders, holderCount, concentration, labels, activity, progress, blockscoutHolders }: HoldersPanelProps) {
  const complete = progress.behind !== null && progress.behind <= COMPLETE_WITHIN_BLOCKS;
  if (!complete) {
    return (
      <section id="holders" className="mt-14 scroll-mt-24">
        <h2 className="text-[18px] font-medium text-ink">Holders and activity</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-amber-700">
          {progress.block === null
            ? "The holder ledger has not started reading this chain yet."
            : progress.head === null
              ? `The holder ledger is at block ${progress.block.toLocaleString("en-US")}; the chain head has not been read in the last five minutes, so its distance from head is unknown.`
              : `The holder ledger is still reading history: block ${progress.block.toLocaleString("en-US")} of ${progress.head.toLocaleString("en-US")}.`}{" "}
          Balances, concentration and daily activity for {symbol} are shown once it reaches the head; a partial ledger would name the wrong holders.
          {blockscoutHolders !== null ? ` The explorer counts ${blockscoutHolders.toLocaleString("en-US")} holders today.` : ""}
        </p>
      </section>
    );
  }
  const shares = sharesOf(concentration);
  const drawn = FLOAT_SEGMENTS.filter((segment) => (shares[segment.bucket] ?? 0) > 0);
  const facts = [
    { label: "holders", value: holderCount.toLocaleString("en-US") },
    { label: "float", value: sharePctText(shares.float) },
    { label: "largest holder", value: sharePctText(concentration?.top1Pct) },
    { label: "top ten", value: sharePctText(concentration?.top10Pct) },
    { label: "gini", value: concentration?.gini ? Number(concentration.gini).toFixed(3) : "—" },
  ];

  return (
    <section id="holders" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">Holders and activity</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        Running balances from every {symbol} transfer the ledger has applied, and each day&apos;s transfers as economics:
        how many settled against USDG in the same transaction, how many happened outside US market hours.{" "}
        {complete ? (
          <>The ledger is at the chain head{progress.block ? ` (block ${progress.block.toLocaleString("en-US")})` : ""}.</>
        ) : (
          <span className="text-amber-700">
            The ledger is still reading history
            {progress.block && progress.head ? `: block ${progress.block.toLocaleString("en-US")} of ${progress.head.toLocaleString("en-US")}` : ""}. Figures below are
            partial until it reaches the head.
          </span>
        )}{" "}
        <a href={`/api/v1/chains/${chainId}/assets/${encodeURIComponent(symbol)}/holders`} className="underline underline-offset-4 hover:text-ink">
          Holders as JSON
        </a>
        ,{" "}
        <a href={`/api/v1/chains/${chainId}/assets/${encodeURIComponent(symbol)}/activity`} className="underline underline-offset-4 hover:text-ink">
          activity as JSON
        </a>
        .
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5">
        {facts.map(function renderFact(fact) {
          return (
            <div key={fact.label} className="bg-raised px-4 py-3">
              <dt className="mono-label">{fact.label}</dt>
              <dd className="mt-1 font-mono text-[14px] tabular-nums text-ink">{fact.value}</dd>
            </div>
          );
        })}
      </dl>
      {concentration ? <p className="mt-2 text-[12px] text-ink-faint">Concentration as of {concentration.day}, from the ledger at block {concentration.headBlock.toLocaleString("en-US")}.</p> : null}

      <div className="mt-6 rounded-card border border-line bg-raised px-5 py-4">
        <h3 className="text-[14px] font-medium text-ink">Where the supply sits</h3>
        {drawn.length === 0 ? (
          <p className="mt-1 text-[13px] leading-6 text-ink-soft">
            {concentration === null
              ? "No reading yet. The daily concentration job writes these shares once the transfer ledger has reached the chain head."
              : `This day's reading was taken before the float shares existed; the next daily run writes them.`}
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-ink-soft">
              Every {symbol} balance the ledger holds, grouped by what the address is. Float is what is left in ordinary
              wallets once the DEX pools, the issuer&apos;s own wallets, the bridge gateways and every other contract are
              taken out. Addresses are named from the chain: the Uniswap v4 PoolManager, every Uniswap v3 pool and the
              Arbitrum gateways are named contracts, an issuer wallet is the address a Stock Token&apos;s mints are sent
              to, and every other material holder is asked whether it has contract code.
            </p>
            <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-panel">
              {drawn.map(function renderSegment(segment) {
                return (
                  <span
                    key={segment.bucket}
                    className={segment.swatch}
                    style={{ width: `${shares[segment.bucket] ?? 0}%` }}
                    title={`${segment.label}: ${sharePctText(shares[segment.bucket])}`}
                  />
                );
              })}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {drawn.map(function renderLegend(segment) {
                return (
                  <div key={segment.bucket} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${segment.swatch}`} />
                    <dt className="text-ink">
                      {segment.label}
                      <span className="block text-[11.5px] text-ink-faint">{BUCKET_MEANING[segment.bucket]}</span>
                    </dt>
                    <dd className="ml-auto font-mono tabular-nums text-ink-soft">{sharePctText(shares[segment.bucket])}</dd>
                  </div>
                );
              })}
            </dl>
            {(shares.unknown ?? 0) > 0 ? (
              <p className="mt-3 text-[12px] leading-5 text-amber-700">
                {sharePctText(shares.unknown)} of the supply is held by addresses the code probe has not checked — it checks
                every holder above a ten-thousandth of supply, so a tail of small holdings stays unchecked — and the float
                share is a floor: some of that tail may turn out to be a contract.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-card border border-line bg-raised">
          <table className="w-full min-w-[420px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="px-4 py-3 font-medium">Holder</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {holders.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-[13.5px] text-ink-soft">
                    No balances applied yet.
                  </td>
                </tr>
              ) : null}
              {holders.map(function renderHolder(row) {
                const label = labels.get(row.holder) ?? null;
                return (
                  <tr key={row.holder}>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-soft">
                      <a href={explorerAddressUrl(chainId, row.holder)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                        {shortHex(row.holder, 8, 6)}
                      </a>
                      {label && label.kind !== "eoa" ? (
                        <span className="ml-2 rounded-full bg-panel px-2 py-0.5 font-sans text-[10.5px] text-ink-faint" title={BUCKET_MEANING[label.bucket]}>
                          {label.label}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{supplyText(row.rawBalance.split(".")[0], decimals)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{share(row.rawBalance, totalSupplyRaw)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-card border border-line bg-raised">
          <table className="w-full min-w-[460px] text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="px-4 py-3 font-medium">Day</th>
                <th className="px-4 py-3 text-right font-medium">Transfers</th>
                <th className="px-4 py-3 text-right font-medium">Volume</th>
                <th className="px-4 py-3 text-right font-medium">vs USDG</th>
                <th className="px-4 py-3 text-right font-medium">Off-hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {activity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-[13.5px] text-ink-soft">
                    No days recorded yet.
                  </td>
                </tr>
              ) : null}
              {activity.map(function renderDay(day) {
                return (
                  <tr key={day.day}>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-soft">{day.day}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{day.transfers.toLocaleString("en-US")}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{supplyText(day.volumeRaw.split(".")[0], decimals)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{ratio(day.dvpTransfers, day.transfers)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{ratio(day.offhoursTransfers, day.transfers)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
