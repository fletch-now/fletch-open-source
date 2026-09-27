"use client";

import { useActionState } from "react";
import type { HolderPolicy } from "@/lib/holder-rewards/model";
import { savePolicy } from "./actions";

const inputClass = "mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-hood";

export function HolderPolicyForm({ policy }: { policy: HolderPolicy }): React.ReactNode {
  const [state, action, pending] = useActionState(savePolicy, null);
  return (
    <form action={action} className="space-y-5 rounded-xl border border-line bg-raised p-4 sm:p-6">
      <input type="hidden" name="revision" value={policy.revision} />
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm">Network<select name="chainId" defaultValue={policy.chainId ?? ""} className={inputClass}><option value="">Not configured</option><option value="4663">Robinhood Chain mainnet (4663)</option></select></label>
        <label className="text-sm">Official $FLTX contract<input name="tokenAddress" maxLength={42} defaultValue={policy.tokenAddress ?? ""} placeholder="0x…" className={`${inputClass} font-mono`} /></label>
        <label className="text-sm">Verified reference pool ID<input name="referencePoolId" maxLength={100} defaultValue={policy.referencePoolId ?? ""} placeholder="Detect from Registry when left blank" className={`${inputClass} font-mono`} /></label>
        <label className="text-sm">Reward period<select name="period" defaultValue={policy.period ?? ""} className={inputClass}><option value="">Decision pending</option><option value="once">10 credits once</option><option value="utc_month">10 credits each calendar month (UTC)</option><option value="utc_day">10 credits each calendar day (UTC)</option></select></label>
        <label className="text-sm">Minimum reference-market depth (USD)<input name="minDepthUsd" type="number" min="25000" max="999999999" step="0.01" defaultValue={policy.minDepthUsd} className={inputClass} /></label>
        <label className="text-sm">Maximum grants each day<input name="maxGrantsPerDay" type="number" min="1" max="1000" defaultValue={policy.maxGrantsPerDay} className={inputClass} /></label>
      </div>
      <p className="text-sm leading-6 text-ink-soft">The threshold is strictly more than $100. Each grant adds 10 build credits. Unspent credits do not expire. The minimum market depth is $25,000. The reference market must belong to this exact contract and have current USD conversion and chain evidence.</p>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6"><input type="checkbox" name="immediateGrantAccepted" defaultChecked={policy.immediateGrantAccepted} className="mt-1 size-5 shrink-0" /><span>Use immediate grants after balances settle. I accept that tokens can be moved between wallets to obtain additional grants. Address/account deduplication and the daily ceiling do not establish one reward per person. If a holding period is required, keep this off until that rule is implemented and verified.</span></label>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={policy.enabled} className="size-5" />Enable automatic holder grants</label>
      {state ? <p role="status" className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{state.message}</p> : null}
      <button disabled={pending} className="min-h-11 rounded-lg bg-hood px-5 text-sm font-medium text-black disabled:opacity-50">{pending ? "Verifying and saving…" : "Save holder-credit policy"}</button>
    </form>
  );
}
