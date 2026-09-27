"use client";

import { Fragment } from "react";

// Hand-rolled renderer for the three things our answers actually use: bold spans,
// bare URLs, and line breaks. A markdown library would be larger than the feature.
const TOKEN = /(\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g;

interface MarkdownTextProps {
  content: string;
}

function renderLine(line: string, lineKey: number) {
  const parts = line.split(TOKEN).filter(Boolean);
  return (
    <p key={lineKey} className="break-words text-[14px] leading-6 text-ink-soft">
      {parts.map(function renderPart(part, index) {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-semibold text-ink">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("http")) {
          return (
            <a
              key={index}
              href={part}
              target="_blank"
              rel="noreferrer"
              className="break-all text-hood-deep underline decoration-hood/40 underline-offset-4 transition-colors hover:decoration-hood"
            >
              {part.replace(/^https?:\/\//, "")}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </p>
  );
}

export function MarkdownText({ content }: MarkdownTextProps) {
  return (
    <div className="flex flex-col gap-2">
      {content.split("\n").map(function renderEach(line, index) {
        if (!line.trim()) {
          return <div key={index} className="h-1" />;
        }
        return renderLine(line, index);
      })}
    </div>
  );
}
