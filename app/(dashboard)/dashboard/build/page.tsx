import { eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { getBalance } from "@/lib/credits";
import { LiveCreditBalance } from "@/components/holder-rewards/client";
import { db } from "@/lib/db";
import { builds, contracts, projects, walletAddress } from "@/lib/db/schema";
import { and, desc } from "drizzle-orm";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { BuildResult } from "@/components/chat/artifact-panel";
import { latestOutcome, listProjectsWithCounts, loadProjectThread, summariseBuild } from "@/lib/build/history";
import { listWorkspaceArtifacts } from "@/lib/build/workspace-files";
import { workspaceRoot } from "@/lib/build/workspace";
import { join } from "node:path";
import { artifactChanges } from "@/lib/chat/artifact-changes";
import { BuildWorkspace } from "@/components/chat/build-workspace";
import { WalletButton } from "@/components/wallet-button";
import Link from "@/components/ui/navigation-link";


// Where the app is right now: its hosted address and its latest testnet
// contract. Shown in the files panel from the first paint, so a reopened project
// has its "Open live app" button without waiting for a new build.
async function currentResult(projectId: string): Promise<BuildResult | null> {
  const [projectRows, contractRows] = await Promise.all([
    db.select({ previewUrl: projects.previewUrl }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db
      .select({ address: contracts.address, chainId: contracts.chainId, verified: contracts.verified })
      .from(contracts)
      .innerJoin(builds, eq(contracts.buildId, builds.id))
      .where(and(eq(builds.projectId, projectId)))
      .orderBy(desc(contracts.createdAt))
      .limit(1),
  ]);
  const previewUrl = projectRows[0]?.previewUrl ?? undefined;
  const contract = contractRows[0];
  const outcome = await latestOutcome(projectId);
  if (!previewUrl && !contract && outcome.notes.length === 0) {
    return null;
  }
  return {
    previewUrl,
    contractAddress: contract?.address,
    explorerUrl: contract ? explorerAddressUrl(contract.chainId, contract.address) : undefined,
    verified: contract?.verified ?? undefined,
    notes: outcome.notes,
  };
}

// Full-height, non-scrolling shell: the page itself never grows, the transcript
// scrolls inside it. Every ancestor of that scroll area needs min-h-0, or flex
// children refuse to shrink and the page stretches instead. dvh (not vh) keeps
// mobile correct when the browser chrome hides.
export default async function BuildPage({ searchParams }: PageProps<"/dashboard/build">): Promise<React.ReactNode> {
  const session = await getSession();
  const balance = session ? await getBalance(session.user.id) : null;
  const params = await searchParams;
  const handoff = typeof params.p === "string" ? params.p : undefined;
  // ?project=<id> continues an existing app: prompts become edits, not new builds.
  const projectId = typeof params.project === "string" ? params.project : undefined;
  const initialView = params.view === "developer" ? "developer" : undefined;

  // Every project is a saved conversation. The list feeds the picker, and the
  // selected one is rebuilt server-side so a refresh shows the same thread.
  const [wallets, projects, thread] = session
    ? await Promise.all([
        db
          .select({ address: walletAddress.address })
          .from(walletAddress)
          .where(eq(walletAddress.userId, session.user.id))
          .limit(1),
        listProjectsWithCounts(session.user.id),
        projectId ? loadProjectThread(projectId, session.user.id) : Promise.resolve([]),
      ])
    : [[], [], []];
  const wallet = wallets[0]?.address;
  // A reopened project shows the files it already has, from its workspace on
  // disk, rather than an empty panel until the next build writes something.
  const current = projects.find(function match(project) {
    return project.id === projectId;
  });
  const [initialArtifacts, initialResult] = current
    ? await Promise.all([listWorkspaceArtifacts(join(workspaceRoot(), current.slug)), currentResult(current.id)])
    : [[], null];

  const recentBuilds = current ? await db.select({ id: builds.id, needsContract: builds.needsContract })
    .from(builds).where(and(eq(builds.projectId, current.id), eq(builds.userId, session!.user.id)))
    .orderBy(desc(builds.createdAt)).limit(2) : [];
  const latestBuild = recentBuilds[0];
  const [summary, previousSummary] = await Promise.all(recentBuilds.map((build) => summariseBuild(build.id)));
  const initialArtifactChanges = artifactChanges(previousSummary?.artifacts ?? [], summary?.artifacts ?? [], initialArtifacts);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:pb-3 sm:pt-5 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
          <h1 className="display text-[22px] text-ink">
            <Link href="/dashboard/build" className="hover:text-hood-deep">
              Build
            </Link>
          </h1>
        </nav>
        {session && wallet ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-line bg-raised px-3 py-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hood" />
            <span className="max-w-[9rem] truncate text-[12.5px] font-medium text-ink" title={session.user.name ?? "account"}>{session.user.name ?? "account"}</span>
            <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </span>
          </span>
        ) : null}
        <span className="mono-label ml-auto tabular-nums">
          <LiveCreditBalance initial={balance} />
        </span>
        <span className="hidden sm:flex">
          <WalletButton tone="light" />
        </span>
      </div>
      <div className="min-h-0 flex-1 border-t border-line">
        <BuildWorkspace
          initialPrompt={handoff}
          projectId={projectId}
          initialMessages={thread.length > 0 ? thread : undefined}
          initialArtifacts={initialArtifacts}
          initialArtifactChanges={initialArtifactChanges}
          initialResult={initialResult}
          initialTemplateVersion={summary?.templateVersion ?? null}
          initialCompile={summary?.compile ?? null}
          initialTests={summary?.tests ?? null}
          initialAnalysis={summary?.analysis ?? null}
          initialNoContract={latestBuild?.needsContract === false}
          initialView={initialView}
          projects={projects.map(function toOption(project) {
            return { id: project.id, name: project.name, slug: project.slug, buildCount: project.buildCount, previewUrl: project.previewUrl };
          })}
        />
      </div>
    </div>
  );
}
