"use client";

import type {
  AnalysisReport,
  CompileReport,
  TestReport,
} from "@/lib/build/types";
import type { BuildResult } from "@/components/chat/artifact-panel";
import { analysisVerdict, testVerdict } from "@/lib/chat/build-evidence";

interface BuildVerdictProps {
  compile: CompileReport | null;
  tests: TestReport | null;
  analysis: AnalysisReport | null;
  noContract: boolean;
  running: boolean;
  result: BuildResult | null;
  onReport: () => void;
}

export function BuildVerdict({
  compile,
  tests,
  analysis,
  noContract,
  running,
  result,
  onReport,
}: BuildVerdictProps): React.ReactElement {
  const testCheck = testVerdict(tests);
  const analysisCheck = analysisVerdict(analysis);
  let compileLabel = "Compile: not recorded";
  let testsLabel = "Tests: not recorded";
  let analysisLabel = "Security: not recorded";
  if (running) {
    compileLabel = "Compile: pending";
    testsLabel = "Tests: pending";
    analysisLabel = "Security: pending";
  }
  if (noContract) {
    compileLabel = "Compile: skipped";
    testsLabel = "Tests: skipped";
    analysisLabel = "Security: skipped";
  }
  if (compile)
    compileLabel = compile.ok ? "Compile: passed" : "Compile: failed";
  if (tests) testsLabel = testCheck.label;
  if (analysis) analysisLabel = analysisCheck.label;
  const noReports = !compile && !tests && !analysis && !running && !noContract;
  const skippedReports = noContract && !compile && !tests && !analysis;
  const failed =
    compile?.ok === false ||
    testCheck.state === "failed" || testCheck.state === "missing" ||
    analysisCheck.state === "failed" || analysisCheck.state === "missing";

  return (
    <div
      aria-label="Toolchain verdict and publication receipts"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] leading-4 text-ink-soft"
    >
      <button
        type="button"
        onClick={onReport}
        className={`inline-flex flex-wrap justify-center gap-x-2 gap-y-1 text-left underline-offset-4 hover:underline ${failed ? "text-red-700" : ""}`}
        title={analysis?.skipped ?? "Open server-run toolchain reports"}
      >
        {skippedReports ? <span>Contract checks skipped: frontend-only app</span> : null}
        {!skippedReports && noReports ? (
          <span>Compile · Tests · Security: no reports</span>
        ) : null}
        {!skippedReports && !noReports ? (
          <>
            <span>{compileLabel}</span>
            <span>{testsLabel}</span>
            <span>{analysisLabel}</span>
          </>
        ) : null}
      </button>
      {result?.explorerUrl && result.contractAddress ? (
        <a
          href={result.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-hood-deep underline underline-offset-2"
        >
          Contract{result.verified ? " · verified" : " · deployed"}
        </a>
      ) : null}
      {!result?.contractAddress && !noContract ? <span>Deploy: not recorded</span> : null}
      {result?.previewUrl ? (
        <a
          href={result.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="text-hood-deep underline underline-offset-2"
        >
          {result.draftReady ? "Previous live app ↗" : "Published app ↗"}
        </a>
      ) : (
        <span>{result?.draftReady ? "Preview ready to publish" : "Hosting: not recorded"}</span>
      )}
    </div>
  );
}
