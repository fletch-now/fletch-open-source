# Implement a Solana backend

**Not included yet.** There is no working Solana build/deploy adapter in this snapshot. The platform currently uses Ethereum wallet login, viem addresses and Solidity reports. A Solana fork must replace these assumptions where appropriate while preserving execution ownership and isolation.

## Toolchain and reports

Build a separate, pinned image with Rust, the Solana CLI and a compatible Anchor toolchain. Preinstall dependencies used by your templates so compilation can run without network access. A local Anchor project uses `Anchor.toml`, program sources and generated build/IDL artifacts; start from the [official local development guide](https://www.anchor-lang.com/docs/quickstart/local).

The adapter should run and parse real `anchor build` and `anchor test` results in a disposable environment. A native Rust backend can use `cargo build-sbf`. Treat package scripts, procedural macros and build scripts as untrusted execution inside the sandbox. A local validator needs a bounded lifecycle, isolated ledger and cancellation cleanup; never aim tests at an operator's wallet by default.

Extend `lib/build/types.ts` with program ID, IDL/artifact hash, toolchain versions and runtime-specific diagnostics. Keep those separate from EVM ABI, solc version, bytecode size limits and Slither. Update `cli-builder.ts`, completion logic, saved project schema and UI together. Use an explicit `solana` target instead of inventing an EVM numeric chain ID.

## Identity and deployment

Add base58 public-key validation and Solana wallet integration to the generated template. For platform login, either retain the existing EVM login and separately link a Solana deployment authority, or implement a nonce-bound, domain-bound Solana sign-in flow with replay protection. A display address is not proof of ownership.

The trusted deployment service should control a dedicated devnet payer; the model receives no keypair. Solana CLI deployment uses `solana program deploy <program.so>` and separately manages program upgrade authority. Program identity and authority need durable storage; an upgrade must not silently become a fresh program. See [Solana program deployment](https://solana.com/docs/programs/deploying).

Persist artifact hash, network identity, program ID, authority policy and deployment transactions in the durable journal. Reconcile partial uploads, expired transactions and interrupted finalization against on-chain state before retrying. Never log signer material. Exclude generated keypair JSON, validator ledgers and deployment credentials from source exports.

## Template and evidence

Create a Solana-specific frontend foundation and dependency lockfile rather than injecting Solana into wagmi's EVM network switch. Bind cluster, program ID and IDL to the recorded build. Treat program verification as its own backend; Blockscout verification cannot be reused.

Test account ownership, signer checks, PDA derivation, instruction authorization, wrong-cluster requests and upgrade authority behavior. Prove a local validator build first, then a devnet deployment and independent program readback. Failures, missing analyzers and unverified programs must remain visible. Extending SPL/token indexing or Markets is a separate project from program generation.
