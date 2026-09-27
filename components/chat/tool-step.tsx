"use client";

import { toolMeta } from "@/lib/chat/tool-meta";
import type { ToolCall } from "@/lib/chat/types";
import { publicDiagnostic } from "@/lib/public-copy";

interface ToolStepProps {
  call: ToolCall;
  index: number;
  running: boolean;
}

export function ToolStep({ call, index, running }: ToolStepProps) {
  const meta = toolMeta(call.tool);
  // What the agent said, rather than what it did: full width, ordinary prose,
  // no "→ done" underneath. A file operation is a step; a sentence is not.
  if (call.tool === "note") {
    return (
      <div className="flex items-start gap-3 rounded-lg bg-hood-wash/50 px-2 py-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-hood-wash text-[10px] font-semibold text-hood-deep ring-1 ring-inset ring-hood/30">
          ·
        </span>
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-6 text-ink">{publicDiagnostic(call.input)}</p>
      </div>
    );
  }
  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors ${
        running ? "bg-hood-wash" : ""
      }`}
    >
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold ring-1 ring-inset ${meta.tone}`}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-6">
          <span className="font-medium text-ink">{running ? `${meta.action}…` : meta.label}</span>{" "}
          <span className="text-ink-soft">{publicDiagnostic(call.input)}</span>
        </p>
        {call.summary ? (
          <p className="font-mono text-[11px] leading-5 text-hood-deep">→ {publicDiagnostic(call.summary)}</p>
        ) : null}
      </div>
      {running ? (
        <span className="relative mt-2 flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hood opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hood" />
        </span>
      ) : null}
    </div>
  );
}
