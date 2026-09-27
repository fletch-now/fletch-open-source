# Implement a Starknet backend

**Not included yet.** Cairo/Starknet support requires a new runtime adapter, toolchain, wallet foundation and deployment policy. Changing an EVM chain ID or asking the model for Cairo does not implement it.

## Build and test

Create a pinned image containing mutually compatible Cairo/Scarb and Starknet Foundry versions. Preinstall template dependencies; isolate any package build scripts. Compile with `scarb build` and run actual Starknet tests through `snforge test`. Record diagnostics, tool versions and artifact hashes. See [Scarb](https://docs.swmansion.com/scarb/docs) and [Starknet Foundry](https://github.com/foundry-rs/starknet-foundry).

Extend `lib/build/types.ts` with Starknet-specific compile/test evidence, Sierra/CASM artifacts where applicable, class hashes, contract addresses and transaction hashes. Do not populate solc or Slither success fields for this backend. Update the completion rules, database representation, restored project context and UI with a runtime discriminator.

## Native accounts and trusted signing

Starknet's accounts are part of its native account-abstraction model; the platform's current Ethereum SIWE/address assumptions are not interchangeable with them. Either separately link a Starknet authority to an existing platform account or implement authenticated Starknet account ownership with domain/nonce binding. See [Starknet accounts](https://docs.starknet.io/learn/protocol/accounts).

Use a dedicated testnet account on the trusted side of the deployment boundary. Keep keystores and account secrets outside generated workspaces. Validate network, account, nonce, fee policy and the user's intended owner before signing. Contract constructors and ownership initialization require a Starknet-specific manifest instead of the EVM `constructor(address)` convention.

Declaration and deployment are distinct effects. Record each result before proceeding: the class declaration may already exist even when a worker is interrupted before deployment. Persist class hash, deployment inputs/salt, contract address and receipts; reconcile both stages after restart. The official [`sncast` reference](https://foundry-rs.github.io/starknet-foundry/appendix/sncast.html) describes the declaration/deployment commands; select explicit flags for the toolchain version you pin.

## Frontend and verification

Create a Starknet wallet/RPC template, replacing the EVM wagmi foundation for this runtime. Resolve network identity and contract ABI from saved build data. Add a source-verification integration only when you can independently confirm its result; an explorer link is not proof of verification.

Acceptance tests should cover a fresh declaration, an existing class, constructor failure, account rejection, wrong network, nonce conflict, fee exhaustion and a worker restart between declaration and deployment. First prove a local/devnet build, then one testnet deployment with no user funds. Leave unsupported analysis and registry features explicitly unavailable.
