"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/admin/actions";

type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface ActionFormProps {
  action: FormAction;
  // Hidden inputs the action reads; visible fields go in children.
  fields: Record<string, string>;
  label: string;
  tone?: "neutral" | "danger" | "primary";
  confirm?: string;
  children?: ReactNode;
  className?: string;
}

const BUTTON_TONE: Record<NonNullable<ActionFormProps["tone"]>, string> = {
  neutral: "border border-line text-ink-soft hover:border-line-strong hover:text-ink",
  danger: "border border-line text-red-700 hover:border-red-300 hover:bg-red-50",
  primary: "bg-ink text-paper hover:opacity-90",
};

// One form per operator action: hidden fields carry the ids, the action runs on
// the server with its own admin check, and the result lands inline next to the
// button rather than on a separate page.
export function ActionForm({ action, fields, label, tone = "neutral", confirm, children, className }: ActionFormProps) {
  const [result, submit, pending] = useActionState(action, null);

  function guard(event: React.FormEvent<HTMLFormElement>): void {
    if (confirm && !window.confirm(confirm)) {
      event.preventDefault();
    }
  }

  return (
    <form action={submit} onSubmit={guard} className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {Object.entries(fields).map(function renderHidden([name, value]) {
        return <input key={name} type="hidden" name={name} value={value} />;
      })}
      {children}
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${BUTTON_TONE[tone]}`}
      >
        {pending ? "Working…" : label}
      </button>
      {result ? (
        <span className={`text-[12.5px] ${result.ok ? "text-hood-deep" : "text-red-700"}`} role="status">
          {result.message}
        </span>
      ) : null}
    </form>
  );
}

interface SimpleActionProps {
  action: () => Promise<ActionResult>;
  label: string;
  tone?: ActionFormProps["tone"];
}

// For actions that take no input at all (sync now, reap now).
export function SimpleAction({ action, label, tone = "neutral" }: SimpleActionProps) {
  async function run(): Promise<ActionResult> {
    return action();
  }
  const [result, submit, pending] = useActionState(run, null);
  return (
    <form action={submit} className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className={`inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${BUTTON_TONE[tone]}`}
      >
        {pending ? "Working…" : label}
      </button>
      {result ? (
        <span className={`text-[12.5px] ${result.ok ? "text-hood-deep" : "text-red-700"}`} role="status">
          {result.message}
        </span>
      ) : null}
    </form>
  );
}
