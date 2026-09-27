import { BuildAttachmentsSchema, isImageAttachment } from "@/lib/build/attachments";
import { MAX_PROMPT_CHARS } from "@/lib/build/prompt-limits";
import type { BuildInput } from "@/lib/build/types";
import { MAX_PROJECT_CONVERSATION_CHARS } from "./context-policy";

export type NeedsBrief = Pick<BuildInput, "prompt" | "attachments" | "restoredBriefs" | "projectRequests" | "projectConversation">;

export class BuildBriefError extends Error {
  constructor(message: string) {
    super(`${message} No needs analysis was run.`);
    this.name = "BuildBriefError";
  }
}

export function referencedBriefNames(prompt: string): string[] {
  const names = [...prompt.matchAll(/\bbrief\/([\w][\w.\- ]{0,63}\.(?:markdown|md|txt|csv|json|yml|yaml|png|jpe?g))\b/gi)]
    .map(function name(match) { return match[1]; });
  return [...new Set(names)];
}

export function projectRequestContext(brief: NeedsBrief): string {
  const conversation = brief.projectConversation ?? "";
  if (typeof conversation !== "string" || conversation.length > MAX_PROJECT_CONVERSATION_CHARS) throw new BuildBriefError("The saved project conversation exceeds its context budget.");
  if (!brief.projectRequests?.length) return conversation ? `${conversation}\n\nCurrent request:\n${brief.prompt}` : brief.prompt;
  if (brief.projectRequests.length > 2 || brief.projectRequests.some(function invalid(prompt) {
    return typeof prompt !== "string" || prompt.length > MAX_PROMPT_CHARS;
  })) throw new BuildBriefError("The saved project requests could not be read completely.");
  return `Previously submitted project requests, oldest first. These retain the original objective and the latest change. The current request below takes precedence.\n\n${brief.projectRequests.join("\n\n")}\n\n${conversation}\n\nCurrent request:\n${brief.prompt}`;
}

export function needsAnalysisContext(brief: NeedsBrief): string {
  if (typeof brief.prompt !== "string" || brief.prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`The planning prompt must be text of at most ${MAX_PROMPT_CHARS.toLocaleString("en-US")} characters. No needs analysis was run.`);
  }
  // Reuse the upload caps even for internal callers. Never truncate a valid
  // file or classify from a subset when a supplied attachment is invalid.
  const attachments = BuildAttachmentsSchema.safeParse(brief.attachments === undefined ? [] : brief.attachments);
  if (!attachments.success) {
    throw new Error(`The complete brief could not be read for planning: ${attachments.error.issues[0]?.message ?? "Invalid attachments."} No needs analysis was run.`);
  }
  const present = new Set(attachments.data.map(function name(file) { return file.name.toLowerCase(); }));
  const request = projectRequestContext(brief);
  const missing = referencedBriefNames(brief.prompt).filter(function absent(name) { return !present.has(name.toLowerCase()); });
  if (missing.length) {
    throw new BuildBriefError(`The referenced brief could not be restored: ${missing.map(function path(name) { return `brief/${name}`; }).join(", ")}. Restore its draft or attach the file before retrying.`);
  }
  const parts = [request];
  for (const attachment of attachments.data) {
    if (isImageAttachment(attachment)) continue;
    const provenance = brief.restoredBriefs?.includes(attachment.name)
      ? "Previously submitted text brief (the current request takes precedence)"
      : "Attached text brief";
    parts.push(`${provenance} ${JSON.stringify(attachment.name)} (complete contents):\n${attachment.content}`);
  }
  return parts.join("\n\n");
}
