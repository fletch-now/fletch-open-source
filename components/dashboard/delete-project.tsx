"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface DeleteProjectProps {
  projectId: string;
  name: string;
  // Where to go once it is gone; the project page cannot stay open.
  afterHref?: string;
  compact?: boolean;
}

// Two clicks, no modal: the first turns the button into the question, the
// second deletes the workspace and hosted site. Execution and credit records remain.
export function DeleteProject({ projectId, name, afterHref, compact = false }: DeleteProjectProps) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    setBusy(true);
    let confirmed = false;
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const body = (await response.json().catch(function ignore() {
        return {};
      })) as { error?: string; freedBytes?: number };
      if (!response.ok) {
        toast.error(body.error ?? "Could not delete the project.");
        return;
      }
      confirmed = true;
      const freed = body.freedBytes ? ` ${(body.freedBytes / (1024 * 1024)).toFixed(1)} MB freed.` : "";
      toast.success(`Deleted ${name}.${freed}`);
      if (afterHref) {
        router.push(afterHref);
      }
      router.refresh();
    } catch {
      if (confirmed) toast.success(`Deleted ${name}. Refresh the page to update your project list.`);
      else toast.error("Could not confirm deletion. Retry Delete to check and finish it.");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  if (asking) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-2 ${compact ? "text-[12px]" : "text-[13px]"}`}>
        <span className="text-ink-soft">Delete {name}? Its workspace and hosted site will be removed. Build receipts and credit history are kept.</span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="h-8 rounded-full bg-red-600 px-3 font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={function cancel() {
            setAsking(false);
          }}
          className="h-8 rounded-full border border-line px-3 text-ink-soft transition-colors hover:text-ink"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={function ask() {
        setAsking(true);
      }}
      className={`text-ink-faint underline-offset-4 transition-colors hover:text-red-700 hover:underline ${compact ? "text-[12px]" : "text-[13px]"}`}
    >
      Delete
    </button>
  );
}
