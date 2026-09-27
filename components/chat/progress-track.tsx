"use client";

import { Check } from "@/components/ui/icons";
import { progressSteps, type ProgressTrackProps, type StepState } from "@/components/chat/progress-steps";
export { progressSteps } from "@/components/chat/progress-steps";

interface CompactProgressProps extends ProgressTrackProps {
  onOpenChat?: () => void;
}

const STATE: Record<StepState, string> = {
  todo: "text-ink-faint",
  active: "bg-hood-wash text-hood-deep",
  done: "text-hood-deep",
  skipped: "text-ink-soft",
  blocked: "text-amber-700",
};

export function ProgressTrack(props: CompactProgressProps): React.ReactElement {
  return (
    <ol aria-label="Build pipeline" className="flex flex-wrap items-center justify-center gap-1">
      {progressSteps(props).map(function renderStep(step) {
        let onClick: (() => void) | undefined;
        if (step.key === "idea") onClick = props.onOpenChat;
        if (step.key === "contract" || step.key === "page") onClick = props.onOpenCode;
        const content = <>
          {step.state === "done" ? <Check className="h-2.5 w-2.5 shrink-0" /> : null}
          {step.state === "active" ? <span className="h-1 w-1 shrink-0 rounded-full bg-hood motion-safe:animate-pulse" /> : null}
          <span>{step.label}</span>
        </>;
        const className = `inline-flex min-h-6 items-center gap-1 rounded-lg border border-line px-1.5 text-[10px] font-medium focus-visible:outline-2 focus-visible:outline-hood ${STATE[step.state]}`;
        return <li key={step.key} title={`${step.label}: ${step.detail}`}>
          {step.href ? <a href={step.href} target="_blank" rel="noreferrer" className={`${className} hover:bg-panel`}>{content}</a> : null}
          {!step.href && onClick ? <button type="button" onClick={onClick} className={`${className} hover:bg-panel`}>{content}</button> : null}
          {!step.href && !onClick ? <span className={className}>{content}</span> : null}
        </li>;
      })}
    </ol>
  );
}
