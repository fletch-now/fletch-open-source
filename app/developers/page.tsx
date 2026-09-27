import { publicPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { RegistryHeader } from "@/components/registry/registry-header";
import { RegistryNav } from "@/components/registry/registry-nav";
import { SiteFooter } from "@/components/landing/site-footer";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { apiReference, type ReferenceOperation } from "@/lib/api/reference";
import { API_KEY_SCOPES } from "@/lib/auth/scopes";
import { CopyReference } from "@/components/docs/copy-reference";
import { GITHUB_URL } from "@/lib/config";

const MCP_CMD = "claude mcp add fletch -- npx -y github:fletch-now/fletch-mcp";

const OPEN_SOURCE: Array<{ name: string; repo: string; body: string }> = [
  { name: "fletch-mcp", repo: "fletch-mcp", body: "The registry as MCP tools for Claude, Cursor and other MCP clients. Public reads use ETag caching and need no key." },
  { name: "fletch-api", repo: "fletch-api", body: "The current OpenAPI snapshot, event catalog, freshness guidance, webhook signature verifiers and a typed TypeScript SDK, including public app-directory reads." },
  { name: "fletch-registry-data", repo: "fletch-registry-data", body: "Daily git snapshots of every asset, lookalike and registry event from this API, a Uniswap token list, and a script that re-proves each canonical token against the chain." },
];

// The written API reference: rendered from the OpenAPI document with a live
// example beside every public read, refreshed every five minutes.
export const revalidate = 300;

export const metadata: Metadata = publicPageMetadata("/developers");

const QUICKSTART = [
  { label: "Published apps", code: `curl -fsS '${APP_URL}/api/v1/apps'\n# Follow next until null; 24 apps per page.\n# Open an entry with /api/v1/apps/{slug}.\n# Revalidate each read: creators can withdraw their listings.` },
  { label: "curl", code: `curl ${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/assets/TSLA` },
  {
    label: "fetch",
    code: `const res = await fetch("${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/assets/TSLA");\nconst { asset, state } = await res.json();\nconsole.log(asset.address, state.multiplier, state.feed?.price);`,
  },
  { label: "MCP", code: `# Runs straight from GitHub; the npm package follows.\n${MCP_CMD}\n# Cursor and Claude Desktop: command "npx", args ["-y", "github:fletch-now/fletch-mcp"]` },
  {
    label: "poll with ETag",
    code: `curl -i ${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/events?limit=20\n# … ETag: W/"abc"\ncurl -i -H 'If-None-Match: W/"abc"' ${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/events?limit=20\n# HTTP/1.1 304 Not Modified`,
  },
];

const METHOD_TONE: Record<string, string> = {
  GET: "bg-hood-wash text-hood-deep",
  POST: "bg-amber-50 text-amber-800",
  PATCH: "bg-panel text-ink-soft",
  DELETE: "bg-red-50 text-red-700",
};

function anchorFor(operation: ReferenceOperation): string {
  return `${operation.method.toLowerCase()}-${operation.path.replace(/[{}]/g, "").replace(/\//g, "-").replace(/^-/, "")}`;
}

interface OperationCardProps {
  operation: ReferenceOperation;
}

function OperationCard({ operation }: OperationCardProps) {
  return (
    <article id={anchorFor(operation)} className="min-w-0 scroll-mt-24 overflow-hidden rounded-card border border-line bg-raised">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${METHOD_TONE[operation.method] ?? METHOD_TONE.GET}`}>{operation.method}</span>
        <code className="break-all font-mono text-[13.5px] text-ink">{operation.path}</code>
        {operation.isPublic ? (
          <span className="ml-auto text-[11.5px] text-ink-faint">public · 120/min per IP · ETag</span>
        ) : (
          <span className="ml-auto text-[11.5px] text-ink-faint">key · {operation.scopes.join(", ") || "any scope"}</span>
        )}
      </header>
      <div className="px-5 py-4">
        <p className="text-[14px] leading-6 text-ink">{operation.summary}</p>
        {operation.description ? <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">{operation.description}</p> : null}
        {operation.parameters.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                <th className="py-1 pr-3 font-medium">Parameter</th>
                <th className="py-1 pr-3 font-medium">In</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {operation.parameters.map(function renderParameter(parameter) {
                return (
                  <tr key={`${parameter.in}-${parameter.name}`}>
                    <td className="py-1.5 pr-3 font-mono text-ink">
                      {parameter.name}
                      {parameter.required ? <span className="text-red-600">*</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-faint">{parameter.in}</td>
                    <td className="py-1.5 pr-3 font-mono text-ink-soft">{parameter.type}</td>
                    <td className="py-1.5 text-ink-soft">
                      {parameter.description ?? ""}
                      {parameter.example ? <span className="ml-1 font-mono text-ink-faint">e.g. {parameter.example}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        ) : null}
        {operation.requestBody ? (
          <details className="mt-3 rounded-md border border-line bg-panel/60 p-3">
            <summary className="cursor-pointer text-[13px] font-medium text-ink">Request body schema</summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] leading-5 text-ink">{operation.requestBody}</pre>
          </details>
        ) : null}
        <p className="mt-3 text-[12px] text-ink-faint">
          Responses: {operation.responses.map((response) => `${response.status} ${response.description}`).join(" · ")}
        </p>
        {operation.exampleUrl ? (
          <p className="mt-3 text-[12.5px]">
            <a href={operation.exampleUrl} className="break-all font-mono text-hood-deep underline underline-offset-4 hover:text-ink">
              {operation.exampleUrl}
            </a>
          </p>
        ) : null}
        {operation.example ? (
          <pre className="mt-2 max-h-[420px] overflow-auto rounded-md border border-line bg-panel/60 p-3 font-mono text-[11.5px] leading-5 text-ink">{operation.example}</pre>
        ) : null}
      </div>
    </article>
  );
}

export default async function DevelopersPage() {
  const sections = await apiReference();
  const operationCount = sections.reduce((sum, section) => sum + section.operations.length, 0);

  return (
    <div className="relative flex flex-1 flex-col">
      <RegistryHeader />
      <RegistryNav current="developers" />
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <p className="mono-label mb-4">developers · api v1</p>
        <h1 className="display max-w-3xl text-balance text-[clamp(2rem,5vw,3.6rem)] leading-[0.95] text-ink">
          Live Robinhood Chain data, as an API.
        </h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-7 text-ink-soft">
          Explore {operationCount} operations across {sections.length} areas. Public registry reads need no key;
          public app-directory reads also need no key. Account data and account mutations require authentication. Examples below are sampled responses, shortened for readability.
          The same document drives{" "}
          <Link href="/docs" className="underline underline-offset-4 hover:text-ink">
            Documentation
          </Link>
          ,{" "}
          <a href="/api/v1/docs" className="underline underline-offset-4 hover:text-ink">
            Swagger UI
          </a>{" "}
          and is served raw at{" "}
          <a href="/api/v1/openapi.json" className="underline underline-offset-4 hover:text-ink">
            openapi.json
          </a>
          ; agents get the plain-text version at{" "}
          <a href="/llms.txt" className="underline underline-offset-4 hover:text-ink">
            llms.txt
          </a> or the integration guide at{" "}
          <a href="/skill.md" className="underline underline-offset-4 hover:text-ink">
            skill.md
          </a>
          . The MCP server, the spec, the SDK and daily data snapshots are open source on{" "}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
            GitHub
          </a>
          .
        </p>

        <section className="mt-6 max-w-3xl rounded-card border border-line bg-panel/60 p-5" aria-label="Use with an AI assistant">
          <CopyReference />
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2">
          {QUICKSTART.map(function renderSnippet(snippet) {
            return (
              <div key={snippet.label} className="overflow-hidden rounded-card border border-line bg-raised">
                <p className="border-b border-line px-4 py-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">{snippet.label}</p>
                <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-5 text-ink">{snippet.code}</pre>
              </div>
            );
          })}
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-3">
          <div className="rounded-card border border-line bg-raised px-5 py-4">
            <h2 className="text-[15px] font-medium text-ink">Reading</h2>
            <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">
              Registry, changelog, chain and status routes are public: 120 requests a minute per address without a key. Every GET answers with an <span className="font-mono">ETag</span> and a
              <span className="font-mono"> Cache-Control</span> on the writing job&apos;s cadence; send <span className="font-mono">If-None-Match</span> and an unchanged answer is a 304 with no body.
            </p>
          </div>
          <div className="rounded-card border border-line bg-raised px-5 py-4">
            <h2 className="text-[15px] font-medium text-ink">Account access</h2>
            <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">
              Watchers, webhooks, builds and projects need a key: <span className="font-mono">Authorization: Bearer flk_…</span>, created in{" "}
              <Link href="/dashboard/settings" className="underline underline-offset-4 hover:text-ink">
                Settings
              </Link>
              , 600 requests an hour. Scopes: <span className="font-mono">{API_KEY_SCOPES.join(", ")}</span>. A signed-in browser session also authenticates.
              Build creation and payments are dashboard operations; v1 exposes build and project reads.
            </p>
          </div>
          <div className="rounded-card border border-line bg-raised px-5 py-4">
            <h2 className="text-[15px] font-medium text-ink">Shapes and promises</h2>
            <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">
              Raw amounts (<span className="font-mono">*Raw</span>, <span className="font-mono">*Wei</span>) are strings, exact as on chain. Prices and multipliers are numbers. Timestamps are ISO 8601. Every figure carries the time it was read. Fields are added, never renamed. A figure that is partial says so (<span className="font-mono">filling</span>, <span className="font-mono">complete: false</span>) rather than pretending.
            </p>
          </div>
        </section>

        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" aria-label="Sections">
          {sections.map(function renderLink(section) {
            return (
              <a key={section.name} href={`#${section.name.toLowerCase()}`} className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                {section.name} <span className="font-mono text-[11px] text-ink-faint">{section.operations.length}</span>
              </a>
            );
          })}
        </nav>

        <section className="mt-12">
          <h2 className="display text-[26px] leading-none text-ink">Open source</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
            Three repositories under{" "}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
              github.com/fletch-now
            </a>
            , MIT licensed, each tested in CI against this API. Fletch is not affiliated with Robinhood Markets, Inc.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {OPEN_SOURCE.map(function renderRepo(repo) {
              return (
                <a
                  key={repo.repo}
                  href={`${GITHUB_URL}/${repo.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-card border border-line bg-raised px-5 py-4 transition-colors hover:border-line-strong"
                >
                  <p className="font-mono text-[13px] font-semibold text-ink group-hover:text-hood-deep">{repo.name}</p>
                  <p className="mt-1.5 text-[13px] leading-6 text-ink-soft">{repo.body}</p>
                </a>
              );
            })}
          </div>
        </section>

        {sections.map(function renderSection(section) {
          return (
            <section key={section.name} id={section.name.toLowerCase()} className="mt-12 scroll-mt-24">
              <h2 className="display text-[26px] leading-none text-ink">{section.name}</h2>
              <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-ink-soft">{section.description}</p>
              <div className="mt-5 grid min-w-0 grid-cols-1 gap-4">
                {section.operations.map(function renderOperation(operation) {
                  return <OperationCard key={`${operation.method} ${operation.path}`} operation={operation} />;
                })}
              </div>
            </section>
          );
        })}
      </main>
      <SiteFooter />
    </div>
  );
}
