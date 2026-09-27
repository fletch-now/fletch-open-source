"use client";

import { useActionState } from "react";
import { unlockAdminAction, type UnlockResult } from "@/app/(admin)/trafalgar/unlock/actions";

interface UnlockFormProps {
  configured: boolean;
}

export function UnlockForm({ configured }: UnlockFormProps) {
  const [result, submit, pending] = useActionState<UnlockResult | null, FormData>(unlockAdminAction, null);

  if (!configured) {
    return (
      <p className="mt-6 rounded-md border border-dashed border-line-strong px-3 py-2 font-mono text-[12px] leading-5 text-ink-faint">
        No admin password is set on this server. Set ADMIN_PASSWORD_HASH from scripts/admin-password.mjs and restart.
      </p>
    );
  }

  return (
    <form action={submit} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-ink-soft">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          className="h-11 rounded-lg border border-line bg-raised px-3 text-[14px] text-ink focus:border-hood/60 focus:outline-none"
        />
      </label>
      {result?.error ? <p className="text-[13px] text-red-700">{result.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
