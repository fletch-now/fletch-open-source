"use client";
import { useActionState, useState, type ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { saveDraft, publishDraft, type PricingActionState } from "./actions";
import type { PricingDraft } from "@/lib/admin/pricing";

const TIERS = ["small", "medium", "large"] as const;
const PACKAGE_FIELDS = [
  { name: "credits", label: "Fletch credits", min: 1, max: 1000 },
  { name: "modelRequests", label: "Model requests", min: 1, max: 1000 },
  { name: "toolRuns", label: "Platform tool runs", min: 1, max: 500 },
  { name: "activeSeconds", label: "Active work (seconds)", min: 60, max: 14400 },
  { name: "maxAgentStepsPerTurn", label: "Agent steps per turn", min: 1, max: 100 },
] as const;
const SHARED_FIELDS = [
  { name: "quoteLifetimeSeconds", label: "Quote validity (seconds)", min: 60, max: 3600 },
  { name: "approvalWindowSeconds", label: "Paused approval window (seconds)", min: 300, max: 86400 },
  { name: "maxPackages", label: "Maximum packages per build", min: 1, max: 10 },
] as const;

function initialFields(draft: PricingDraft | null): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const tier of TIERS) {
    const pack = draft?.policy.tiers[tier];
    for (const field of PACKAGE_FIELDS) {
      const value = field.name === "credits" ? pack?.credits : pack?.allowance[field.name];
      fields[`${tier}.${field.name}`] = value === undefined ? "" : String(value);
    }
  }
  for (const field of SHARED_FIELDS) {
    const value = draft?.policy[field.name];
    fields[field.name] = value === undefined ? "" : String(value);
  }
  return fields;
}

async function saveFields(previous: PricingActionState | null, form: FormData): Promise<PricingActionState> {
  function number(name: string): number { return Number(form.get(name)); }
  const tiers = Object.fromEntries(TIERS.map(function pack(tier) {
    return [tier, { credits: number(`${tier}.credits`), allowance: {
      modelRequests: number(`${tier}.modelRequests`), toolRuns: number(`${tier}.toolRuns`),
      activeSeconds: number(`${tier}.activeSeconds`), maxAgentStepsPerTurn: number(`${tier}.maxAgentStepsPerTurn`),
    } }];
  }));
  form.set("policy", JSON.stringify({ schemaVersion: 1, chainId: 46630, mode: "fixed_packages", tiers,
    quoteLifetimeSeconds: number("quoteLifetimeSeconds"), approvalWindowSeconds: number("approvalWindowSeconds"),
    maxPackages: number("maxPackages"), refund: "full_refund_on_failure_or_stop",
  }));
  return saveDraft(previous, form);
}

function PricingFields({ draft }: { draft: PricingDraft | null }): ReactElement {
  const [state, action, pending] = useActionState(saveFields, null);
  const [fields, setFields] = useState(function initial() { return initialFields(draft); });
  function input(field: { name: string; label: string; min: number; max: number }, name = field.name): ReactElement {
    return <label key={name} className="block min-w-0 text-sm" htmlFor={`pricing-${name}`}>
      <span className="mb-1.5 block">{field.label}</span>
      <input id={`pricing-${name}`} name={name} type="number" required min={field.min} max={field.max} step={1}
        value={fields[name]} onChange={function change(event) { const value = event.target.value; setFields(function update(current) { return { ...current, [name]: value }; }); }}
        className="w-full min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-ink tabular-nums" />
    </label>;
  }
  return <form action={action} className="space-y-5">
    <input type="hidden" name="draftId" value={draft?.id ?? ""} /><input type="hidden" name="revision" value={draft?.revision ?? 0} />
    <fieldset disabled={pending} className="min-w-0 space-y-5 disabled:opacity-60">
      <legend className="sr-only">Package prices and allowances</legend>
      <div className="grid gap-4 md:grid-cols-3">{TIERS.map(function tierFields(tier) {
        return <fieldset key={tier} className="min-w-0 space-y-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-base font-medium capitalize">{tier}</legend>
          {PACKAGE_FIELDS.map(function field(item) { return input(item, `${tier}.${item.name}`); })}
        </fieldset>;
      })}</div>
      <p className="text-sm">Enter whole numbers. Active work is in seconds: 60 is one minute; 3,600 is one hour. Larger packages must include at least the previous package&apos;s credits, requests, tool runs and active time.</p>
      <fieldset className="min-w-0 rounded-xl border border-line p-4">
        <legend className="px-1 text-base font-medium">Shared limits</legend>
        <div className="grid gap-4 md:grid-cols-3">{SHARED_FIELDS.map(function field(item) { return input(item); })}</div>
        <p className="mt-3 text-sm">The maximum includes the first package. Every extra package requires approval. Failure or Stop releases reserved credits; own-key builds use zero Fletch credits.</p>
      </fieldset>
      <button disabled={pending} className="rounded-lg bg-ink px-4 py-2 text-paper">{pending ? "Saving…" : "Save draft"}</button>
    </fieldset>
    {state ? <p role="status" className="text-sm">{state.message} {state.draftId ? <Link href={`/trafalgar/pricing?draft=${state.draftId}`} className="underline">Review saved draft</Link> : null}</p> : null}
  </form>;
}

export function PricingEditor({ draft }: { draft: PricingDraft | null }): ReactElement {
  return <PricingFields key={`${draft?.id ?? "new"}:${draft?.revision ?? 0}:${draft?.digest ?? ""}`} draft={draft} />;
}

export function PricingPublisher({ draft, active }: { draft: PricingDraft; active: string | null }): ReactElement {
  const [state, action, pending] = useActionState(publishDraft, null);
  return <form action={action} className="mt-5 space-y-3">
    <input type="hidden" name="draftId" value={draft.id} /><input type="hidden" name="revision" value={draft.revision} /><input type="hidden" name="digest" value={draft.digest} /><input type="hidden" name="active" value={active ?? ""} />
    <label htmlFor="pricing-reason" className="block text-sm">Reason for publishing</label><input id="pricing-reason" name="reason" required maxLength={300} className="w-full rounded-lg border border-line p-3" />
    <button disabled={pending} className="rounded-lg bg-ink px-4 py-2 text-paper">{pending ? "Publishing…" : "Publish reviewed prices"}</button>
    {state ? <p role="status" className="text-sm">{state.message}</p> : null}
  </form>;
}
