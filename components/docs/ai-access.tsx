import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { CopyReference } from "@/components/docs/copy-reference";

export function DocsAiAccess(): ReactElement {
  return (
    <section aria-label="Documentation for AI and developers" className="mb-10 border-b border-line pb-6">
      <p className="mb-3 text-[15px] font-medium text-ink">Take the docs into your AI</p>
      <nav aria-label="AI documentation links" className="mb-4 flex flex-wrap gap-x-5 gap-y-3 text-[13px] text-ink-soft [&_a]:underline [&_a]:underline-offset-4 [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-4 [&_a]:focus-visible:outline-hood">
        <Link href="/docs/all" prefetch={false}>All docs in one page</Link>
        <a href="/llms.txt">llms.txt</a>
        <a href="/api/v1/openapi.json">OpenAPI JSON</a>
        <a href="/skill.md">AI skill</a>
        <Link href="/docs/mcp" prefetch={false}>MCP setup</Link>
        <Link href="/developers" prefetch={false}>Developer reference</Link>
      </nav>
      <CopyReference />
    </section>
  );
}
