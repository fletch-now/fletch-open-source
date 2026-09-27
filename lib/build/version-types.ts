import type { AnalysisReport, BuildArtifact, CompileReport, TestReport } from "./types";

export interface ProjectVersion {
  id: string;
  buildId: string;
  prompt: string;
  status: string;
  createdAt: string;
  sourceAvailable: boolean;
}

export interface ProjectVersionDetail extends ProjectVersion {
  sourceHash: string | null;
  sourceStage: string | null;
  sourceError: string | null;
  files: string[];
  artifacts: BuildArtifact[];
  compile: CompileReport | null;
  tests: TestReport | null;
  analysis: AnalysisReport | null;
}

export interface RestoredProject {
  projectId: string;
  slug: string;
  name: string;
}
