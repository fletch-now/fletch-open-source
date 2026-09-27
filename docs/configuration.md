# Configuration

Copying another operator's environment is not part of installation. `npm run setup:local` makes a private `.env.local` with fresh authentication and model-encryption secrets. It preserves existing configuration. Production workers read `/etc/fletch/fletch.env`; the web process must receive the same required values through its service environment. Never commit either file.

## Core settings

| Setting | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL connection; isolate development, tests and production |
| `BETTER_AUTH_SECRET` | Authentication secret; generate a random value for each instance |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | Canonical application origin, including scheme |
| `NEXT_PUBLIC_APP_DOMAIN` | Application hostname, with local port when developing |
| `NEXT_PUBLIC_APPS_DOMAIN` | Separate parent domain for published user sites |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Your wallet integration project identifier |
| `FORGE_DEV_LOGIN` | Local-only login shortcut; `0` in production |
| `FORGE_MAINNET_DEPLOYS` | Keep `0`; enabling a flag does not implement production-chain support |
| `FORGE_AGENT`, `FORGE_AGENT_BIN` | `cli` and `kimi` for the supplied real agent path |
| `FORGE_AGENT_SANDBOX`, `FORGE_AGENT_IMAGE` | `docker` and your installed image/tag or digest |
| `FORGE_BUILD_EXECUTION` | `legacy` for one local process; `worker` for independent durable workers |
| `FORGE_WORKSPACE_ROOT`, `FORGE_CHECKPOINT_ROOT` | Absolute, persistent, separate directories |
| `FORGE_SITES_ROOT` | Persistent immutable static-site releases |
| `MODEL_CREDENTIAL_KEY` | At least 32 characters; encrypts hosted user model credentials |
| `FORGE_PROXY_BIND`, `FORGE_PROXY_PORT` | Private container-reachable model proxy; worker port must differ from legacy 3901 |
| `MOONSHOT_API_KEY`, `MOONSHOT_MODEL` | Optional platform-paid model connection |
| `FORGE_DEPLOYER_KEY_46630` | Optional dedicated testnet signer, retained outside generated workspaces |
| `RPC_URL_<chainId>`, `RPC_LOG_URL_<chainId>` | Server RPC and log-reading endpoint overrides |
| `ALCHEMY_API_KEY` | Optional server-side provider credential |
| `ADMIN_WALLETS`, `ADMIN_PASSWORD_HASH` | Optional administrator access configuration; see `lib/admin/gate.ts` and `lib/config.ts` |
| `FLETCH_TREASURY_ADDRESS` | Credit-purchase destination; leave empty to disable purchases |

The default platform provider reads the Moonshot key. Putting an `OPENAI_API_KEY` in the web server environment does **not** select OpenAI for builds. Use Settings for hosted own-key selection, or a paired local gateway. See [providers](extensions/providers-and-tools.md).

## Browser values versus server secrets

`NEXT_PUBLIC_*` is embedded by Next.js at build time. Generated Vite apps likewise expose `VITE_*` to their browser. Neither location can hold a private API key or signer. Use a public/rate-limited RPC endpoint in generated apps and keep authenticated RPCs on the platform server. Rebuild the web release after changing public domains.

Worker-mode validation is implemented in `lib/build/durable/config.ts`. Production startup validation lives in `instrumentation-node.ts`. Keep `FORGE_UNSAFE_HOST_TOOLS` unset: disabling isolation is not a fix for a missing Docker installation.

The committed operations scripts use `builder.example.com` and `apps.example.com`. Render your own domain configuration using [publishing](operations/publishing.md); do not point a fork at the original service's infrastructure. Public chain addresses and links to upstream product documentation are not credentials.

## Advanced settings

The [environment index](environment-reference.md) maps source-read variables to their implementation. Many are optional tuning, integration-test or maintenance switches, not required setup. Read the referenced validation and defaults before overriding them. Numeric chain IDs, registry scope and contract addresses still have code-level definitions; environment overrides alone do not add a new chain.

Keep model-encryption keys alongside a protected backup of their ciphertext database. Changing that key without a migration makes stored model connections unreadable. Revoke compromised keys at their issuer; removing a value from Git or a config file does not revoke it.
