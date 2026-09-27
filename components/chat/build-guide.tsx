"use client";

import { FlaskConical, Hammer, PenLine, Sparkles } from "@/components/ui/icons";

// What the console shows before the first prompt. An empty box tells a new user
// nothing about what to type or what they are about to get, so this states the
// three things that actually happen and hands over prompts worth stealing.

const STAGES = [
  {
    icon: PenLine,
    label: "Write",
    body: "An agent writes the Solidity contract and a Vite + wagmi front end, using a verified registry of Robinhood Chain addresses and RPCs.",
  },
  {
    icon: Hammer,
    label: "Compile",
    body: "solc 0.8.28 compiles it inside a locked-down sandbox. Real compiler errors go back to the agent, which fixes them and tries again.",
  },
  {
    icon: FlaskConical,
    label: "Verify",
    body: "forge test runs the suite. You see gas per test and the deployed bytecode size against the 24,576-byte on-chain limit.",
  },
];

interface BuildGuideProps {
  prompts: Array<{ label: string; prompt: string }>;
  onPick: (prompt: string) => void;
}

export function BuildGuide({ prompts, onPick }: BuildGuideProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-7 py-6">
      <div className="fr-item text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-hood-wash px-2.5 py-1 text-[11px] font-medium text-hood-deep ring-1 ring-inset ring-hood/25">
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          Robinhood Chain testnet 46630
        </span>
        <h2 className="display mt-3 text-[22px] text-ink sm:text-[25px]">
          Describe the app you want.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-ink-soft">
          Be specific about what it stores and who can call it. A sentence or two is
          enough. The detail you give is the detail you get back.
        </p>
      </div>

      <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {STAGES.map(function renderStage(stage, index) {
          const Icon = stage.icon;
          return (
            <li
              key={stage.label}
              className="fr-item flex flex-col gap-2 bg-raised p-4"
              style={{ animationDelay: `${80 + index * 80}ms` }}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center text-ink-soft">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                </span>
                <span className="text-[13px] font-medium text-ink">{stage.label}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">
                  0{index + 1}
                </span>
              </div>
              <p className="text-[12px] leading-5 text-ink-soft">{stage.body}</p>
            </li>
          );
        })}
      </ol>

      <div className="fr-item" style={{ animationDelay: "340ms" }}>
        <p className="mono-label mb-2.5">start from one of these</p>
        <div className="flex flex-wrap gap-2">
          {prompts.map(function renderPrompt(item) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={function pick() {
                  onPick(item.prompt);
                }}
                className="group flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5 text-left text-[12.5px] text-ink-soft transition-all hover:-translate-y-px hover:border-hood/40 hover:text-ink hover:shadow-[0_6px_18px_-12px_rgba(14,16,15,0.5)]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-line-strong transition-colors group-hover:bg-hood" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="fr-item text-center text-[11.5px] text-ink-faint" style={{ animationDelay: "500ms" }}>
        Every finished build gets a project page. When its asset is registry-verified, watch it there for large transfers.
      </p>
    </div>
  );
}
