# Add an EVM network

This is a source change. The current network definitions are Robinhood mainnet `4663` and testnet `46630`; deployment is centered on the testnet. Mainnet registry reads do not imply mainnet builder deployment support.

## Change map

| Area | Files to inspect |
|---|---|
| Network IDs / public links | `lib/config.ts`, `lib/chains.ts`, `lib/chain/rpc.ts`, `lib/chain/explorer.ts` |
| Platform wallet and sign-in | `lib/wallets.ts`, auth routes and wallet providers under `components/` |
| Generated app network | `docker/webapp-template/foundation/network.ts`, wallet foundation, `lib/agent/wallet-foundation.ts` |
| Prompt facts and contract assumptions | `lib/agent/chain-facts.ts`, `lib/agent/needs-rules.ts`, builder prompts under `lib/agent/` and `lib/build/cli-builder.ts` |
| Artifact selection / signer | `lib/build/deployment-target.ts`, `lib/build/deploy.ts`, `lib/build/mainnet.ts` |
| Verification and explorer evidence | `lib/build/verify.ts`, completion reports and client build UI |
| Persistent target / recovery | `lib/db/`, `lib/build/create.ts`, `lib/build/durable/` |

`getPublicClient` currently selects between two networks. Replace its unknown-ID fallback with an explicit allowlist and rejection when broadening support. Do the same in generated-app network validation. A malformed ID must never silently send a transaction to another chain.

## Implementation steps

1. Add an audited chain definition containing chain ID, native currency, public RPC and explorer. Confirm those values against that chain's official documentation. Configure server `RPC_URL_<id>` and `RPC_LOG_URL_<id>` overrides as needed.
2. Add chain facts: supported EVM/compiler target, block/time semantics, known protocols and source provenance. Remove Robinhood-specific token and protocol assumptions from prompts for the new target.
3. Persist the selected network at project/build creation. Pass it through the execution input instead of relying on the current global testnet constant. Bind signing, receipts, explorer requests and generated wallet switching to that same target.
4. Extend deployment policy explicitly. The current signer lookup uses `FORGE_DEPLOYER_KEY_46630`; naming another environment variable does not enable it. Keep keys outside the workspace and keep the user's owner separate from the gas-paying platform account. Review supported constructors and `fletch.deploy.json` selection.
5. Implement the target explorer's actual verification API. The included verifier uses Blockscout standard JSON input and polls its response. An explorer URL or successful transaction alone is not source verification.
6. Rebuild/version the agent image after modifying the generated-app foundation or dependencies. Keep browser RPC settings public and server RPC credentials private.

Run local compilation, tests and analysis first, then a tiny testnet contract with no user funds. Check chain ID from RPC, ownership on-chain, transaction receipt, deployed bytecode and verified source. Exercise a restart after broadcast and a duplicate request. Add fixtures proving unknown IDs, unsupported constructors and stale workers cannot deploy.

Registry/Markets/Watch assume particular EVM contracts and data sources. Either leave them scoped to their existing chains or port the relevant indexers and clearly label source coverage. Do not relabel Robinhood observations as data for the new network.
