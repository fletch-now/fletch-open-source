import type { AnalysisReport, CompileReport, TestReport } from "@/lib/build/types";

export function requiredTestsFailure(report: TestReport | null): string | null {
  if (!report || report.total === 0) return "The contract has no executable Foundry tests. Write tests for its required actions and failure cases.";
  if (report.failed > 0 || report.passed !== report.total) return `${Math.max(report.failed, report.total - report.passed)} of ${report.total} tests failed.`;
  if (report.exitCode !== undefined && report.exitCode !== 0) return `Foundry test execution failed (exit ${report.exitCode}).`;
  return null;
}

export function contractEvidenceFailures(required: boolean, compile: CompileReport, tests: TestReport | null, analysis: AnalysisReport): string[] {
  const failures: string[] = [];
  if (!compile.ok) failures.push("The final contract source did not compile.");
  if (required && compile.contracts.length === 0) failures.push("The required contract was not produced.");
  if (compile.contracts.length > 0) {
    const testFailure = requiredTestsFailure(tests);
    if (testFailure) failures.push(testFailure);
    if (!analysis.ran) failures.push(`Static analysis could not be completed: ${analysis.skipped ?? "no result"}.`);
    else if (analysis.blocking > 0) failures.push(`Static analysis still reports ${analysis.blocking} high-impact findings.`);
  }
  return failures;
}
