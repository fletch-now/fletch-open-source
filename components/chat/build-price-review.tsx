"use client";
import type { ReactElement } from "react";
import type { PricingSnapshot, PricingTier } from "@/lib/build/pricing-policy";

export interface BuildPriceQuote extends PricingSnapshot {
  id: string; digest: string; expiresAt: string; approvedMaximum: number;
  tiers?: { tier: PricingTier; credits: number; allowance: PricingSnapshot["allowance"] }[];
}
export function BuildPriceReview({ quote, busy, extension = false, onApprove, onCancel, onTier }: {
  quote: BuildPriceQuote; busy: boolean; extension?: boolean; onApprove: () => void; onCancel: () => void; onTier?: (tier: PricingTier) => void;
}): ReactElement {
  const minutes = Math.floor(quote.allowance.activeSeconds / 60);
  return <section aria-label="Review build allowance" className="mb-3 rounded-xl border border-line bg-raised p-4 text-sm text-ink">
    <h3 className="font-medium">{extension ? "Review another allowance" : "Review your build"}</h3>
    {quote.tiers && onTier ? <div className="mt-3 flex flex-wrap gap-2" aria-label="Build package">{quote.tiers.map(function option(pack) {
      return <button key={pack.tier} type="button" disabled={busy} aria-pressed={quote.tier === pack.tier} onClick={() => onTier(pack.tier)} className="rounded-lg border border-line px-3 py-2 capitalize aria-pressed:border-ink aria-pressed:bg-panel disabled:opacity-50">{pack.tier} · {pack.credits} credits</button>;
    })}</div> : null}
    <p className="mt-3"><span className="capitalize">{quote.tier}</span> package: <strong>{quote.fixedCredits} credits</strong>. Approved maximum: <strong>{quote.approvedMaximum} credits</strong>.</p>
    <p className="mt-2">Includes {quote.allowance.modelRequests} model requests, {quote.allowance.toolRuns} platform tool runs and {minutes} {minutes === 1 ? "minute" : "minutes"} {quote.allowance.activeSeconds % 60 ? `${quote.allowance.activeSeconds % 60} seconds ` : ""}of active work. Internal agent steps are bounded separately.</p>
    <p className="mt-2">Work pauses at the limit. Another package needs your approval. Failure or Stop releases reserved credits. Successful work costs the full accepted package price.</p>
    {quote.providerCost === "unknown_provider_billed" ? <p className="mt-2">Your provider bills your API key separately. That cost is unknown to Fletch.</p> : null}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={onApprove} className="rounded-full bg-ink px-4 py-2 text-white disabled:opacity-50">{busy ? "Please wait…" : `Approve ${quote.fixedCredits} credits${extension ? " and continue" : " and build"}`}</button><button type="button" disabled={busy} onClick={onCancel} className="rounded-full border border-line px-4 py-2">Keep my draft</button></div>
  </section>;
}
