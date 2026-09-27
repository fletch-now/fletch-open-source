# Contributing

Contributions are accepted under the repository's MIT license. Keep third-party notices and licenses intact. Do not include service credentials, personal data, customer workspaces or production incident evidence in a patch.

Start with [local development](docs/local-development.md) and [architecture](docs/architecture.md). This repository uses the installed Next.js version's conventions: follow `AGENTS.md` and consult `node_modules/next/dist/docs/` before changing framework behavior.

Open a focused change describing the user-visible problem, implementation and verification. For new networks/runtimes, follow the [extension guides](docs/extensions/README.md), state what is actually supported and provide testnet evidence with secrets removed. Solana and Starknet adapters are welcome contributions; they are not currently shipped features.

Keep generated code in the sandbox, signing outside it, provider credentials in their scoped transport, and credits in the append-only ledger. Preserve cancellation, worker ownership, deployment reconciliation and explicit publication. Do not fix a failing check by disabling a security boundary or relabeling skipped work as successful.

Run the relevant tests plus lint and typecheck. Follow [testing](docs/testing.md) for database, Docker and Linux coverage. Document unrun or skipped checks in the pull request. Changes to templates or toolchains require a versioned agent-image build; schema changes need a migration and restore/upgrade considerations.

Before pushing, install the local hook with `git config core.hooksPath .githooks`, run `npm run check:public`, and run Gitleaks over the Git history. The CI checks are an additional safeguard, not permission to commit a live credential and remove it later. Report security issues privately as described in [SECURITY.md](SECURITY.md).
