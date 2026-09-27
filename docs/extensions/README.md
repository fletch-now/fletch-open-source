# Extend the builder

The included implementation builds React apps and EVM contracts. It is designed around a reusable execution pipeline, but it does **not** currently load arbitrary chain plugins. Solana, Starknet and backend service publishing require implementation. These guides identify the code to change and the evidence a port should produce.

| Extension | Start here |
|---|---|
| EVM network | [Network, wallet, deployment and verification](evm.md) |
| Solana | [Program toolchain, accounts, signing and deployment](solana.md) |
| Starknet | [Cairo toolchain, native accounts and class declaration](starknet.md) |
| Ordinary web app / new template | [Frontend generation and server runtimes](web.md) |
| Data collection and scheduled jobs | [Data workflows](data-workflows.md) |
| Model or agent tool | [Provider transport and sandbox boundaries](providers-and-tools.md) |
| MCP tool | [MCP and gateway](../mcp-and-gateway.md) |
| New hosting target | [Publishing adapters](../operations/publishing.md) |

## A practical porting sequence

1. Run the existing local builder and test suite. Save a representative frontend and testnet contract build as a regression fixture without keys or personal data.
2. Define an explicit target, such as runtime family plus network identifier. Persist it with the project/build and bind it into the immutable execution selection. Do not infer the target from model output or from an arbitrary RPC URL.
3. Extract chain-specific compile, test, analyze, deploy, verify and wallet behavior from `lib/build/cli-builder.ts`. Retain queue ownership, cancellation, checkpoints, request limits and the durable effect journal.
4. Give reports a runtime discriminator. Current `CompileReport`, `ContractSummary` and `AnalysisReport` in `lib/build/types.ts` assume solc, EVM bytecode, ABI and Slither. A Cairo or Solana report must not be displayed as a successful Solidity report.
5. Add a pinned toolchain image and an image-owned template. Offline compiler runs need their dependencies preinstalled; do not let a model install arbitrary host packages.
6. Bind deployment to the saved artifact hash, target network and explicit authority. Record the signed/broadcast operation before advancing completion. Reconcile interrupted operations rather than blindly deploying again.
7. Add owner/target validation, report rendering, explorer links and truthful unavailable states in API/UI. Extend registry indexers separately if your fork needs them.

A future adapter interface could own `prepare`, `compile`, `test`, `analyze`, `deploy` and `verify`. That is a suggested refactor, not an existing API to import. Keep signing on the trusted side of the sandbox even if toolchain code moves behind an interface.

## Acceptance criteria

Each target needs tests for successful build, compiler error, failed tests, analysis unavailable, unknown network, wrong owner, cancellation during a tool call, stale worker ownership, RPC timeout and restart after broadcast. Complete at least one isolated testnet deployment and independently read it back before advertising support. Publishing failure must preserve the previous site. A green UI state must correspond to measured tool/chain evidence.
