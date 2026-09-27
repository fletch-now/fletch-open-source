# Testing and verification

Use Node 22 as in CI. The source can also be checked on the allowed newer Node versions, but record the version actually used. Run from the repository root.

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --test-concurrency=1
npm ci --prefix packages/fletch-mcp
npm test --prefix packages/fletch-mcp
npm run build
```

`npm test` discovers TypeScript suites under `lib/` and `components/`. It fixes the child test process timezone to UTC. Tests requiring a database or Docker skip when their prerequisite is not explicitly available; read the summary rather than treating skips as verified behavior.

## Database integration tests

Provision a separate disposable PostgreSQL database, owned by a test role allowed to create schemas. Set the database/session timezone to UTC. Never use a development database containing work you want to keep, or a production database. The local Compose PostgreSQL service is configured for UTC.

```bash
# Use a fresh local test database; choose your own local port and test role.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5455/fletch_test npm run db:bootstrap
FLETCH_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5455/fletch_test npm test -- --test-concurrency=1
```

Create `fletch_test` before bootstrap, for example with `docker compose exec postgres createdb -U postgres fletch_test` on the local service. Bootstrap refuses an existing schema. It installs SQL-only publication tables as well as Drizzle tables and immutable-selection/billing constraints. Several suites create temporary schemas or insert/delete fixture rows; the test role needs the corresponding privileges.

For a focused suite, use `node --import tsx --test path/to/file.test.ts` with the same database environment and `TZ=UTC`. Preserve synthetic fixtures and test isolation when adding cases.

## Infrastructure and real builds

Root unit tests do not prove that Docker, nginx, DNS, certificates, systemd or a chain signer is installed correctly. Review the selected scripts before running them. Python publishing/DNS/installer suites use local fixtures; privileged mount-namespace tests need Linux/root and must run on a disposable host. Browser scripts need a local app and their listed browser dependencies. Remote executor scripts require separately provisioned hosts.

For a release deployment, run a real frontend build and a small testnet contract build with your own provider connection, test cancellation and worker restart, and verify preview/publication/rollback on your domain. Preserve only redacted results outside Git. Do not claim Docker or live-network coverage from mocked tests.

MCP tests generate temporary TLS material with OpenSSL and call local fixture servers by default. Set `FLETCH_LIVE_TEST_URL` only when you intend a live API check. Gateway tests live in the root suites; the gateway package itself has no dependency installation step.

## Source publication checks

Stage your intended public files, run `npm run check:public`, then scan history with `gitleaks git --redact --no-banner --log-opts='--all' .`. The public-file check rejects private artifacts, machine paths/identities and sensitive image metadata. Gitleaks checks credentials with narrow allowlists for known public identifiers. Neither establishes that every possible personal detail has been removed: review new files and context as well.

CI runs the app checks, database suites and MCP tests on Linux, plus a separate source/privacy check. Keep check results and limitations accurate in release notes. [Security](../SECURITY.md) explains reporting and credential incidents.
