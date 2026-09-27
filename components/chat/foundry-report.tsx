"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, FlaskConical, Hammer, Triangle } from "@/components/ui/icons";
import { CONTRACT_SIZE_LIMIT } from "@/lib/build/types";
import type { CompileReport, ContractSummary, TestReport } from "@/lib/build/types";
import type { Stage } from "@/components/chat/pipeline";

// What the toolchain actually said. This is the one surface in the product that is
// not a model talking about its own work — solc compiled it, forge ran it — so it
// is rendered as measured output: real byte counts, real gas, real errors.

const COUNT_MS = 900;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Numbers count up to their measured value; the reading is the point, so it is
// given a moment rather than simply appearing.
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(
    function animate() {
      // Reduced motion takes the same path and simply lands on the first frame,
      // which keeps this to one code path and never sets state synchronously.
      const instant = prefersReducedMotion();
      const startedAt = performance.now();
      function step(now: number): void {
        const progress = instant ? 1 : Math.min(1, (now - startedAt) / COUNT_MS);
        // Ease-out cubic: fast to nearly-there, then settles.
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(target * eased));
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(step);
        }
      }
      frameRef.current = requestAnimationFrame(step);
      return function cancel() {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
        }
      };
    },
    [target],
  );

  return value;
}

// Width is applied after mount so the bar grows from zero instead of appearing full.
function useGrown(): boolean {
  const [grown, setGrown] = useState(false);
  useEffect(function grow() {
    const id = requestAnimationFrame(function apply() {
      setGrown(true);
    });
    return function cancel() {
      cancelAnimationFrame(id);
    };
  }, []);
  return grown;
}

function DrawnCheck({ tone }: { tone: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`fr-check h-4 w-4 shrink-0 ${tone}`} aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
      <path
        d="M6 10.4l2.7 2.6L14.2 7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function sizeTone(ratio: number): { bar: string; text: string } {
  if (ratio > 0.9) {
    return { bar: "bg-red-500", text: "text-red-600" };
  }
  if (ratio > 0.6) {
    return { bar: "bg-amber-500", text: "text-amber-700" };
  }
  return { bar: "bg-hood", text: "text-hood-deep" };
}

function ContractRow({ contract, index }: { contract: ContractSummary; index: number }) {
  const grown = useGrown();
  const bytes = useCountUp(contract.bytecodeBytes);
  const ratio = Math.min(1, contract.bytecodeBytes / CONTRACT_SIZE_LIMIT);
  const tone = sizeTone(ratio);

  return (
    <li className="fr-item space-y-1.5" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex items-baseline gap-2">
        <span className="truncate font-mono text-[12px] text-ink">{contract.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-ink-faint">
          {contract.functions} fn · {contract.events} ev
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`fr-bar-fill h-full rounded-full ${tone.bar}`}
          style={{ width: grown ? `${Math.max(2, ratio * 100)}%` : "0%" }}
        />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-[10.5px] tabular-nums ${tone.text}`}>
          {bytes.toLocaleString()} B
        </span>
        <span className="font-mono text-[10.5px] text-ink-faint">
          of {CONTRACT_SIZE_LIMIT.toLocaleString()} limit
        </span>
      </div>
    </li>
  );
}

function TestRow({ test, index }: { test: TestReport["cases"][number]; index: number }) {
  const gas = useCountUp(test.gas ?? 0);
  return (
    <li
      className="fr-item flex items-center gap-2 py-0.5"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      {test.passed ? (
        <DrawnCheck tone="text-hood-deep" />
      ) : (
        <CircleAlert className="h-4 w-4 shrink-0 text-red-600" strokeWidth={1.8} />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-soft">
        {test.name}
      </span>
      {test.gas === null ? null : (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-faint">
          {gas.toLocaleString()} gas
        </span>
      )}
    </li>
  );
}

interface FoundryReportProps {
  compile: CompileReport | null;
  tests: TestReport | null;
  // True while the build is still running, so the header can show the toolchain
  // working rather than an empty result.
  running: boolean;
  // Which stage the build is in, so the header says "waiting for code" rather
  // than "compiling" while the agent is still writing.
  stage?: Stage;
  className?: string;
}

function runningLabel(stage: Stage): string {
  switch (stage) {
    case "writing":
      return "waiting for code";
    case "compiling":
      return "compiling";
    case "testing":
      return "testing";
    default:
      return "working";
  }
}

export function FoundryReport({ compile, tests, running, stage = "idle", className }: FoundryReportProps) {
  if (!compile && !running) {
    return null;
  }

  const compiling = !compile && running;
  const failed = compile ? !compile.ok : false;

  return (
    <section
      className={`overflow-hidden rounded-xl border bg-raised ${
        failed ? "border-red-200" : "border-line"
      } ${className ?? ""}`}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Hammer
          className={`h-3.5 w-3.5 ${compiling ? "fr-pulse text-ink-faint" : "text-ink-soft"}`}
          strokeWidth={1.8}
        />
        <span className="mono-label">foundry</span>
        {compile ? (
          <span className="font-mono text-[10.5px] text-ink-faint">solc {compile.solc}</span>
        ) : null}
        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-ink-faint">
          {compile ? `${compile.durationMs} ms` : runningLabel(stage)}
        </span>
      </header>

      {compiling ? (
        <div className="px-3 py-3">
          <div className={`h-1 w-full rounded-full bg-line ${stage === "writing" ? "" : "fr-running"}`} />
          <p className="mt-2 text-[12px] leading-5 text-ink-faint">
            {stage === "writing" ? "solc and forge run as soon as the agent has written the contracts." : "The compiler's verdict lands here: sizes, warnings, then every test with its gas."}
          </p>
        </div>
      ) : null}

      {compile?.ok ? (
        <div className="space-y-3 px-3 py-3">
          <div className="flex items-center gap-2">
            <DrawnCheck tone="text-hood-deep" />
            <span className="text-[12.5px] text-ink">
              Compiled {compile.contracts.length}{" "}
              {compile.contracts.length === 1 ? "contract" : "contracts"}
            </span>
            {compile.warnings > 0 ? (
              <span className="ml-auto flex items-center gap-1 font-mono text-[10.5px] text-amber-700">
                <Triangle className="h-3 w-3" strokeWidth={2} />
                {compile.warnings}
              </span>
            ) : null}
          </div>
          <ul className="space-y-2.5">
            {compile.contracts.map(function renderContract(contract, index) {
              return <ContractRow key={contract.name} contract={contract} index={index} />;
            })}
          </ul>
        </div>
      ) : null}

      {compile && !compile.ok ? (
        <ul className="space-y-2 px-3 py-3">
          {compile.errors.map(function renderError(error, index) {
            return (
              <li
                key={`${error.file ?? "solc"}-${index}`}
                className="fr-item flex gap-2"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" strokeWidth={1.8} />
                <div className="min-w-0">
                  {error.file ? (
                    <p className="font-mono text-[10.5px] text-ink-faint">{error.file}</p>
                  ) : null}
                  <p className="text-[12px] leading-5 text-ink-soft">{error.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!tests && compile?.ok && running && stage === "testing" ? (
        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="fr-pulse h-3.5 w-3.5 text-ink-faint" strokeWidth={1.8} />
            <span className="text-[12.5px] text-ink-soft">Running forge test and Slither</span>
          </div>
          <div className="fr-running mt-2 h-1 w-full rounded-full bg-line" />
        </div>
      ) : null}

      {tests ? (
        <div className="space-y-2 border-t border-line px-3 py-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.8} />
            <span className="text-[12.5px] text-ink">
              {tests.passed}/{tests.total} tests passed
            </span>
            <span className="ml-auto font-mono text-[10.5px] tabular-nums text-ink-faint">
              {tests.durationMs} ms
            </span>
          </div>
          <ul>
            {tests.cases.map(function renderTest(test, index) {
              return <TestRow key={`${test.suite}.${test.name}`} test={test} index={index} />;
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
