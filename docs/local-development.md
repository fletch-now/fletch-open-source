# Local development

## First boot

Use Node 22 (`nvm use` if you use nvm). Run the README setup commands. `setup:local` generates two independent random secrets, creates private workspace/checkpoint/site directories and writes `.env.local` with mode 0600. It refuses to replace an existing configuration. Keep real keys in that ignored file or your secret manager.

Compose exposes PostgreSQL only on loopback. The sample `postgres` password is a disposable local-development value, not a server password. `db:bootstrap` checks that the local database has no public tables, pushes the current Drizzle schema, adds the build-selection/pricing/quote-observation SQL invariants and creates SQL-only publishing/directory tables. Historical migrations include operational assumptions and are not a fresh-install script to execute indiscriminately.

The application uses port 3400 in these guides. Keep `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_DOMAIN` consistent, including the port. Visit `/api/dev/login` to create the development-only account. Production rejects that flag.

## Real generation

Build `docker/agent.Dockerfile` from the repository root. This includes the pinned generated-web-app dependencies, compiler, tests and analyzer. The default CLI is Kimi Code; the credential proxy adapts the selected model connection. In `.env.local` use:

```dotenv
FORGE_AGENT=cli
FORGE_AGENT_BIN=kimi
FORGE_AGENT_SANDBOX=docker
FORGE_AGENT_IMAGE=fletch-agent:latest
FORGE_BUILD_EXECUTION=legacy
```

`legacy` means one local web process owns the queue. It does not mean host execution. Keep `FORGE_UNSAFE_HOST_TOOLS` unset. Add a platform Kimi key or use an own-key/gateway connection in Settings. A plain `OPENAI_API_KEY` environment variable is not a substitute for selecting a user connection in this product.

For contract deployment, add a disposable funded testnet key as `FORGE_DEPLOYER_KEY_46630`. Do not provide a real-money production signer for local development. For frontend-only projects, no deployer is required. Generated static assets can be previewed before public hosting is configured; a public URL requires the publishing setup.

The agent reaches the host credential proxy through `host.docker.internal`. Linux and Docker Desktop networking differ. Inspect `docker context show`; use your local engine. In local legacy mode the proxy defaults to a container-reachable bind. Firewall it to the local/container network. Never expose it on a public interface. Independent workers require an explicit private IPv4 bind and a dedicated port.

## Independent workers

Set `FORGE_BUILD_EXECUTION=worker` in both web and worker environments. Set `FORGE_PROXY_BIND` to the private host address reachable from Docker, `FORGE_PROXY_PORT=3902`, and persistent **absolute** `FORGE_WORKSPACE_ROOT` and `FORGE_CHECKPOINT_ROOT` paths in separate directories. `setup:local` provides the directories. `/tmp` is intentionally rejected for durable workers.

```bash
npm run worker:build
# Optional, each in its own terminal:
npm run worker:registry
npm run worker:watch
```

Workers load `.env.local` and can also load `/etc/fletch/fletch.env`; use an isolated local environment. Registry/watch workers are optional for developing the builder and can consume RPC quota. If a build remains queued, verify that web and worker use the same database, compatible source/schema and worker mode. Inspect worker health and storage admission before increasing concurrency.

## Useful routes

| Route | Use |
|---|---|
| `/dashboard/build` | Create projects and follow up |
| `/dashboard/settings` | Provider connections, gateways, alerts and API access |
| `/api/health` | Liveness; `?deep=1` also checks the database |
| `/api/v1/status` | Registry observations and coverage |
| `/trafalgar/unlock` | Operator password door; generate a hash with `scripts/admin-password.mjs` |
| `/api/v1/openapi.json` | Executable HTTP API reference |
| `/llms.txt`, `/llms-full.txt` | Machine-readable documentation |

## Troubleshooting

- Demo-like output: no selected model connection; the development stub is active.
- Wallet sign-in fails: confirm domain/port and build-time `NEXT_PUBLIC_*` values. Configure your own Reown project for WalletConnect.
- Compile says image unavailable: build the agent image and check Docker permissions/context.
- Build queued indefinitely: inspect execution mode, worker process, database and storage/capacity checks.
- Public URL unavailable: local preview is separate from DNS/TLS/nginx publication.

The source release includes the app's brand graphics and poster images. Private promotional video files are omitted; optional landing-page video slots can use your own footage. This does not affect the builder, previews or generated-app publication.
- Local server fails after `next build`: development and build share `.next`. Stop development before building, or use a separate checkout.
- Restarted project lost files: configure persistent workspace/checkpoint directories and backup them with the database.
