"use client";

import { useHolderReward } from "./client";

export function HolderRewardCard(): React.ReactNode {
  const result = useHolderReward();
  const status = result?.status;
  let terms = "The official token and reward terms will appear here when holder credits open.";
  if (status?.period === "once") terms = "10 credits once per eligible account and wallet. Awarded credits stay in your balance.";
  if (status?.period === "utc_month") terms = "10 credits per eligible account and wallet each calendar month, starting at 00:00 UTC. Unspent credits carry over.";
  if (status?.period === "utc_day") terms = "10 credits per eligible account and wallet each calendar day, starting at 00:00 UTC. Unspent credits carry over.";
  return (
    <section id="holder-credits" className="min-w-0 scroll-mt-6 rounded-xl border border-line bg-raised">
      <header className="border-b border-line p-4 sm:p-5">
        <h2 className="text-base font-medium text-ink">$FLTX holder credits</h2>
        <p className="mt-1 text-sm leading-6 text-ink-soft">Hold more than $100 of the official token to receive 10 build credits when the reward opens.</p>
      </header>
      <div className="space-y-3 p-4 text-sm leading-6 sm:p-5">
        <p role="status" aria-live="polite" className="text-ink">{result?.error ?? status?.message ?? "Checking holder-credit availability…"}</p>
        <p className="text-ink-soft">{terms}</p>
        {status?.valueUsd !== null && status?.valueUsd !== undefined ? <p className="font-mono tabular-nums">Last verified holding estimate: ${status.valueUsd}</p> : null}
        {status?.wallet ? <p className="break-all text-xs text-ink-faint">Wallet: {status.wallet}</p> : null}
        {status?.tokenAddress ? <a className="block break-all text-xs underline underline-offset-4" href={`/registry/token/${status.tokenAddress}`}>Official contract: {status.tokenAddress}</a> : null}
        {status?.priceAt ? <p className="text-xs text-ink-faint">Registry reference price observed <time dateTime={status.priceAt}>{new Date(status.priceAt).toLocaleString()}</time>. The estimate uses the lower of settled and current token balances.</p> : null}
        {status?.checkedAt ? <p className="text-xs text-ink-faint">Checked <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleString()}</time>.</p> : null}
        <p className="text-xs text-ink-faint">Checks run automatically while Fletch is open. No token approval or payment is needed. Recently received tokens may need to settle first.</p>
        <button type="button" className="min-h-11 rounded-lg border border-line px-4 text-ink hover:bg-panel focus-visible:outline-2 focus-visible:outline-hood" onClick={() => window.dispatchEvent(new Event("fletch:holder-check"))}>Check holder credits</button>
      </div>
    </section>
  );
}
