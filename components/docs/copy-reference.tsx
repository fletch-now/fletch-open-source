"use client";

import { useState, type ReactElement } from "react";

export function CopyReference(): ReactElement {
  const [state, setState] = useState<"ready" | "copying" | "copied" | "manual" | "error">("ready");
  const [manualText, setManualText] = useState("");

  async function copy(): Promise<void> {
    setState("copying");
    let text: string;
    try {
      const response = await fetch("/llms-full.txt", { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Documentation could not be loaded");
      text = await response.text();
    } catch {
      setState("error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setManualText(text);
      setState("manual");
    }
  }

  let label = "Copy all docs";
  if (state === "copied") label = "Copied all docs";
  if (state === "copying") label = "Loading docs…";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          disabled={state === "copying"}
          aria-busy={state === "copying"}
          className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink disabled:opacity-60"
        >
          {label}
        </button>
        <a href="/llms-full.txt" className="text-[13px] text-ink-soft underline underline-offset-4">Full Markdown</a>
        <a href="/llms-full.txt" download="fletch-docs.md" className="text-[13px] text-ink-soft underline underline-offset-4">Download .md</a>
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-[12px] leading-5 text-ink-soft">
        {state === "copied"
          ? "Copied every guide and the complete API specification. Paste it into your AI chat or editor."
          : "Every product guide, integration instructions and the complete API specification in one document."}
      </p>
      {state === "error" ? <p role="alert" className="mt-2 text-[13px] text-ink">Could not load the docs. Try again or open Full Markdown.</p> : null}
      {state === "manual" ? (
        <label className="mt-3 block text-[13px] text-ink">
          Clipboard access was unavailable. Select and copy the full document below.
          <textarea
            readOnly
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 h-40 w-full rounded-md border border-line bg-raised p-3 font-mono text-[12px]"
          />
        </label>
      ) : null}
    </div>
  );
}
