import type { Stage } from "@/components/chat/pipeline";
import type { BuildResult } from "@/components/chat/artifact-panel";
import type { AnalysisReport, CompileReport, TestReport } from "@/lib/build/types";
import { analysisVerdict, testVerdict } from "@/lib/chat/build-evidence";

export type StepState = "todo" | "active" | "done" | "skipped" | "blocked";
export interface ProgressStep {
  key: string;
  label: string;
  detail: string;
  state: StepState;
  href?: string;
}

export interface ProgressTrackProps {
  stage: Stage;
  running: boolean;
  result: BuildResult | null;
  noContract: boolean;
  hasThread: boolean;
  compile?: CompileReport | null;
  tests?: TestReport | null;
  analysis?: AnalysisReport | null;
  onOpenCode?: () => void;
}

function contractStep({
  stage,
  running,
  result,
  noContract,
  compile,
  tests,
  analysis,
}: ProgressTrackProps): ProgressStep {
  const base = { key: "contract", label: "Contract" };
  if (noContract)
    return { ...base, detail: "Skipped: frontend-only app", state: "skipped" };
  if (
    running &&
    ["planning", "writing", "compiling", "testing", "deploying"].includes(stage)
  )
    return { ...base, detail: "Contract pipeline running", state: "active" };
  const testCheck = testVerdict(tests);
  const analysisCheck = analysisVerdict(analysis);
  if (compile?.ok === false)
    return { ...base, detail: "Compile failed", state: "blocked" };
  for (const check of [testCheck, analysisCheck]) {
    if (check.state === "failed" || check.state === "missing")
      return { ...base, detail: check.label, state: "blocked" };
  }
  if (compile?.ok && (!tests || !analysis)) {
    const detail = tests ? "Compiled · security not recorded" : "Compiled · tests not recorded";
    return { ...base, detail, state: "todo" };
  }
  if (result?.contractAddress && result.explorerUrl)
    return {
      ...base,
      detail: result.verified
        ? "Deployed · source verified"
        : "Deployment recorded",
      state: "done",
      href: result.explorerUrl,
    };
  if (compile?.ok) {
    return { ...base, detail: `${testCheck.label} · ${analysisCheck.label}`, state: "done" };
  }
  return { ...base, detail: "No toolchain or deploy receipt", state: "todo" };
}

export function progressSteps(props: ProgressTrackProps): ProgressStep[] {
  const { running, stage, result, hasThread } = props;
  const idea: ProgressStep = {
    key: "idea",
    label: "Idea",
    detail: hasThread ? "Received" : "Describe the app in Chat",
    state: hasThread ? "done" : "active",
  };
  let page: ProgressStep = {
    key: "page",
    label: "Web page",
    detail: "No build receipt",
    state: "todo",
  };
  let publish: ProgressStep = {
    key: "publish",
    label: "Published",
    detail: "No publication recorded",
    state: "todo",
  };
  if (running && stage === "hosting") {
    page = { ...page, detail: "Building the front end", state: "active" };
    publish = { ...publish, detail: "Waiting for the saved preview", state: "todo" };
  }
  if (result?.previewUrl) {
    page = {
      ...page,
      detail: "Published bundle",
      state: "done",
      href: result.previewUrl,
    };
    publish = {
      ...publish,
      detail: result.previewUrl.replace(/^https?:\/\//, ""),
      state: "done",
      href: result.previewUrl,
    };
  }
  if (result?.draftReady) {
    page = { ...page, detail: "Saved preview ready", state: "done", href: undefined };
    publish = { ...publish, label: "Publish", detail: "Select Publish live app to publish this version", state: "todo", href: undefined };
  }
  return [idea, contractStep(props), page, publish];
}
