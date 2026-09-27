// The main re-skin surface: each build phase rendered as a tool step.
export interface ToolMeta {
  label: string;
  action: string;
  tone: string;
}

export const TOOL_META: Record<string, ToolMeta> = {
  // Not a step the agent performs: a thing it said while performing one.
  note: { label: "Agent", action: "thinking", tone: "bg-hood-wash text-hood-deep ring-hood/30" },
  planning: { label: "Plan", action: "planning", tone: "bg-panel text-ink-soft ring-line" },
  scaffolding: { label: "Scaffold", action: "scaffolding", tone: "bg-panel text-ink-soft ring-line" },
  compiling: { label: "Compile", action: "compiling", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  testing: { label: "Test", action: "testing", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  deploying: { label: "Deploy", action: "deploying", tone: "bg-hood-wash text-hood-deep ring-hood/30" },
  hosting: { label: "Preview", action: "preparing the app", tone: "bg-hood-wash text-hood-deep ring-hood/30" },
};

export const DEFAULT_TOOL_META: ToolMeta = {
  label: "Step",
  action: "working",
  tone: "bg-panel text-ink-soft ring-line",
};

export function toolMeta(tool: string): ToolMeta {
  return TOOL_META[tool] ?? DEFAULT_TOOL_META;
}
