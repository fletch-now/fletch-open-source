"use client";

import { publicDiagnostic } from "@/lib/public-copy";
import { useState } from "react";
import { Check, Copy, Radio, Sparkles } from "@/components/ui/icons";

// The contract surface. Until a deploy exists there is nothing to call, so this
// shows what the compiler produced — the real ABI — and says plainly that the
// contract is not on chain yet rather than offering buttons that cannot work.

interface AbiEntry {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: Array<{ name?: string; type?: string }>;
  outputs?: Array<{ type?: string }>;
}

function signature(entry: AbiEntry): string {
  const args = (entry.inputs ?? [])
    .map(function render(input) {
      return input.name ? `${input.type} ${input.name}` : (input.type ?? "");
    })
    .join(", ");
  return `${entry.name ?? entry.type}(${args})`;
}

function mutabilityTone(mutability: string | undefined): string {
  if (mutability === "view" || mutability === "pure") {
    return "bg-panel text-ink-faint ring-line";
  }
  if (mutability === "payable") {
    return "bg-hood-wash text-hood-deep ring-hood/30";
  }
  return "bg-amber-50 text-amber-700 ring-amber-200";
}

interface ContractPanelProps {
  name: string;
  abi: AbiEntry[];
  deployedAddress: string | null;
  explorerUrl: string | null;
  // Blockscout's own verdict on the source; null when no deploy exists.
  verified: boolean | null;
  verifyError: string | null;
}

// What the explorer said about the source, never what Fletch assumed.
function verificationLine(verified: boolean | null, verifyError: string | null, explorerUrl: string | null): React.JSX.Element | null {
  if (verified === null) {
    return null;
  }
  if (verified && explorerUrl) {
    return (
      <a href={`${explorerUrl}?tab=contract`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-hood-deep underline underline-offset-4">
        <Check className="h-3 w-3" strokeWidth={2.2} />
        Source verified on the chain explorer
      </a>
    );
  }
  return <p className="mt-1.5 text-[12px] text-ink-faint">Source not verified on the chain explorer{verifyError ? `: ${publicDiagnostic(verifyError)}` : "."}</p>;
}

export function ContractPanel({ name, abi, deployedAddress, explorerUrl, verified, verifyError }: ContractPanelProps) {
  const [copied, setCopied] = useState(false);

  const functions = abi.filter(function isFunction(entry) {
    return entry.type === "function";
  });
  const events = abi.filter(function isEvent(entry) {
    return entry.type === "event";
  });

  async function copyAbi(): Promise<void> {
    await navigator.clipboard.writeText(JSON.stringify(abi, null, 2));
    setCopied(true);
    setTimeout(function reset() {
      setCopied(false);
    }, 1600);
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-raised">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="mono-label">contract</span>
        <span className="font-mono text-[13px] text-ink">{name}</span>
        <button
          type="button"
          onClick={copyAbi}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          {copied ? (
            <Check className="h-3 w-3 text-hood-deep" strokeWidth={2.2} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={1.8} />
          )}
          {copied ? "Copied" : "Copy ABI"}
        </button>
      </header>

      <div className="border-b border-line px-4 py-3">
        {deployedAddress && explorerUrl ? (
          <div>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 font-mono text-[12px] text-hood-deep underline underline-offset-4"
            >
              <Radio className="h-3.5 w-3.5" strokeWidth={1.8} />
              {deployedAddress}
            </a>
            {verificationLine(verified, verifyError, explorerUrl)}
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.8} />
            <p className="text-[12.5px] leading-5 text-ink-soft">
              Not deployed. The contract compiles and its tests pass, but nothing has been
              broadcast to a chain yet — so there is no address to read or write.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-raised p-4">
          <p className="mono-label mb-2">functions · {functions.length}</p>
          <ul className="space-y-1.5">
            {functions.map(function renderFunction(entry) {
              return (
                <li key={signature(entry)} className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] uppercase ring-1 ring-inset ${mutabilityTone(entry.stateMutability)}`}
                  >
                    {entry.stateMutability === "view" || entry.stateMutability === "pure"
                      ? "read"
                      : "write"}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-soft">
                    {signature(entry)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="bg-raised p-4">
          <p className="mono-label mb-2">events · {events.length}</p>
          <ul className="space-y-1.5">
            {events.map(function renderEvent(entry) {
              return (
                <li key={signature(entry)} className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.8} />
                  <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-soft">
                    {signature(entry)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
