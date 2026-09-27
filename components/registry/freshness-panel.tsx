import { LiveAge } from "./live-reading";
import { TableShell } from "@/components/registry/table-shell";
import Link from "@/components/ui/navigation-link";
import type { CheckpointProgress, FigureFreshness, FigureVerdict, Freshness, JobFreshness, OverallVerdict } from "@/lib/registry/authority/freshness";
import { DEGRADED_JOB_THRESHOLD, durationText, VERDICT_MEANING } from "@/lib/registry/authority/freshness";
import { stillFilling } from "@/lib/registry/authority/cadence";
import { ago, blockText } from "@/components/registry/format";
import { InfoTip } from "@/components/registry/info-tip";
import { REGISTRY_TERMS } from "@/components/registry/terms";

// The status page's pieces: the verdict banner, the scanners still reading
// history, the job table and the figure table. Every value comes from
// freshness(); nothing is judged at render time.

const PILL: Record<FigureVerdict, string> = {
  fresh: "bg-hood-wash text-hood-deep",
  filling: "bg-panel text-ink-soft",
  stalled: "bg-red-50 text-red-700",
  late: "bg-amber-50 text-amber-800",
  failing: "bg-red-50 text-red-700",
  never: "bg-panel text-ink-faint",
  unread: "bg-panel text-ink-faint",
};

const BANNER: Record<OverallVerdict, { tone: string; dot: string }> = {
  live: { tone: "border-hood-deep/30 bg-hood-wash", dot: "bg-hood" },
  degraded: { tone: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  stale: { tone: "border-red-300 bg-red-50", dot: "bg-red-600" },
  never: { tone: "border-line bg-panel", dot: "bg-ink-faint" },
};

export const DOT: Record<OverallVerdict, string> = {
  live: "bg-hood",
  degraded: "bg-amber-500",
  stale: "bg-red-600",
  never: "bg-ink-faint",
};

export function cadenceText(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${minutes / 60} h`;
}

function ageText(ms: number | null): string {
  return ms === null ? "never" : `${durationText(ms)} ago`;
}

interface PillProps {
  verdict: FigureVerdict;
}

function Pill({ verdict }: PillProps) {
  return (
    <span title={VERDICT_MEANING[verdict]} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[verdict]}`}>
      {verdict}
    </span>
  );
}

interface BannerProps {
  reading: Freshness;
}

export function FreshnessBanner({ reading }: BannerProps) {
  const style = BANNER[reading.verdict];
  const { daemon, head } = reading;
  return (
    <section className={`mt-3 rounded-card border px-4 py-3 ${style.tone}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p className="display flex items-center gap-3 text-[24px] leading-none text-ink">
          <span className={`inline-block h-3.5 w-3.5 rounded-full ${style.dot}`} aria-hidden />
          {reading.verdict}
        </p>
        <p className="text-[15px] text-ink-soft">{reading.summary}</p>
      </div>
      <p className="mt-2 text-[12px] text-ink-soft">The overall status becomes degraded at {DEGRADED_JOB_THRESHOLD} jobs that are not current. Each job keeps its own status below.</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12px] text-ink-soft sm:grid-cols-3">
        <div>
          <dt className="flex items-center gap-1 text-[13px]">Background worker <InfoTip label="About the background worker" text="The registry worker reports a heartbeat every 15 seconds. This shows whether it is running. The jobs below show whether its individual reads succeeded and how far history scans have progressed." /></dt>
          <dd className="mt-0.5 text-ink">
            {daemon.lastBeatAt ? <><LiveAge at={daemon.lastBeatAt.toISOString()} initialLabel={ageText(daemon.ageMs)} /> · {daemon.alive ? "beating" : "not beating"}</> : "never reported"}
            {daemon.jobsReported !== null ? ` · ${daemon.jobsReported} jobs on record` : ""}
            {daemon.failing.length > 0 ? ` · reported failing: ${daemon.failing.join(", ")}` : ""}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[13px]">Last observed block <InfoTip label="About the last observed block" text="The latest chain block seen by the health check, scheduled every minute. Its read time shows how old this observation is. Other jobs can already have read later blocks." /></dt>
          <dd className="mt-0.5 text-ink">{head ? <>block {blockText(head.block)} · <LiveAge at={head.readAt.toISOString()} initialLabel={ageText(head.ageMs)} /></> : "not read yet"}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[13px]">Status checked <InfoTip label="About status reading times" text={REGISTRY_TERMS.freshness} /></dt>
          <dd className="mt-0.5 text-ink"><LiveAge at={reading.checkedAt.toISOString()} initialLabel={ago(reading.checkedAt)} /></dd>
        </div>
      </dl>
    </section>
  );
}

// Whether a scanner is still reading history is a fact about its distance
// from head, not about its job's verdict: a scanner that has never run, or
// whose last run failed, can still be a million blocks back.
function stillReading(point: CheckpointProgress): boolean {
  return stillFilling(point.behind);
}

function fillingSentence(job: JobFreshness, point: CheckpointProgress): string {
  const subject = job.job === "transfer-ledger" ? "The holder ledger" : `The ${job.job} scanner`;
  if (point.behind === null) {
    return `${subject} is at block ${blockText(point.block)}; the chain head has not been read, so its distance from head is unknown.`;
  }
  if (!stillReading(point)) {
    return `${subject} is at head: block ${blockText(point.block)}, ${blockText(point.behind)} behind the last head reading.`;
  }
  const left = point.hoursLeft === null ? "the rate is not measurable yet" : `about ${point.hoursLeft < 1 ? `${Math.max(1, Math.round(point.hoursLeft * 60))} minutes` : `${Math.round(point.hoursLeft)} hours`} left at the current rate`;
  const rate = point.blocksPerHour === null ? "" : ` (${Math.round(point.blocksPerHour).toLocaleString("en-US")} blocks an hour)`;
  return `${subject} is reading history: block ${blockText(point.block)} of ${blockText(point.head)}, ${left}${rate}.`;
}

interface ScannersProps {
  jobs: JobFreshness[];
}

export function CheckpointedScanners({ jobs }: ScannersProps) {
  const scanners = jobs.filter((job) => job.checkpoints.length > 0);
  if (scanners.length === 0) {
    return <p className="mt-3 text-[14px] text-ink-soft">No scanner has written a checkpoint yet.</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-raised">
      {scanners.flatMap((job) =>
        job.checkpoints.map(function renderCheckpoint(point) {
          const share = point.head !== null && point.head > BigInt(0) ? Math.min(100, Number((point.block * BigInt(10_000)) / point.head) / 100) : null;
          return (
            <li key={point.name} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[13px] text-ink">
                  {point.name}
                  <span className="ml-2 text-ink-faint">moved {ago(point.updatedAt)}</span>
                </p>
                <Pill verdict={job.verdict} />
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel">
                <div className={`h-full ${stillReading(point) ? "bg-amber-500" : "bg-hood"}`} style={{ width: `${share ?? 0}%` }} />
              </div>
              <p className="mt-2 text-[13px] text-ink-soft">{fillingSentence(job, point)}</p>
            </li>
          );
        }),
      )}
    </ul>
  );
}

interface JobTableProps {
  jobs: JobFreshness[];
}

export function JobTable({ jobs }: JobTableProps) {
  return (
    <TableShell label="Freshness Panel" className="mt-3">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
            <th className="px-4 py-3 font-medium">Job</th>
            <th className="px-4 py-3 font-medium">Every</th>
            <th className="px-4 py-3 font-medium">Last good run</th>
            <th className="px-4 py-3 font-medium">Age</th>
            <th className="px-4 py-3 text-right font-medium">Rows</th>
            <th className="px-4 py-3 font-medium">Verdict</th>
            <th className="px-4 py-3 font-medium">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {jobs.map(function renderJob(job) {
            return (
              <tr key={job.job}>
                <td className="px-4 py-3 font-mono text-[13px] text-ink">
                  {job.job}
                  {Object.entries(job.metricCoverage ?? {}).map(([name, metric]) => (
                    <span key={name} className="mt-1 block font-sans text-[12px] text-ink-soft" title={`Coverage measured ${metric.measuredAt}; oldest input ${metric.oldestInputAgeSeconds === null ? "unread" : `${Math.round(metric.oldestInputAgeSeconds)} seconds old`}`}>
                      {name}: {metric.current.toLocaleString("en-US")} / {metric.eligible.toLocaleString("en-US")} current · {metric.failed.toLocaleString("en-US")} failed · {metric.unread.toLocaleString("en-US")} unread
                    </span>
                  ))}
                  {job.metadataBacklog ? (
                    <span className="mt-1 block text-[11px] text-ink-faint" title={`Measured ${job.metadataBacklog.measuredAt}`}>
                      {job.metadataBacklog.due.toLocaleString("en-US")} due · {job.metadataBacklog.visibleDue.toLocaleString("en-US")} visible · {job.metadataBacklog.neverRead.toLocaleString("en-US")} never read · {job.metadataBacklog.errors.toLocaleString("en-US")} errors
                    </span>
                  ) : null}
                  {job.running ? <span className="ml-2 text-[11px] text-ink-faint">run in progress since {ago(job.lastRunAt)}</span> : null}
                </td>
                <td className="px-4 py-3 font-mono text-[12.5px] text-ink-soft">{cadenceText(job.cadenceMs)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-soft">{job.lastOkAt ? job.lastOkAt.toISOString().replace("T", " ").slice(0, 19) : "none"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink">{job.lastOkAt ? <LiveAge at={job.lastOkAt.toISOString()} initialLabel={ageText(job.ageMs)} /> : "never"}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] text-ink">{job.rows === null ? "—" : job.rows.toLocaleString("en-US")}</td>
                <td className="px-4 py-3">
                  <Pill verdict={job.verdict} />
                </td>
                <td className="max-w-[320px] truncate px-4 py-3 font-mono text-[11.5px] text-red-700" title={job.error ?? undefined}>
                  {job.error ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableShell>
  );
}

interface FigureTableProps {
  figures: FigureFreshness[];
}

export function FigureTable({ figures }: FigureTableProps) {
  return (
    <TableShell label="Freshness Panel" className="mt-3">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
            <th className="px-4 py-3 font-medium">Figure</th>
            <th className="px-4 py-3 font-medium">Written by</th>
            <th className="px-4 py-3 font-medium">Newest</th>
            <th className="px-4 py-3 text-right font-medium">Rows</th>
            <th className="px-4 py-3 font-medium">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {figures.map(function renderFigure(figure) {
            return (
              <tr key={figure.figure}>
                <td className="px-4 py-3">
                  <p className="font-mono text-[13px] text-ink">{figure.figure}</p>
                  <p className="mt-0.5 max-w-[420px] text-[12.5px] text-ink-soft">{figure.what}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[12.5px] text-ink-soft">
                  {figure.job} · {cadenceText(figure.cadenceMs)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink">{figure.newestAt ? <LiveAge at={figure.newestAt.toISOString()} initialLabel={ageText(figure.ageMs)} /> : "not read yet"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[12.5px] text-ink">
                  {figure.count.toLocaleString("en-US")} <span className="text-ink-faint">{figure.unit}</span>
                </td>
                <td className="px-4 py-3">
                  <Pill verdict={figure.verdict} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableShell>
  );
}

export function VerdictLegend() {
  const entries = Object.entries(VERDICT_MEANING) as Array<[FigureVerdict | OverallVerdict, string]>;
  return (
    <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-2">
      {entries.map(function renderEntry([verdict, meaning]) {
        return (
          <div key={verdict} className="flex gap-3">
            <dt className="w-20 shrink-0 font-mono text-ink">{verdict}</dt>
            <dd className="text-ink-soft">{meaning}</dd>
          </div>
        );
      })}
    </dl>
  );
}

interface StatusLinkProps {
  verdict: OverallVerdict;
  summary: string;
}

// The header's live dot: the overall verdict, linking to the page that shows why.
export function StatusLink({ verdict, summary }: StatusLinkProps) {
  return (
    <Link href="/registry/status" title={summary} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-soft transition-colors hover:text-ink">
      <span className={`inline-block h-2 w-2 rounded-full ${DOT[verdict]}`} aria-hidden />
      <span className="hidden md:inline">{verdict}</span>
    </Link>
  );
}
