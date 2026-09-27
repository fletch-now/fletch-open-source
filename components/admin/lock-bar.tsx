import { lockAdminAction } from "@/app/(admin)/trafalgar/unlock/actions";

// One line at the top of every console page: the console is open, and a way
// to close it without signing the wallet out.
export function LockBar() {
  return (
    <form action={lockAdminAction} className="flex items-center justify-end gap-3 border-b border-line px-5 py-2 font-mono text-[11.5px] text-ink-faint sm:px-8">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hood" />
        console unlocked
      </span>
      <button type="submit" className="rounded-full border border-line px-3 py-1 text-ink-soft transition-colors hover:border-line-strong hover:text-ink">
        Lock
      </button>
    </form>
  );
}
