"use client";
import { ExternalLink } from "@/components/ui/icons";
import Link from "@/components/ui/navigation-link";
import type { PublicationStatus } from "@/lib/hosting/publication-types";

interface Props {
  status: PublicationStatus | null;
  error: string | null;
  submitting: boolean;
  building: boolean;
  onPublish: () => Promise<void>;
  projectSlug?: string;
}

export function PublishControl({ status, error, submitting, building, onPublish, projectSlug }: Props): React.ReactElement {
  const working = submitting || status?.job?.state === "queued" || status?.job?.state === "publishing";
  const changed = Boolean(status?.draft && status.draft.buildId !== status.live?.buildId);
  const failed = status?.job?.state === "failed" && status.job.buildId === status.draft?.buildId;
  const failure = error ?? (failed ? status?.job?.error : null);
  let label = "Publish live app";
  if (working) label = status?.job?.state === "queued" ? "Queued to publish" : "Publishing app";
  else if (failed) label = "Retry publishing";
  else if (changed && status?.live) label = "Publish changes";
  let announcement = "Finish a build to enable publishing.";
  if (working) announcement = `${label}. You can leave this page; publishing continues.`;
  else if (changed) announcement = "A saved preview is ready to publish.";
  else if (status?.live) announcement = "Your published app is live.";
  const style = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-hood-deep/20 bg-hood px-4 py-2.5 text-[13px] font-semibold text-ink shadow-sm transition-colors hover:bg-hood/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood-deep motion-reduce:transition-none";

  return <div className="min-w-0 max-w-full" data-publish-control>
    {status?.live && !changed && !working ? <a href={status.live.url} target="_blank" rel="noreferrer" className={style}>
      Open live app <ExternalLink className="h-4 w-4" />
    </a> : <button type="button" onClick={() => void onPublish()} disabled={working || building || !status?.draft}
      aria-busy={working} className={`${style} disabled:cursor-not-allowed disabled:opacity-60`}>
      {working ? <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
        : <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13V3m-4 4 4-4 4 4M4 12v5h12v-5" /></svg>}
      {label}
    </button>}
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {status?.live && projectSlug ? <Link href={`/dashboard/projects/${projectSlug}#directory-listing`} className="flex min-h-11 items-center justify-center text-xs font-medium text-hood-deep underline underline-offset-4">Manage directory listing</Link> : null}
    {failure ? <p role="alert" className="mt-1 max-w-64 text-xs text-red-700">{failure}</p> : null}
  </div>;
}
