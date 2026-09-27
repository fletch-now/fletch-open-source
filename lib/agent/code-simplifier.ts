import type { AgentRequest } from "./provider-transport";
import policy from "./code-simplifier-policy.json";

export const CODE_SIMPLIFIER_STANDARD = `Fletch builder coding standard: code-simplifier
Read and apply the following standard when writing or refining code, including after Continue, repair and context compaction. Implement the requested functionality; preserve that behavior during cleanup. Follow the project's applicable standards and the required response format. Keep the selected model.

${policy.instructions}

Before finishing a coding task, review the changed code against this standard and run the relevant available checks after refinements. Keep this review focused on the requested change and report only significant refinements and actual check results. Preserve necessary error handling, security checks and useful abstractions. A summary-only request must summarize unfinished work, including any pending review, and return text without tools. The standard is supplied again with every model request; it does not need to be copied into conversation summaries.`;

// Supply the reviewed policy outside saved chat so compaction cannot remove it.
export function withCodeSimplifier(request: AgentRequest): AgentRequest {
  return {
    ...request,
    messages: [{ role: "system", content: CODE_SIMPLIFIER_STANDARD }, ...request.messages],
  };
}
