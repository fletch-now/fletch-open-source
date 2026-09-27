import { inspectBuildCapacity } from "@/lib/build/capacity";
import { changeBuildCapacity } from "@/lib/admin/capacity-actions";
import { ActionForm } from "@/components/admin/action-form";
import { Panel } from "@/components/dashboard/ui";
import type { ReactElement } from "react";

export async function BuildCapacityPanel(): Promise<ReactElement> {
  const capacity = await inspectBuildCapacity();
  const reservedSessions = Math.min(capacity.current, Math.floor(capacity.sharedAdmission.watermarkBytes / capacity.sharedAdmission.reservationBytes));

  return (
    <Panel title="Build capacity" description="One queue limit shared by the website and the build worker.">
      <div className="space-y-4 px-5 py-4 text-sm text-ink">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-ink-soft">Current limit</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums">{capacity.current} builds</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Conservative ceiling</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums">{capacity.eligibleMaximum} builds</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Shared configuration ceiling</dt>
            <dd className="mt-1 text-xl font-medium tabular-nums">{capacity.sharedEligibleMaximum} sessions</dd>
          </div>
          <div>
            <dt className="text-ink-soft">Active policy</dt>
            <dd className="mt-1 font-medium">{capacity.profile === "shared-experimental" ? "Shared testing" : "Conservative"}</dd>
          </div>
        </dl>
        {capacity.profile === "shared-experimental" ? (
          <p className="text-ink-soft">Memory admission allows up to {reservedSessions} reserved sessions on this executor, and fewer when memory pressure rises. The configured ceiling does not guarantee simultaneous execution.</p>
        ) : null}
        <p className="text-ink-soft">Shared testing admits sessions while memory is available. Compilers share the same CPU and memory limits. Simultaneous heavy work can slow or fail builds; model-provider limits still apply.</p>
        {capacity.reasons.length ? (
          <ul className="list-disc space-y-1 pl-4 text-ink-soft">
            {capacity.reasons.map(function reason(text) { return <li key={text}>{text}</li>; })}
          </ul>
        ) : null}
        {capacity.sharedReasons.length ? <p className="text-ink-soft">Shared testing: {capacity.sharedReasons.join(" ")}</p> : null}
        <ActionForm
          action={changeBuildCapacity}
          fields={{ expectedFingerprint: capacity.fingerprint }}
          label="Save build limit"
          tone="primary"
          className="items-start gap-3"
        >
          <fieldset className="w-full space-y-2">
            <legend className="mb-2">Admission policy</legend>
            <label className="flex items-center gap-2"><input name="profile" type="radio" value="conservative" defaultChecked={capacity.profile === "conservative"} className="accent-hood" />Conservative</label>
            <label className="flex items-center gap-2"><input name="profile" type="radio" value="shared-experimental" defaultChecked={capacity.profile === "shared-experimental"} className="accent-hood" />Shared testing</label>
          </fieldset>
          <label className="flex w-full flex-col gap-1.5" htmlFor="build-capacity">
            Concurrent builds
            <input id="build-capacity" name="capacity" type="number" min={1} max={Math.max(2, capacity.eligibleMaximum, capacity.sharedEligibleMaximum)} step={1} defaultValue={capacity.current} required className="h-10 w-28 rounded-lg border border-line bg-paper px-3 text-ink focus-visible:outline-2 focus-visible:outline-hood" />
          </label>
          <label className="flex w-full flex-col gap-1.5" htmlFor="capacity-benchmark">
            Benchmark receipt SHA-256
            <input id="capacity-benchmark" name="benchmarkReceipt" defaultValue={capacity.setting?.version === 2 ? capacity.setting.benchmarkReceipt : ""} maxLength={64} pattern="[a-f0-9]{64}" placeholder="Required for shared testing" className="h-10 w-full rounded-lg border border-line bg-paper px-3 font-mono text-xs text-ink focus-visible:outline-2 focus-visible:outline-hood" />
          </label>
          <label className="flex w-full flex-col gap-1.5" htmlFor="capacity-reason">
            Reason for this change
            <input id="capacity-reason" name="reason" minLength={4} maxLength={200} required placeholder="Load test result or reason for reducing capacity" className="h-10 w-full rounded-lg border border-line bg-paper px-3 text-ink focus-visible:outline-2 focus-visible:outline-hood" />
          </label>
          <label className="flex w-full items-start gap-2 text-ink-soft">
            <input type="checkbox" name="reviewed" className="mt-0.5 accent-hood" />
            <span>I reviewed the benchmark and provider limits. Shared testing can encounter contention and build failures. Required for shared testing or more than two builds.</span>
          </label>
          <p className="w-full text-xs text-ink-soft">Reducing the limit lets current builds finish. Waiting requests retain their queue order and cancellation controls.</p>
        </ActionForm>
      </div>
    </Panel>
  );
}
