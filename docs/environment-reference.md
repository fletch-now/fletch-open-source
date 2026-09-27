# Environment source index

This index lists literal environment names referenced by application and operations source. It is a navigation aid, not a list of required settings. See [configuration](configuration.md) and `.env.example` first. Tests, dependencies, dynamic variable names and generic shell-local variables may not be represented. No environment values are collected.

Chain-specific reads additionally use `RPC_URL_<chainId>`, `RPC_LOG_URL_<chainId>` and the supported `FORGE_DEPLOYER_KEY_<chainId>` path. The current deployer supports its documented testnet only.

| Variable | Source locations |
|---|---|
| `ADMIN_GATE_SECRET` | [lib/admin/gate.ts](../lib/admin/gate.ts) |
| `ADMIN_PASSWORD_HASH` | [lib/admin/gate.ts](../lib/admin/gate.ts) |
| `ADMIN_WALLETS` | [lib/config.ts](../lib/config.ts) |
| `AGENT_CONTEXT_RESERVE_TOKENS` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `AGENT_OUTPUT_TOKENS` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `ALCHEMY_API_KEY` | [examples/alchemy-rpc/demo-script.js](../examples/alchemy-rpc/demo-script.js) |
| `API_KEY` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `APPS_DOMAIN` | [lib/apps/directory.ts](../lib/apps/directory.ts), [lib/build/stub-builder.ts](../lib/build/stub-builder.ts), [lib/hosting/publish.ts](../lib/hosting/publish.ts), [lib/hosting/share-metadata.ts](../lib/hosting/share-metadata.ts) |
| `APP_URL` | [app/api/v1/tokens/[address]/route.ts](../app/api/v1/tokens/[address]/route.ts), [app/developers/page.tsx](../app/developers/page.tsx), [app/registry/[symbol]/page.tsx](../app/registry/[symbol]/page.tsx), [app/registry/changes.xml/route.ts](../app/registry/changes.xml/route.ts) (additional uses in source) |
| `BASE` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `BASE_URL` | [lib/api/llm-reference.ts](../lib/api/llm-reference.ts) |
| `BETTER_AUTH_SECRET` | [lib/admin/gate.ts](../lib/admin/gate.ts), [lib/auth.ts](../lib/auth.ts), [lib/hosting/drafts.ts](../lib/hosting/drafts.ts), [lib/telegram/secret.ts](../lib/telegram/secret.ts) |
| `BETTER_AUTH_URL` | [app/api/builds/[id]/continue/route.ts](../app/api/builds/[id]/continue/route.ts), [lib/agent/key-origin.ts](../lib/agent/key-origin.ts), [lib/auth.ts](../lib/auth.ts), [lib/auth/v1.ts](../lib/auth/v1.ts) |
| `BLOCKSCOUT_API_KEY` | [lib/registry/authority/blockscout.ts](../lib/registry/authority/blockscout.ts), [lib/registry/priority-explorer-holders.ts](../lib/registry/priority-explorer-holders.ts), [lib/registry/priority-jobs.ts](../lib/registry/priority-jobs.ts) |
| `BUILD_CAPACITY_KEY` | [lib/build/queue.ts](../lib/build/queue.ts) |
| `BUILD_MAINTENANCE_KEY` | [lib/build/queue.ts](../lib/build/queue.ts) |
| `BUILD_SYSTEM_PROMPT` | [lib/build/kimi-builder.ts](../lib/build/kimi-builder.ts) |
| `BUILD_WATCH_NETWORK_DESCRIPTION` | [lib/docs/content.ts](../lib/docs/content.ts) |
| `BUILD_WORKER_HEALTH_KEY` | [lib/build/queue.ts](../lib/build/queue.ts) |
| `BUTTON` | [components/dashboard/settings/webhooks-card.tsx](../components/dashboard/settings/webhooks-card.tsx) |
| `CERTBOT_AUTH_OUTPUT` | [scripts/fletch-namesilo-dns.py](../scripts/fletch-namesilo-dns.py) |
| `CERTBOT_DOMAIN` | [scripts/fletch-namesilo-dns.py](../scripts/fletch-namesilo-dns.py) |
| `CERTBOT_VALIDATION` | [scripts/fletch-namesilo-dns.py](../scripts/fletch-namesilo-dns.py) |
| `CHAIN_FACTS` | [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts) |
| `CHAIN_ID` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `CHART_H` | [components/landing/live-data-flow.tsx](../components/landing/live-data-flow.tsx) |
| `CHART_W` | [components/landing/live-data-flow.tsx](../components/landing/live-data-flow.tsx) |
| `CHECKOUT_DESCRIPTION` | [components/landing/pricing-copy.ts](../components/landing/pricing-copy.ts), [lib/docs/content.ts](../lib/docs/content.ts) |
| `CHECKPOINT` | [lib/registry/authority/control-plane.ts](../lib/registry/authority/control-plane.ts) |
| `CHECKPOINT_NAME` | [lib/payments/sweep.ts](../lib/payments/sweep.ts) |
| `CLAIM_BATCH_SIZE` | [lib/watch/deliver.ts](../lib/watch/deliver.ts) |
| `CLAIM_LOCK` | [lib/build/queue.ts](../lib/build/queue.ts) |
| `CLAIM_RESERVE_MS` | [lib/watch/deliver.ts](../lib/watch/deliver.ts) |
| `CODE_SIMPLIFIER_STANDARD` | [lib/build/kimi-builder.ts](../lib/build/kimi-builder.ts) |
| `COMPACTION_GUIDANCE` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts), [lib/agent/context-policy.ts](../lib/agent/context-policy.ts) |
| `COUNTERPARTY` | [components/landing/demos/wallet-follow-demo.tsx](../components/landing/demos/wallet-follow-demo.tsx) |
| `CURRENT_BUILD` | [lib/apps/directory.ts](../lib/apps/directory.ts) |
| `DATABASE_URL` | [lib/db/index.ts](../lib/db/index.ts), [scripts/build-maintenance.ts](../scripts/build-maintenance.ts), [scripts/db-bootstrap.mjs](../scripts/db-bootstrap.mjs), [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh) |
| `DB_URL` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh) |
| `DEPLOYMENT_MANIFEST` | [lib/build/deployment-target.ts](../lib/build/deployment-target.ts) |
| `DEPLOY_AGENT_IMAGE` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh), [scripts/deploy.sh](../scripts/deploy.sh) |
| `DEPLOY_BUILD_WORKER` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh), [scripts/deploy.sh](../scripts/deploy.sh) |
| `DEPLOY_PROXY_BIND` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh), [scripts/deploy.sh](../scripts/deploy.sh) |
| `DEPLOY_REGISTRY` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh) |
| `DESIGN_FACTS` | [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts) |
| `DOCKER_CONFIG` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `DOCKER_HOST` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `DOCS_VERIFIED_AT` | [lib/docs/markdown.ts](../lib/docs/markdown.ts) |
| `EOA_RECHECK_DAYS` | [lib/registry/authority/labels.ts](../lib/registry/authority/labels.ts) |
| `FIELD` | [components/apps/listing-editor.tsx](../components/apps/listing-editor.tsx) |
| `FLETCH_API_KEY` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `FLETCH_API_URL` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `FLETCH_BACKUP_LOCK_PATH` | [scripts/fletch-backup.sh](../scripts/fletch-backup.sh) |
| `FLETCH_DISCOVERY_WORKER` | [lib/registry/authority/dex.ts](../lib/registry/authority/dex.ts) |
| `FLETCH_HOST` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh), [scripts/deploy.sh](../scripts/deploy.sh) |
| `FLETCH_KEY` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh), [scripts/deploy.sh](../scripts/deploy.sh) |
| `FLETCH_PRIORITY_REFRESH` | [scripts/refresh-priority-tokens.ts](../scripts/refresh-priority-tokens.ts) |
| `FLETCH_TREASURY_ADDRESS` | [lib/payments/sweep.ts](../lib/payments/sweep.ts), [lib/payments/treasury.ts](../lib/payments/treasury.ts), [workers/watch.ts](../workers/watch.ts) |
| `FLOWS_NAME` | [lib/registry/authority/bridge.ts](../lib/registry/authority/bridge.ts) |
| `FORGE_AGENT` | [app/api/status/route.ts](../app/api/status/route.ts), [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/build/durable/runner.ts](../lib/build/durable/runner.ts), [lib/build/index.ts](../lib/build/index.ts) |
| `FORGE_AGENT_BIN` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `FORGE_AGENT_CPUS` | [lib/admin/queries.ts](../lib/admin/queries.ts) |
| `FORGE_AGENT_DEBUG` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `FORGE_AGENT_IMAGE` | [lib/agent/sandbox.ts](../lib/agent/sandbox.ts), [lib/build/pricing-quotes.ts](../lib/build/pricing-quotes.ts) |
| `FORGE_AGENT_MEMORY` | [lib/admin/queries.ts](../lib/admin/queries.ts) |
| `FORGE_AGENT_REPAIR_ROUNDS` | [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/build/cli-builder.ts](../lib/build/cli-builder.ts) |
| `FORGE_AGENT_SANDBOX` | [app/api/status/route.ts](../app/api/status/route.ts), [lib/agent/sandbox.ts](../lib/agent/sandbox.ts) |
| `FORGE_AGENT_TIMEOUT_MS` | [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts) |
| `FORGE_BUILDS_GLOBAL_DAY` | [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/ratelimit.ts](../lib/ratelimit.ts) |
| `FORGE_BUILDS_PER_IP_HOUR` | [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/ratelimit.ts](../lib/ratelimit.ts) |
| `FORGE_BUILDS_PER_USER_HOUR` | [lib/admin/queries.ts](../lib/admin/queries.ts), [lib/ratelimit.ts](../lib/ratelimit.ts) |
| `FORGE_BUILD_EXECUTION` | [lib/build/durable/routing.ts](../lib/build/durable/routing.ts) |
| `FORGE_CHECKPOINT_ROOT` | [lib/build/durable/continuation.ts](../lib/build/durable/continuation.ts), [lib/build/durable/continue.ts](../lib/build/durable/continue.ts), [lib/build/durable/model-reconciliation.ts](../lib/build/durable/model-reconciliation.ts), [lib/build/durable/runner.ts](../lib/build/durable/runner.ts) (additional uses in source) |
| `FORGE_DEV_LOGIN` | [app/api/dev/login/route.ts](../app/api/dev/login/route.ts), [lib/auth.ts](../lib/auth.ts) |
| `FORGE_DRAFTS_ROOT` | [lib/hosting/drafts.ts](../lib/hosting/drafts.ts) |
| `FORGE_MAINNET_DEPLOYS` | [lib/build/deploy.ts](../lib/build/deploy.ts) |
| `FORGE_MANUAL_PUBLISH` | [lib/build/cli-builder.ts](../lib/build/cli-builder.ts) |
| `FORGE_MAX_CONCURRENT_BUILDS` | [lib/build/capacity.ts](../lib/build/capacity.ts), [lib/build/queue.ts](../lib/build/queue.ts) |
| `FORGE_MODEL_REQUEST_TIMEOUT_MS` | [lib/agent/credential-proxy.ts](../lib/agent/credential-proxy.ts) |
| `FORGE_PROXY_BIND` | [lib/agent/credential-proxy.ts](../lib/agent/credential-proxy.ts) |
| `FORGE_PROXY_PORT` | [lib/agent/credential-proxy.ts](../lib/agent/credential-proxy.ts) |
| `FORGE_SITES_ROOT` | [lib/hosting/publish.ts](../lib/hosting/publish.ts) |
| `FORGE_UNSAFE_HOST_TOOLS` | [lib/agent/sandbox.ts](../lib/agent/sandbox.ts) |
| `FORGE_WORKSPACE_MAX_BYTES` | [lib/build/workspace.ts](../lib/build/workspace.ts) |
| `FORGE_WORKSPACE_ROOT` | [lib/build/workspace.ts](../lib/build/workspace.ts), [workers/build.ts](../workers/build.ts) |
| `GITHUB_URL` | [app/developers/page.tsx](../app/developers/page.tsx), [components/landing/site-footer.tsx](../components/landing/site-footer.tsx) |
| `GOOGLE_SITE_VERIFICATION` | [app/layout.tsx](../app/layout.tsx) |
| `HEARTBEAT_FRESH_SECONDS` | [app/(admin)/trafalgar/(gated)/system/page.tsx](../app/%28admin%29/trafalgar/%28gated%29/system/page.tsx) |
| `HOLDER_CAMPAIGN` | [lib/holder-rewards/admin.ts](../lib/holder-rewards/admin.ts), [lib/holder-rewards/store.ts](../lib/holder-rewards/store.ts) |
| `HOLDER_CHECK_MS` | [lib/holder-rewards/store.ts](../lib/holder-rewards/store.ts) |
| `HOLDER_CREDITS` | [lib/holder-rewards/store.ts](../lib/holder-rewards/store.ts) |
| `HOLDER_POLICY_KEY` | [lib/holder-rewards/admin.ts](../lib/holder-rewards/admin.ts), [lib/holder-rewards/store.ts](../lib/holder-rewards/store.ts) |
| `HYPERSYNC_API_KEY` | [lib/registry/authority/hypersync.ts](../lib/registry/authority/hypersync.ts) |
| `HYPERSYNC_URL` | [lib/registry/authority/hypersync.ts](../lib/registry/authority/hypersync.ts) |
| `INDEXABLE_TOKENS_SQL` | [lib/registry/seo.ts](../lib/registry/seo.ts) |
| `INTERNAL_CRON_SECRET` | [app/api/internal/reap/route.ts](../app/api/internal/reap/route.ts), [app/api/internal/registry-sync/route.ts](../app/api/internal/registry-sync/route.ts) |
| `JOINS` | [lib/apps/directory.ts](../lib/apps/directory.ts) |
| `LATEST_RESIDUAL` | [lib/registry/browse.ts](../lib/registry/browse.ts) |
| `LEDGER_NAME` | [lib/registry/authority/ledger.ts](../lib/registry/authority/ledger.ts) |
| `LOOKALIKE_COUNT` | [lib/registry/browse.ts](../lib/registry/browse.ts) |
| `MAX_ASSETS_WITH_EXTRAS` | [app/api/v1/chains/[chainId]/assets/route.ts](../app/api/v1/chains/[chainId]/assets/route.ts) |
| `MAX_DAYS` | [app/api/v1/chains/[chainId]/assets/[symbol]/history/route.ts](../app/api/v1/chains/[chainId]/assets/[symbol]/history/route.ts) |
| `MAX_NAME` | [app/api/projects/[id]/route.ts](../app/api/projects/[id]/route.ts), [components/chat/app-picker.tsx](../components/chat/app-picker.tsx) |
| `MAX_OUTPUT_TOKENS` | [packages/fletch-gateway/gateway.mjs](../packages/fletch-gateway/gateway.mjs) |
| `MAX_PROMPT_CHARS` | [lib/agent/enhance.ts](../lib/agent/enhance.ts) |
| `MAX_QUOTE_SAMPLE_SECONDS` | [lib/registry/authority/market-swaps.ts](../lib/registry/authority/market-swaps.ts) |
| `MCP_CMD` | [app/developers/page.tsx](../app/developers/page.tsx) |
| `MIN_PROMPT_CHARS` | [app/api/builds/route.ts](../app/api/builds/route.ts) |
| `MISSING` | [lib/agent/wallet-foundation.ts](../lib/agent/wallet-foundation.ts) |
| `MODEL_CREDENTIAL_KEY` | [app/(admin)/trafalgar/(gated)/system/page.tsx](../app/%28admin%29/trafalgar/%28gated%29/system/page.tsx), [lib/agent/credential-secret.ts](../lib/agent/credential-secret.ts) |
| `MOONSHOT_API_KEY` | [lib/agent/provider.ts](../lib/agent/provider.ts) |
| `MOONSHOT_MODEL` | [lib/agent/provider.ts](../lib/agent/provider.ts) |
| `NEXT_PUBLIC_APPS_DOMAIN` | [lib/config.ts](../lib/config.ts) |
| `NEXT_PUBLIC_APP_DOMAIN` | [lib/config.ts](../lib/config.ts) |
| `NEXT_PUBLIC_APP_URL` | [lib/config.ts](../lib/config.ts) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | [lib/build/cli-builder.ts](../lib/build/cli-builder.ts), [lib/build/mainnet.ts](../lib/build/mainnet.ts), [lib/config.ts](../lib/config.ts) |
| `NODE_ENV` | [app/api/previews/[buildId]/[token]/[...path]/route.ts](../app/api/previews/[buildId]/[token]/[...path]/route.ts), [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts), [lib/auth-cookie.ts](../lib/auth-cookie.ts), [lib/build/index.ts](../lib/build/index.ts) (additional uses in source) |
| `NOTE` | [app/api/v1/chains/[chainId]/assets/[symbol]/pools/route.ts](../app/api/v1/chains/[chainId]/assets/[symbol]/pools/route.ts), [app/api/v1/chains/[chainId]/dex/route.ts](../app/api/v1/chains/[chainId]/dex/route.ts) |
| `ORIGIN` | [lib/registry/priority-explorer-holders.ts](../lib/registry/priority-explorer-holders.ts) |
| `PATH` | [lib/agent/cli-runner.ts](../lib/agent/cli-runner.ts), [scripts/fletch-backup.sh](../scripts/fletch-backup.sh), [scripts/rolling/compile-web.mjs](../scripts/rolling/compile-web.mjs) |
| `PGAPPNAME` | [lib/db/index.ts](../lib/db/index.ts) |
| `PGPOOL_MAX` | [lib/db/index.ts](../lib/db/index.ts) |
| `POLL_MS` | [app/api/v1/chains/[chainId]/events/stream/route.ts](../app/api/v1/chains/[chainId]/events/stream/route.ts) |
| `POOLS_NAME` | [lib/registry/authority/dex.ts](../lib/registry/authority/dex.ts) |
| `POOLS_V3_NAME` | [lib/registry/authority/dex.ts](../lib/registry/authority/dex.ts) |
| `POOL_DEPTH_DESCRIPTION` | [lib/api/openapi.ts](../lib/api/openapi.ts) |
| `POPOVER_ITEM_CLASS` | [components/registry/filter-menu.tsx](../components/registry/filter-menu.tsx) |
| `PREVIEW_STORAGE` | [lib/hosting/preview-response.ts](../lib/hosting/preview-response.ts) |
| `PRICE_PER_CREDIT_USDG` | [app/(dashboard)/dashboard/page.tsx](../app/%28dashboard%29/dashboard/page.tsx), [lib/payments/usdg.ts](../lib/payments/usdg.ts) |
| `PROBE_SHARE_DENOMINATOR` | [lib/registry/authority/labels.ts](../lib/registry/authority/labels.ts) |
| `PUBLIC` | [lib/apps/directory.ts](../lib/apps/directory.ts) |
| `PURCHASE_KEY_PREFIX` | [lib/payments/usdg.ts](../lib/payments/usdg.ts) |
| `REGISTRY_BACKFILL_FROM` | [lib/registry/authority/constants.ts](../lib/registry/authority/constants.ts) |
| `RENEWED_LINEAGE` | [scripts/fletch-wildcard-cert.py](../scripts/fletch-wildcard-cert.py) |
| `REOWN_ID` | [scripts/deploy-legacy.sh](../scripts/deploy-legacy.sh) |
| `REPLY_RULES` | [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts) |
| `RH_MAINNET_ID` | [app/(admin)/trafalgar/(gated)/registry/page.tsx](../app/%28admin%29/trafalgar/%28gated%29/registry/page.tsx), [app/(admin)/trafalgar/(gated)/tokens/page.tsx](../app/%28admin%29/trafalgar/%28gated%29/tokens/page.tsx), [app/developers/page.tsx](../app/developers/page.tsx), [app/registry/changes/page.tsx](../app/registry/changes/page.tsx) (additional uses in source) |
| `RH_TESTNET_ID` | [components/landing/site-footer.tsx](../components/landing/site-footer.tsx), [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts), [lib/build/deploy.ts](../lib/build/deploy.ts), [lib/build/kimi-builder.ts](../lib/build/kimi-builder.ts) (additional uses in source) |
| `ROBINHOOD_ASSETS_ENDPOINT` | [app/(admin)/trafalgar/(gated)/registry/page.tsx](../app/%28admin%29/trafalgar/%28gated%29/registry/page.tsx) |
| `ROBINHOOD_PRICES_ENDPOINT` | [lib/registry/authority/api-prices.ts](../lib/registry/authority/api-prices.ts) |
| `RPC_URL_1` | [lib/registry/authority/chain.ts](../lib/registry/authority/chain.ts) |
| `RPC_URL_4663` | [lib/registry/sync.ts](../lib/registry/sync.ts) |
| `RPC_URL_46630` | [workers/watch.ts](../workers/watch.ts) |
| `SHARED_RULES` | [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts) |
| `SITE_NAME` | [app/layout.tsx](../app/layout.tsx), [app/manifest.ts](../app/manifest.ts) |
| `SITE_TAGLINE` | [app/manifest.ts](../app/manifest.ts) |
| `SOLC_VERSION` | [lib/build/foundry.ts](../lib/build/foundry.ts) |
| `STARTER_CREDITS` | [app/(dashboard)/dashboard/page.tsx](../app/%28dashboard%29/dashboard/page.tsx), [lib/docs/content.ts](../lib/docs/content.ts), [lib/starter-credit.ts](../lib/starter-credit.ts) |
| `STARTER_CREDIT_DESCRIPTION` | [components/landing/pricing-copy.ts](../components/landing/pricing-copy.ts), [lib/docs/concepts.ts](../lib/docs/concepts.ts) |
| `STARTER_CREDIT_SETTING` | [lib/starter-credit.ts](../lib/starter-credit.ts) |
| `STATE_RETRY_MAX_MS` | [lib/registry/authority/dex-state-retry.ts](../lib/registry/authority/dex-state-retry.ts) |
| `STATE_RETRY_MIN_MS` | [lib/registry/authority/dex-state-retry.ts](../lib/registry/authority/dex-state-retry.ts) |
| `STOP_REQUESTED` | [lib/build/queue.ts](../lib/build/queue.ts), [lib/build/reaper.ts](../lib/build/reaper.ts) |
| `SWAP_BACKFILL_POOLS` | [lib/registry/authority/market-swaps.ts](../lib/registry/authority/market-swaps.ts) |
| `SWAP_USDG` | [lib/registry/authority/market-swaps.ts](../lib/registry/authority/market-swaps.ts) |
| `SWAP_WETH` | [lib/registry/authority/market-swaps.ts](../lib/registry/authority/market-swaps.ts) |
| `TELEGRAM_API_BASE` | [lib/telegram/client.ts](../lib/telegram/client.ts) |
| `TELEGRAM_BOT_TOKEN` | [lib/telegram/client.ts](../lib/telegram/client.ts), [lib/watch/deliver.ts](../lib/watch/deliver.ts) |
| `TELEGRAM_BOT_USERNAME` | [lib/telegram/client.ts](../lib/telegram/client.ts) |
| `TELEGRAM_TOKEN_KEY` | [lib/telegram/secret.ts](../lib/telegram/secret.ts) |
| `TELEGRAM_WEBHOOK_SECRET` | [app/api/webhooks/telegram/route.ts](../app/api/webhooks/telegram/route.ts), [lib/telegram/client.ts](../lib/telegram/client.ts) |
| `TEMPLATE_MODULES` | [lib/build/web.ts](../lib/build/web.ts) |
| `TOKEN_EXAMPLE` | [lib/docs/content.ts](../lib/docs/content.ts) |
| `TOKEN_REFRESH_MS` | [lib/registry/authority/dex-token-queue.ts](../lib/registry/authority/dex-token-queue.ts) |
| `TOKEN_RETRY_MS` | [lib/registry/authority/dex-token-queue.ts](../lib/registry/authority/dex-token-queue.ts) |
| `TOOLCHAIN_MARKER` | [lib/build/cli-builder.ts](../lib/build/cli-builder.ts) |
| `TOOLCHAIN_RULES` | [lib/agent/chain-facts.ts](../lib/agent/chain-facts.ts) |
| `UNLABELLED_MATERIAL_HOLDERS` | [lib/registry/authority/labels.ts](../lib/registry/authority/labels.ts) |
| `VERIFIED_IDENTITY` | [lib/registry/browse.ts](../lib/registry/browse.ts) |
| `VERSION` | [packages/fletch-mcp/index.mjs](../packages/fletch-mcp/index.mjs) |
| `WALLET` | [components/landing/demos/wallet-follow-demo.tsx](../components/landing/demos/wallet-follow-demo.tsx) |
| `WALLET_FOUNDATION_REPAIR` | [lib/build/cli-builder.ts](../lib/build/cli-builder.ts) |
| `WIDTH` | [components/registry/line-chart.tsx](../components/registry/line-chart.tsx) |
