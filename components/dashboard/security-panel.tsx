import type { AnalysisReport } from "@/lib/build/types";

// What the static analyser said about this build's contracts, in its own
// words, beside the rules the prompt holds the agent to. Honest about its
// limits: this is automated review, not a human audit.

interface SecurityPanelProps {
  analysis: AnalysisReport | null;
  ownerAddress: string | null;
}

const IMPACT_TONE: Record<string, string> = {
  High: "bg-red-50 text-red-700",
  Medium: "bg-amber-50 text-amber-800",
  Low: "bg-panel text-ink-soft",
  Informational: "bg-panel text-ink-faint",
  Optimization: "bg-panel text-ink-faint",
};

function headline(analysis: AnalysisReport | null): string {
  if (!analysis) {
    return "This build ran before static analysis was part of the pipeline.";
  }
  if (!analysis.ran) {
    return `Static analysis did not run: ${analysis.skipped}`;
  }
  if (analysis.findings.length === 0) {
    return "Slither read every contract and found nothing to report.";
  }
  const high = analysis.blocking;
  const medium = analysis.findings.filter((finding) => finding.impact === "Medium").length;
  const low = analysis.findings.length - high - medium;
  return `Slither reported ${high} high, ${medium} medium and ${low} low-impact ${analysis.findings.length === 1 ? "finding" : "findings"}. High-impact findings block a deploy; the rest are shown for you to judge.`;
}

export function SecurityPanel({ analysis, ownerAddress }: SecurityPanelProps) {
  return (
    <section className="rounded-card border border-line bg-raised px-5 py-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="mono-label">security checks</span>
        <span className="text-[12px] text-ink-soft">Automated review on every build; not a human audit.</span>
      </header>
      <p className="text-[13.5px] leading-6 text-ink">{headline(analysis)}</p>
      <ul className="mt-3 grid gap-1.5 text-[12.5px] leading-5 text-ink-soft sm:grid-cols-2">
        <li>Owner set in the constructor{ownerAddress ? `: your wallet ${ownerAddress.slice(0, 6)}…${ownerAddress.slice(-4)}` : ""}; the deploying key holds no role.</li>
        <li>Rules the agent must follow: owner checks, checks-effects-interactions, reentrancy guards, no tx.origin, selfdestruct, delegatecall or assembly, pull payments, events.</li>
        <li>Tests must pass, including that a non-owner is reverted from owner-only functions.</li>
        <li>Slither{analysis?.version ? ` ${analysis.version}` : ""} runs offline in the sandbox over the exact sources that were compiled.</li>
      </ul>
      {analysis && analysis.findings.length > 0 ? (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line">
          {analysis.findings.map(function renderFinding(finding, index) {
            return (
              <li key={`${finding.check}-${index}`} className="px-4 py-2.5">
                <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${IMPACT_TONE[finding.impact] ?? IMPACT_TONE.Low}`}>{finding.impact.toLowerCase()}</span>
                  <span className="font-mono text-ink">{finding.check}</span>
                  {finding.file ? (
                    <span className="font-mono text-[11.5px] text-ink-faint">
                      {finding.file}
                      {finding.line ? `:${finding.line}` : ""}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-ink-soft">{finding.description.split("\n")[0]}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
