import type { AnalysisReport, BuildEvent, CompileReport, TestReport } from "@/lib/build/types";

export interface BuildEvidence {
  compile: CompileReport | null;
  tests: TestReport | null;
  analysis: AnalysisReport | null;
}

export function updateBuildEvidence(
  previous: BuildEvidence,
  event: Pick<BuildEvent, "phase" | "compile" | "tests" | "analysis">,
): BuildEvidence {
  const recompiled = event.phase === "compiling" && !!event.compile;
  return {
    compile: event.compile ?? previous.compile,
    tests: event.tests ?? (recompiled ? null : previous.tests),
    analysis: event.analysis ?? (recompiled ? null : previous.analysis),
  };
}

interface CheckVerdict {
  state: "passed" | "failed" | "missing" | "unrecorded";
  label: string;
}

export function testVerdict(report?: TestReport | null): CheckVerdict {
  if (!report) return { state: "unrecorded", label: "Tests: not recorded" };
  if (report.total === 0) return { state: "missing", label: "Tests: missing (0 tests)" };
  const counts = `${report.passed}/${report.total} passed`;
  if (report.exitCode !== undefined && report.exitCode !== 0)
    return { state: "failed", label: `Tests: failed (exit ${report.exitCode}) · ${counts}` };
  if (report.failed > 0 || report.passed !== report.total)
    return { state: "failed", label: `Tests: failed · ${counts}` };
  return { state: "passed", label: `Tests: ${counts}` };
}

export function analysisVerdict(report?: AnalysisReport | null): CheckVerdict {
  if (!report) return { state: "unrecorded", label: "Security: not recorded" };
  if (!report.ran) return { state: "missing", label: "Security: incomplete" };
  return {
    state: report.blocking > 0 ? "failed" : "passed",
    label: `Security: ${report.blocking} blocking`,
  };
}
