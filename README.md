<p align="center"><img src="public/brand/final-logo.png" width="88" alt="Fletch"></p>

# Fletch Builder

**An open-source AI app builder you can run, modify and extend. MIT licensed.**

A prompt becomes a project with source files, a live build console and a preview. For applications that need on-chain state, the builder writes Solidity, runs Foundry compilation/tests and Slither analysis in an isolated Docker environment, then records real deployment and verification results. Ordinary web apps can use the frontend-only path. Publishing is an explicit owner action.

This repository contains the full application and its supporting technology: dashboard, agent prompts and execution loop, model connections, build queue and workers, project persistence, previews, static publishing, registry and market indexers, API, MCP server, local model gateway, database schema and server tooling. It contains no hosted-service credentials, customer database or private deployment history.

## What you can build with it

Use Fletch as a self-hosted builder, adapt it into your own application, or reuse its execution components. Blockchain is optional for generated frontend apps. The aim is useful software that people can inspect, run and improve for their own needs.

| Use case | Example | What to connect or extend |
|---|---|---|
| Everyday user apps | Habit tracker, planner, calculator, study aid, personal inventory | Frontend-only path; browser storage or an existing API |
| Internal tools | Operations dashboard, forms, inventory explorer, CSV cleanup | Existing authenticated API; add server-side authorization for shared data |
| SaaS and customer applications | Customer portal, support workspace, booking interface, team knowledge base | Frontend generation today; provision tenant-aware auth, database and backend services separately |
| Web-data workflows | Collect permitted page data, normalize records, detect changes, export CSV/JSON | Add an isolated fetch/browser worker, scheduling, storage and delivery adapters |
| Monitoring and research | Public catalog tracker, document-change alerts, open-data explorer | Data-source connectors, provenance, freshness and notification jobs |
| Developer tools | API explorer, release dashboard, schema viewer, documentation workspace | Your API or MCP tools with explicit access scopes |
| Community and public-interest tools | Resource directory, volunteer portal, accessible information dashboard | Start with public/synthetic data; add consent-based shared services as needed |
| On-chain apps | Testnet contract interface, treasury view, community tools | Included EVM path; new runtimes need the documented adapters |
| Specialized builders | A focused builder for a team's framework, domain or workflow | Replace templates, prompts and adapters while retaining sandboxing and build evidence |

These are application patterns, not a claim that every backend ships prebuilt. Static frontend generation and hosting are included; persistent generated servers, scheduled scrapers and non-EVM deployment require extensions. See [use cases and example briefs](docs/use-cases.md), [data workflows](docs/extensions/data-workflows.md), and [guidance for coding agents](docs/agent-guide.md).

## What works, and what needs an adapter

| Target | Current implementation |
|---|---|
| React web apps | Vite + React + TypeScript; no contract or generated-app wallet needed for a frontend-only project |
| Robinhood Chain | Built-in EVM network definitions, Solidity toolchain, testnet deployment and explorer verification |
| Other EVM chains | Source extension: update network definitions, wallet config, policy, chain facts, deployment and verification |
| Solana | Not implemented. Requires a Rust/Anchor toolchain, Solana wallet/auth/address handling, program deployment and evidence adapter |
| Starknet | Not implemented. Requires Cairo/Scarb/Starknet Foundry, native account/wallet handling and declaration/deployment evidence |
| Generated backend services | Not implemented by the static publisher. Requires a separate isolated runtime and server deployment adapter |

The current platform login uses Ethereum wallet signatures. A generated frontend with no wallet still lives inside that platform. Solana and Starknet support are substantial engineering extensions, not a chain-ID setting. Start with the [extension guide](docs/extensions/README.md).

## Start locally

Use **Node 22**, npm, Docker and PostgreSQL 16. OpenSSL is needed by MCP HTTPS tests. Docker is required for real builds; it is not required just to read or typecheck the source.

```bash
npm ci
npm run setup:local
FLETCH_POSTGRES_PORT=5455 docker compose up -d postgres
npm run db:bootstrap
npm run dev -- -p 3400
```

Open `http://localhost:3400`. For the local test account, visit `/api/dev/login` while `FORGE_DEV_LOGIN=1`. The generated `.env.local` is private and ignored by Git. The setup command preserves an existing file and never prints its secrets. Bootstrap only accepts an empty local database; use the server migration procedure for an existing installation.

**A development instance without a model connection uses a demo stub. Its output is not an actual compile, test or deployment.** To build real apps:

```bash
docker build -f docker/agent.Dockerfile -t fletch-agent:latest .
```

Configure a platform Kimi key in `.env.local`, a hosted own-key connection in Settings, or a [local model gateway](docs/mcp-and-gateway.md). The example config selects the CLI and Docker sandbox. Fund a separate testnet deployer only if you want automatic testnet contract deployment. Restart the app after configuration changes.

Follow [local development](docs/local-development.md) for worker mode, database tests, previews and common setup failures. Never enable the dev-login shortcut on a public server.

## Run your own service

The web server, build worker and optional indexers are separate processes. The production reference deployment uses Linux, systemd, Docker, PostgreSQL and nginx. The web container alone is not the full builder: workers, toolchain image, persistent storage, model transport and publishing infrastructure must also be provisioned.

1. Follow [server operations](docs/operations/servers.md) to configure accounts, secrets, database, storage and worker services.
2. Follow [publishing](docs/operations/publishing.md) to configure your own app domain, DNS, TLS and static hosting.
3. Follow [security](SECURITY.md) for the model-code boundary, credentials, previews and incident reporting.
4. Use [configuration](docs/configuration.md) and the [environment index](docs/environment-reference.md) to locate settings.

Hosted model keys are encrypted at rest; the service operator can decrypt them for use. The optional local gateway keeps provider keys on the user's machine, while the Fletch server still sees prompts and outputs. Model usage, RPC, servers and gas are supplied and paid for by the operator/user.

## Extend the builder

| Goal | Guide |
|---|---|
| Understand the execution pipeline | [Architecture](docs/architecture.md) |
| Add another EVM network | [EVM chains](docs/extensions/evm.md) |
| Implement Solana program building | [Solana](docs/extensions/solana.md) |
| Implement Starknet contract building | [Starknet](docs/extensions/starknet.md) |
| Change templates or build ordinary web apps | [Web apps and templates](docs/extensions/web.md) |
| Add data extraction, scheduled jobs and exports | [Data workflows](docs/extensions/data-workflows.md) |
| Adapt the repository with a coding agent | [Agent implementation guide](docs/agent-guide.md) |
| Add a model provider or tool | [Providers and tools](docs/extensions/providers-and-tools.md) |
| Use or extend MCP; run the key gateway | [MCP and gateway](docs/mcp-and-gateway.md) |
| Add a publisher, move to another host | [Publishing](docs/operations/publishing.md) |

## Repository map

| Path | Purpose |
|---|---|
| `app/`, `components/` | Next.js routes, API handlers, dashboard and public UI |
| `lib/agent/` | Model connections, prompts, needs analysis, tool loop and credential proxy |
| `lib/build/` | Build orchestration, compiler/test reports, deployment, budgets, ownership and checkpoints |
| `lib/hosting/` | Draft previews, publishing queue, immutable site releases and rollback |
| `docker/` | Agent image, CLI transport and generated-app foundation |
| `workers/` | Independent builds, registry/indexing, watch and maintenance processes |
| `lib/registry/`, `lib/chain/`, `lib/watch/` | Chain reads, registry/market jobs and alerts |
| `lib/db/`, `drizzle/` | Current schema and historical SQL migrations/invariants |
| `packages/fletch-mcp/` | Stdio MCP server for the registry API |
| `packages/fletch-gateway/` | User-operated provider-key relay |
| `scripts/` | Local setup, checks, publishing, backups and Linux operations |
| `skills/`, `examples/` | Builder design guidance and integration examples |

## Check your changes

```bash
npm run lint
npm run typecheck
npm test -- --test-concurrency=1
npm ci --prefix packages/fletch-mcp
npm test --prefix packages/fletch-mcp
npm run build
```

Database integration tests require a separate disposable database through `FLETCH_TEST_DATABASE_URL`; tests that need it otherwise skip. MCP tests are offline by default; a live endpoint test requires `FLETCH_LIVE_TEST_URL`. Docker and Linux-specific suites have additional requirements. Read [testing](docs/testing.md) before treating skipped checks as passing deployment evidence.

Before publishing source:

See the [public release notes](PUBLIC_RELEASE.md) for the audit scope, verified checks and remaining environment-dependent validation.

```bash
git config core.hooksPath .githooks
npm run check:public
gitleaks git --redact --no-banner --log-opts='--all' .
```

Contributions are welcome under [MIT](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Compilation, tests and static analysis provide evidence; they do not guarantee a generated contract is safe for real funds.
