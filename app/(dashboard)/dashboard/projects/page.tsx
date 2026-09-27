import Link from "@/components/ui/navigation-link";
import { Reveal } from "@/components/ui/reveal";
import { DeleteProject } from "@/components/dashboard/delete-project";
import { desc, eq } from "drizzle-orm";
import { FileCode2, Globe, MessagesSquare } from "@/components/ui/icons";
import { latestOutcome } from "@/lib/build/history";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { db } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";
import { robinhoodTestnet } from "@/lib/chains";
import { RH_TESTNET_ID } from "@/lib/config";
import { PageHeader } from "@/components/dashboard/ui";
import { checkSites, describeHealth } from "@/lib/hosting/health";

function testnetExplorer(address: string): string {
  const base = robinhoodTestnet.blockExplorers?.default.url ?? "";
  return `${base}/address/${address}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// Up to two initials from the name, for the cover. No screenshot is faked:
// the cover is a plain field with the monogram and the status.
function monogram(name: string): string {
  const words = name.split(/\s+/).filter(function real(word) {
    return /[a-z0-9]/i.test(word);
  });
  const letters = words.slice(0, 2).map(function first(word) {
    return word.replace(/[^a-z0-9]/gi, "").charAt(0).toUpperCase();
  });
  return letters.join("") || "•";
}

type Tone = "live" | "warn" | "draft";

function statusFor(previewUrl: string | null, answering: boolean, hasContract: boolean): { label: string; tone: Tone } {
  if (previewUrl && answering) {
    return { label: "Live", tone: "live" };
  }
  if (previewUrl) {
    return { label: "Not answering", tone: "warn" };
  }
  if (hasContract) {
    return { label: "Deployed, not published", tone: "warn" };
  }
  return { label: "Draft", tone: "draft" };
}

const COVER: Record<Tone, string> = {
  live: "bg-hood-wash",
  warn: "bg-amber-50",
  draft: "bg-panel",
};

const PILL: Record<Tone, string> = {
  live: "bg-hood text-black ring-hood",
  warn: "bg-amber-100 text-amber-800 ring-amber-200",
  draft: "bg-raised text-ink-soft ring-line",
};

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Projects are tied to a wallet"
        body="Each app you build is stored against the wallet that built it. Connect one to see yours, or start a build and connect when you send."
      />
    );
  }
  const userId = session.user.id;

  const [rows, contractRows] = await Promise.all([
    db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt)),
    db
      .select({ projectId: builds.projectId, chainId: contracts.chainId, address: contracts.address })
      .from(contracts)
      .innerJoin(builds, eq(contracts.buildId, builds.id))
      .where(eq(builds.userId, userId)),
  ]);

  const health = await checkSites(
    rows.flatMap(function hosted(project) {
      return project.previewUrl ? [project.previewUrl] : [];
    }),
  );

  const summaries = new Map<string, string | null>();
  await Promise.all(
    rows.map(async function describe(project) {
      const outcome = await latestOutcome(project.id);
      summaries.set(project.id, outcome.summary);
    }),
  );

  const testnetByProject = new Map<string, string>();
  for (const row of contractRows) {
    if (row.projectId && row.chainId === RH_TESTNET_ID) {
      testnetByProject.set(row.projectId, row.address);
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Projects"
        description="Your apps, saved previews and published sites. Open a project to manage its directory listing, or return to the builder to make changes."
        actions={
          <Link
            href="/dashboard/build"
            className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            New build
          </Link>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <p className="text-[15px] text-ink">Nothing shipped yet.</p>
          <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
            Describe an app and Fletch writes the contract and front end, then compiles
            and tests the contract before handing it back.
          </p>
          <Link
            href="/dashboard/build"
            className="mt-6 inline-block rounded-full bg-hood px-5 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-hood-strong"
          >
            Start a build
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(function renderProject(project) {
            const testnet = testnetByProject.get(project.id);
            const site = project.previewUrl ? health.get(project.previewUrl) : undefined;
            const status = statusFor(project.previewUrl, site?.ok ?? false, Boolean(testnet));
            const summary = summaries.get(project.id) ?? null;
            return (
              <article key={project.id} className="flex flex-col overflow-hidden rounded-card border border-line bg-raised">
                <Link href={`/dashboard/projects/${project.slug}`} className="group relative block" aria-label={`${project.name}: project page`}>
                  <div className={`flex h-32 items-end justify-between px-5 pb-4 pt-5 ${COVER[status.tone]}`}>
                    <span className="display text-[40px] leading-none text-ink/80 transition-transform group-hover:-translate-y-0.5">{monogram(project.name)}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider ring-1 ring-inset ${PILL[status.tone]}`}>
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                      {status.label}
                    </span>
                  </div>
                </Link>
                <div className="flex flex-1 flex-col gap-2 px-5 pb-4 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-medium">
                      <Link href={`/dashboard/projects/${project.slug}`} className="text-ink transition-colors hover:text-hood-deep">
                        {project.name}
                      </Link>
                    </h2>
                    <span className="mono-label !text-[10px] tabular-nums">{project.createdAt.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="line-clamp-2 text-[13px] leading-5 text-ink-soft">{summary ?? "No finished build yet."}</p>
                  {project.previewUrl ? (
                    <span className="flex flex-wrap items-center gap-x-2 font-mono text-[12px]">
                      <a href={project.previewUrl} target="_blank" rel="noreferrer" className="text-hood-deep underline decoration-hood/50 underline-offset-4 hover:decoration-hood">
                        {project.previewUrl.replace(/^https?:\/\//, "")}
                      </a>
                      <span className="text-ink-faint">{describeHealth(site)}</span>
                    </span>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    <Link href={`/dashboard/projects/${project.slug}#directory-listing`} className="inline-flex min-h-11 items-center text-[12.5px] font-medium text-hood-deep underline underline-offset-4">Manage listing</Link>
                    <Link
                      href={`/dashboard/build?project=${project.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-paper transition-opacity hover:opacity-90"
                    >
                      <MessagesSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Edit with AI
                    </Link>
                    {project.previewUrl ? (
                      <Reveal>
                        <a
                          href={project.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-medium transition-colors ${
                            site?.ok ? "border-hood/60 text-hood-deep hover:bg-hood-wash" : "border-amber-300 bg-amber-50 text-amber-800"
                          }`}
                        >
                          <Globe className="h-3.5 w-3.5" strokeWidth={1.8} />
                          Open live app
                        </a>
                      </Reveal>
                    ) : null}
                    {testnet ? (
                      <a
                        href={testnetExplorer(testnet)}
                        target="_blank"
                        rel="noreferrer"
                        title={`Contract ${shortAddress(testnet)} on the testnet explorer`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-ink-soft transition-colors hover:text-ink"
                      >
                        <FileCode2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Contract
                      </a>
                    ) : null}
                    <span className="ml-auto">
                      <DeleteProject projectId={project.id} name={project.name} compact />
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
