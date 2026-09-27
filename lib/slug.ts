import { randomBytes } from "node:crypto";

export function generateSlug(): string {
  return `forge-${randomBytes(4).toString("hex")}`;
}

// A short human name for a project, derived from the prompt.
// Openers a person types before saying what they want. Stripped so the name is
// the thing, not the request: "Build me a pump.fun copy with…" → "Pump.fun copy".
const OPENERS =
  /^(?:(?:please|hey|hi|ok|so)[,\s]+)?(?:(?:can|could|would) you\s+)?(?:(?:i|we) (?:want|need|would like)(?: you)?(?: to)?\s+)?(?:(?:build|create|make|write|design|develop|generate|ship|code|give)(?: me| us)?\s+)?(?:(?:a|an|the|some|one)\s+)?(?:(?:dead[- ]simple|simple|small|minimal|basic|quick|tiny)[,\s]+)?/i;
const MAX_NAME_WORDS = 6;
const MAX_NAME_CHARS = 40;
// A cut that lands on one of these leaves a fragment ("Follow a wallet and"),
// so they are dropped from the end.
const DANGLING = new Set(["and", "or", "the", "a", "an", "of", "for", "with", "to", "in", "on", "at", "by", "as", "that", "which", "its", "my", "me", "us", "it", "they", "showing", "list", "listing", "using"]);

// A short title for a project, from the first thing the prompt asks for. The
// full prompt is still the first message of the thread; this is what the
// picker, the breadcrumb and the projects list show.
export function nameFromPrompt(prompt: string): string {
  const flat = prompt.trim().replace(/\s+/g, " ");
  const opened = flat.replace(OPENERS, "").trim() || flat;
  // The first clause: up to a comma, dash, colon or sentence end.
  const clause = opened.split(/\s+[-–—]\s+|[,:;.!?](?:\s|$)|\s\(|\s(?:with|that|which|where|so)\s/i)[0]?.trim() || opened;
  const words = clause.split(" ").slice(0, MAX_NAME_WORDS);
  while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  let name = words.join(" ");
  if (name.length > MAX_NAME_CHARS) {
    name = `${name.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`;
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
