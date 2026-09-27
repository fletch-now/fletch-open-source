# Operate your own Fletch server

## Topology

Run the control plane as a long-lived Node process; builds use SSE, a persistent database and independently running jobs. The reference deployment is Linux with systemd, PostgreSQL 16, Docker, nginx, OpenSSL and Certbot. A static-site host alone cannot run the builder. The root Dockerfile packages the **web application**, not Docker execution or the worker fleet.

| Component | State and responsibilities |
|---|---|
| Web process | Dashboard, auth, HTTP API, previews and build-event streams |
| PostgreSQL | Users, projects, queue, ownership, logs, credential ciphertext and billing ledger |
| Build worker | Claims jobs, creates sandboxes, checkpoints work, deploys and publishes |
| Agent image | CLI, Solidity toolchain, analyzer, generated-app frontend dependencies |
| Model proxy / user gateway | Credential-scoped model requests; keep transport off the public network |
| nginx + app domain | TLS, web proxy, immutable generated static sites |
| Optional workers | Registry/indexing, watch delivery, reaping and backups |

Provision a dedicated unprivileged `fletch` service account. Docker access is powerful host access: isolate workers from unrelated services and do not mount the Docker socket inside model-code containers. The Linux infra scripts under `scripts/infra/` are included, but their sample private subnet, SSH aliases and paths require review on your own hosts.

## 1. Configuration and storage

Create `/etc/fletch/fletch.env` outside the checkout with mode 0600 and owner/root access appropriate to systemd. Generate independent auth and model-encryption secrets. Set the five production-required values (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_DOMAIN`). Set your own app hosting domain and Reown project. Keep `FORGE_DEV_LOGIN=0`, leave `FORGE_ALLOW_LOCAL_PROD` unset and keep mainnet deployment disabled until separately implemented/reviewed.

Create persistent directories owned by the service account:

```bash
sudo install -d -o fletch -g fletch -m 0750 /var/lib/fletch/workspaces /var/lib/fletch/checkpoints
sudo install -d -o fletch -g fletch -m 0755 /var/lib/fletch/sites
```

Set those three paths in `FORGE_WORKSPACE_ROOT`, `FORGE_CHECKPOINT_ROOT` and `FORGE_SITES_ROOT`. Workspaces and checkpoints must be separate, persistent directories. Check free disk space and backup capacity before opening build admission.

## 2. Database

Create a dedicated PostgreSQL database and service role with your own password, restricted network access and appropriate TLS. Use a separate migration role for schema changes. Configure PostgreSQL sessions and service processes for UTC; timestamp comparisons depend on a consistent timezone. For a **new empty** database on the server's loopback interface, run `npm run db:bootstrap` with the migration role's `DATABASE_URL`. It refuses non-loopback endpoints and nonempty databases. For an existing installation, review and apply only the migrations required from its schema baseline, including grants; back up and test restoration first. Do not run `db:push --force` against an existing service.

The fresh bootstrap installs the current schema plus SQL-only invariants in migrations 0046, 0057 and 0058, and SQL-only hosting/directory tables in 0066, 0067 and 0070. The `drizzle/` directory is retained in full so maintainers can inspect historical transitions; it is not a universal ordered provisioning script. Database tests use an independent disposable database.

## 3. Build web and worker releases

Use immutable release directories under `/opt/fletch`. Run `npm ci` and build the agent image from the full checkout. Build the web application with your public environment values supplied at **build time**:

```bash
npm run build
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/
cp -R public .next/standalone/
```

The standalone web entry is `.next/standalone/server.js`. Copying that output alone does not provide the TypeScript worker source/dependencies: the worker release needs the checkout and installed dependencies. Set `FORGE_BUILD_EXECUTION=worker` on both services.

`npm run build` strips environment files and private operations directories from the standalone artifact after Next.js tracing. Supply runtime secrets through the service environment. If invoking `next build` directly, also run `node scripts/clean-standalone.mjs` before packaging its output.

`NEXT_PUBLIC_*` values are embedded in the browser bundle. Rebuild after changing domains or wallet project IDs. Never put provider keys, paid RPC secrets, signing keys or passwords in those variables or Docker build arguments.

## 4. Worker transport and service

Set `FORGE_AGENT=cli`, `FORGE_AGENT_BIN=kimi`, `FORGE_AGENT_SANDBOX=docker` and the installed image name. Set `FORGE_PROXY_BIND` to a private IPv4 address reachable from the Docker containers (for example the host Docker bridge after inspecting it), and `FORGE_PROXY_PORT=3902`. A loopback-only bind generally cannot be reached through the Docker bridge. Permit only the intended container/private network through the host firewall.

Review `scripts/fletch-build-worker.service`. Place the worker release at `/opt/fletch/build-worker`, or update the unit's working directory. The web and worker need the same database, encryption configuration and compatible schema. Start the worker using the supplied command:

```bash
npm run worker:build
```

For a service, install the reviewed unit and use systemd. Never run two legacy in-process queues against the same production database. Worker mode is the intended separate-process topology. If using a remote executor, first review `lib/build/executor.ts`, `scripts/infra/offload.env.example`, the forced-command SSH configuration, workspace sharing, resource snapshots and model relay. Generate new SSH/WireGuard keys; the public source contains no machine identities.

## 5. Web proxy and publication

Render the domain-specific templates described in [publishing](publishing.md). Terminate HTTPS at nginx, keep Node bound to loopback, forward the expected host/proxy headers and disable proxy buffering for the build stream. Preserve preview-specific security headers. Provision TLS and wildcard app DNS before advertising public hosting.

Review the optional `scripts/fletch-registry.service`, `fletch-watch.service`, reaper and backup timers before installation. Run indexers only after choosing RPC providers, budgets and the supported chain data scope.

## 6. Validate before admitting users

Check `/api/health?deep=1`, wallet sign-in, a real frontend-only build, a small testnet contract build, compiler/test/analyzer evidence, stop/cancel, reconnect to the event stream, a follow-up using saved source, preview and explicit publication. Confirm failed publication preserves the previous release. Test a worker restart and restore from backup. Tune capacity using actual resource observations; do not assume the original operator's concurrency figures apply to your machine.

For upgrades, inspect `scripts/rolling/README.md` and the rolling deploy/drain scripts. Set `FLETCH_HOST` explicitly to your reviewed SSH destination; the deploy entrypoints have no default host. Drain workers before retiring their release. Database and workspace changes must remain compatible with in-flight jobs. Keep the previous image, source release and compatible database backup available for rollback. Restoring code alone cannot reverse a schema migration or an already-broadcast transaction. No instructions here authorize or perform changes on an existing hosted Fletch service.
