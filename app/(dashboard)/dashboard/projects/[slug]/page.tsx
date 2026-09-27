import Link from "@/components/ui/navigation-link";
import { Reveal } from "@/components/ui/reveal";
import { DeleteProject } from "@/components/dashboard/delete-project";
import { ListingEditor } from "@/components/apps/listing-editor";
import { ownerListing } from "@/lib/apps/directory";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowRight, ChevronRight, FileCode2, MessagesSquare } from "@/components/ui/icons";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds, contracts, projects } from "@/lib/db/schema";
import { summariseBuild } from "@/lib/build/history";
import { getAsset } from "@/lib/registry/assets";
import { robinhood, robinhoodTestnet } from "@/lib/chains";
import { RH_MAINNET_ID } from "@/lib/config";
import { FoundryReport } from "@/components/chat/foundry-report";
import { ContractPanel } from "@/components/dashboard/contract-panel";
import { SecurityPanel } from "@/components/dashboard/security-panel";
import { ContractConsole } from "@/components/dashboard/contract-console";
import { MainnetDeploy } from "@/components/dashboard/mainnet-deploy";
import { mainnetDeploysEnabled, takesOwner } from "@/lib/build/deploy";
import { checkSite, describeHealth } from "@/lib/hosting/health";
import type { Abi } from "viem";

const STATUS_TONE: Record<string, string> = {
  succeeded: "bg-hood-wash text-hood-deep ring-hood/30",
  failed: "bg-red-50 text-red-700 ring-red-200",
  building: "bg-amber-50 text-amber-700 ring-amber-200",
  queued: "bg-panel text-ink-faint ring-line",
};

function statusTone(status: string): string {
  return STATUS_TONE[status] ?? STATUS_TONE.queued;
}

export default async function ProjectPage({ params }: PageProps<"/dashboard/projects/[slug]">) {
  const session = await getSession();
  if (!session) {
    notFound();
  }
  const { slug } = await params;

  // Scoped to the owner: a valid slug from another account must 404, not leak.
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.userId, session.user.id)))
    .limit(1);
  const project = projectRows[0];
  if (!project) {
    notFound();
  }

  const buildRows = await db
    .select()
    .from(builds)
    .where(eq(builds.projectId, project.id))
    .orderBy(desc(builds.createdAt));

  // The most recent successful build is what the project currently *is*.
  const latest = buildRows.find(function isDone(build) {
    return build.status === "succeeded";
  });
  // The log summary, the contract row and the site check share no data, so
  // they run together instead of one after another.
  const [summary, deployedRows, site, directory] = await Promise.all([
    latest ? summariseBuild(latest.id) : Promise.resolve(null),
    latest ? db.select().from(contracts).where(eq(contracts.buildId, latest.id)).orderBy(desc(contracts.createdAt)) : Promise.resolve([]),
    project.previewUrl ? checkSite(project.previewUrl) : Promise.resolve(null),
    ownerListing(session.user.id, project.id),
  ]);
  // A build can be on both chains: the platform's testnet deploy, and later
  // the person's own mainnet deploy. The page leads with mainnet when it exists.
  const mainnet = deployedRows.find((row) => row.chainId === RH_MAINNET_ID) ?? null;
  const testnet = deployedRows.find((row) => row.chainId !== RH_MAINNET_ID) ?? null;
  const deployed = mainnet ?? testnet ?? undefined;
  const mainnetOpen = mainnetDeploysEnabled();
  // The contract that went on chain, when the deploy recorded its name;
  // otherwise the first one the compiler produced.
  const compiled =
    summary?.compile?.contracts.find(function deployedOne(contract) {
      return deployed?.abi != null && JSON.stringify(contract.abi) === JSON.stringify(deployed.abi);
    }) ??
    summary?.compile?.contracts[0] ??
    null;
  // Deploys are testnet today; the explorer follows whichever chain the row says.
  const explorerChain = deployed?.chainId === RH_MAINNET_ID ? robinhood : robinhoodTestnet;
  const explorerBase = explorerChain.blockExplorers?.default.url ?? "";

  // A deploy alone doesn't make an address watchable — only registry-listed
  // assets can be watched, and deployed contracts don't join the registry yet.
  const watchableAsset = deployed
    ? await getAsset(`${deployed.chainId}:${deployed.address.toLowerCase()}`)
    : null;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <li>
            <Link href="/dashboard" className="text-ink-faint transition-colors hover:text-ink">
              Dashboard
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3 w-3 text-ink-faint" strokeWidth={2} />
          </li>
          <li>
            <Link
              href="/dashboard/projects"
              className="text-ink-faint transition-colors hover:text-ink"
            >
              Projects
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3 w-3 text-ink-faint" strokeWidth={2} />
          </li>
          <li aria-current="page" className="min-w-0 max-w-[40ch] truncate font-medium text-ink">
            {project.name}
          </li>
        </ol>
      </nav>

      <div className="mb-8 mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display truncate text-[26px] text-ink">{project.name}</h1>
          <p className="mt-1 font-mono text-[12.5px] text-ink-faint">{project.slug}</p>
        </div>
        <div className="flex items-center gap-4">
          <DeleteProject projectId={project.id} name={project.name} afterHref="/dashboard/projects" />
          <Link
            href={`/dashboard/build?project=${project.id}`}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-paper transition-opacity hover:opacity-90"
          >
            <MessagesSquare className="h-4 w-4" strokeWidth={1.8} />
            Edit with AI
          </Link>
        </div>
      </div>

      {project.previewUrl ? (
        <Reveal
          className={`mb-5 flex flex-wrap items-center gap-3 rounded-card border px-5 py-4 ${
            site?.ok ? "border-hood/40 bg-hood-wash" : "border-amber-200 bg-amber-50"
          }`}
        >
          <span className={`text-[13.5px] font-medium ${site?.ok ? "text-hood-deep" : "text-amber-700"}`}>
            {site?.ok ? "Live" : "Hosted, not answering"}
          </span>
          <a href={project.previewUrl} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-ink underline underline-offset-4">
            {project.previewUrl}
          </a>
          <span className="font-mono text-[11.5px] text-ink-faint">{describeHealth(site ?? undefined)}</span>
          <span className="ml-auto text-[12.5px] text-ink-soft">Publish changes in the builder to update the live app.</span>
        </Reveal>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-raised px-5 py-3">
        <p className="text-[13.5px] leading-6 text-ink-soft">
          This page is the record: the contract, its tests and checks, and the live address. Changes happen in the studio, where the
          next prompt edits this app.
        </p>
        <Link
          href={`/dashboard/build?project=${project.id}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 text-[12.5px] font-medium text-ink transition-colors hover:border-line-strong"
        >
          Open in the studio
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>

      {directory ? <ListingEditor initial={directory} /> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        <div className="min-w-0 space-y-5">
          {compiled ? (
            <ContractPanel
              name={compiled.name}
              abi={compiled.abi as Parameters<typeof ContractPanel>[0]["abi"]}
              deployedAddress={deployed?.address ?? null}
              explorerUrl={deployed ? `${explorerBase}/address/${deployed.address}` : null}
              verified={deployed ? Boolean(deployed.verified) : null}
              verifyError={deployed?.verifyError ?? null}
            />
          ) : (
            <section className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-10 text-center">
              <p className="text-[14px] text-ink">No compiled contract yet.</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-6 text-ink-soft">
                Run a build for this project and its contract, ABI and test results appear here.
              </p>
            </section>
          )}

          {compiled ? <SecurityPanel analysis={summary?.analysis ?? null} ownerAddress={deployed?.ownerAddress ?? null} /> : null}

          {deployed ? (
            <section className="rounded-card border border-line bg-raised px-5 py-5">
              <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <span className="mono-label">call the contract</span>
                <span className="text-[12px] text-ink-soft">
                  Reads use the public RPC. Writes go through the wallet you connected in the header, on Robinhood{" "}
                  {deployed.chainId === RH_MAINNET_ID ? "Chain mainnet" : "testnet"}.
                </span>
              </header>
              {deployed.ownerAddress ? (
                <p className="mb-3 text-[12.5px] text-ink-soft">
                  Owner: <span className="font-mono text-ink">{deployed.ownerAddress}</span> (your wallet, set in the constructor). Fletch&apos;s key only paid the gas and holds no role.
                </p>
              ) : (
                <p className="mb-3 text-[12.5px] text-amber-700">This contract was deployed before owner wallets were passed to constructors; a new build will make your wallet the owner.</p>
              )}
              <ContractConsole
                address={deployed.address as `0x${string}`}
                chainId={deployed.chainId}
                abi={(deployed.abi ?? compiled?.abi ?? []) as Abi}
                explorerUrl={`${explorerBase}/address/${deployed.address}`}
              />
            </section>
          ) : null}

          {testnet && !mainnet && latest ? (
            <section className="rounded-card border border-line bg-raised px-5 py-5">
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="mono-label">take it to mainnet</span>
                <span className="text-[12px] text-ink-soft">Same bytecode, your wallet signs, your wallet pays the gas. Fletch records, verifies and rebuilds the page.</span>
              </header>
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-800">
                Before mainnet, run the audit: open the console and press{" "}
                <Link href={`/dashboard/build?project=${project.id}`} className="font-medium underline underline-offset-4">
                  Audit for mainnet
                </Link>
                . It sends nine checks into this app&apos;s session, fixes and tests each finding, and the toolchain compiles, tests and scans the result again.
              </p>
              {mainnetOpen && testnet.bytecode ? (
                <MainnetDeploy buildId={latest.id} abi={(testnet.abi ?? []) as Abi} bytecode={testnet.bytecode as `0x${string}`} contractName={compiled?.name ?? "Contract"} takesOwner={takesOwner((testnet.abi ?? []) as Abi)} />
              ) : (
                <p className="text-[13px] leading-6 text-ink-soft">
                  {mainnetOpen
                    ? "This build predates bytecode storage; run a new build and its testnet deploy will carry the bytecode a mainnet deploy needs."
                    : "Mainnet deploys are not open on this server yet. When they are, this is where the same contract goes to Robinhood Chain mainnet from your own wallet; no server key ever signs on mainnet."}
                </p>
              )}
            </section>
          ) : null}

          {deployed ? (
            watchableAsset ? (
              <Link
                href={`/dashboard/watch/new?asset=${watchableAsset.id}`}
                className="inline-block text-[12.5px] font-medium text-hood-deep underline underline-offset-4 transition-colors hover:text-ink"
              >
                Watch this contract
              </Link>
            ) : (
              <p className="text-[12.5px] leading-5 text-ink-soft">
                Watchers target registry-listed Stock Tokens; a contract you deployed is not one.
              </p>
            )
          ) : null}

          <section className="overflow-hidden rounded-card border border-line bg-raised">
            <header className="border-b border-line px-4 py-3">
              <span className="mono-label">builds · {buildRows.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {buildRows.map(function renderBuild(build) {
                return (
                  <li key={build.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ring-1 ring-inset ${statusTone(build.status)}`}
                    >
                      {build.status}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">{build.prompt}</p>
                    <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-faint">
                      {build.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {summary && summary.artifacts.length > 0 ? (
            <section className="overflow-hidden rounded-card border border-line bg-raised">
              <header className="border-b border-line px-4 py-3">
                <span className="mono-label">files · {summary.artifacts.length}</span>
              </header>
              <ul className="divide-y divide-line">
                {summary.artifacts.map(function renderArtifact(artifact) {
                  return (
                    <li key={artifact.path} className="flex items-center gap-2.5 px-4 py-2.5">
                      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.8} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft">
                        {artifact.path}
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-faint">
                        {artifact.lines}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="min-w-0">
          {summary?.compile ? (
            <FoundryReport compile={summary.compile} tests={summary.tests} running={false} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
