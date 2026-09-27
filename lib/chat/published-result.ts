import type { BuildResult } from "@/components/chat/artifact-panel";

export function mergePublishedResult(
  previous: BuildResult | null,
  next: BuildResult,
): BuildResult {
  let explorerUrl = next.explorerUrl ?? previous?.explorerUrl;
  let verified = next.verified ?? previous?.verified;
  let contractName = next.contractName ?? previous?.contractName;
  if (
    next.contractAddress &&
    next.contractAddress !== previous?.contractAddress
  ) {
    explorerUrl = next.explorerUrl;
    verified = next.verified;
    contractName = next.contractName;
  }
  return {
    ...next,
    previewUrl: next.previewUrl ?? previous?.previewUrl,
    contractAddress: next.contractAddress ?? previous?.contractAddress,
    explorerUrl,
    verified,
    contractName,
  };
}
