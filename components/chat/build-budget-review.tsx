"use client";
import { useState, type ReactElement } from "react";
import { BuildPriceReview, type BuildPriceQuote } from "./build-price-review";

export function BuildBudgetReview({ buildId, onResumed }: { buildId: string; onResumed: () => void }): ReactElement {
  const [quote, setQuote] = useState<BuildPriceQuote | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function request(approve: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);setError(null);
    try {
      const body = approve && quote ? { action: "accept", approval: { quoteId: quote.id, digest: quote.digest, requestId } } : { action: "quote" };
      const response = await fetch(`/api/builds/${buildId}/budget`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not review this allowance.");
      if (approve) { setQuote(null);onResumed(); }
      else { setQuote(data);setRequestId(crypto.randomUUID()); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not reach the server. Your progress is saved."); }
    finally { setBusy(false); }
  }
  return <div className="w-full text-sm text-ink"><p className="mb-3">Your progress is saved. Review another allowance to continue, or stop the build.</p>
    {quote ? <BuildPriceReview quote={quote} busy={busy} extension onApprove={() => { void request(true); }} onCancel={() => setQuote(null)} /> : <button type="button" disabled={busy} onClick={() => { void request(false); }} className="rounded-full border border-line px-4 py-2">{busy ? "Loading allowance…" : "Review another allowance"}</button>}
    {error ? <p role="alert" className="mt-2">{error}</p> : null}
  </div>;
}
