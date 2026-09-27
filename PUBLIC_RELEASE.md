# Public-source preparation

This is a clean source snapshot with a fresh Git history and MIT licensing. It includes the complete builder implementation, companion services, tests, schema, reusable operations code and public operating/extension guidance. It does not import the private development repository's commits, branches, remotes or author metadata.

## Privacy review

The review covered source and configuration, the source repository's reachable Git history, known configured credential values, identifiers and URLs, infrastructure scripts, examples, binary assets and image metadata. Credentials/private environment files, local agent configuration, personal filesystem paths, machine identifiers/fingerprints, private deployment history, linked operator test-app/wallet activity, private media work and customer/operations data are outside this release. Infrastructure scripts now require operator-supplied host identities and deployment destinations.

Identifying image metadata was removed without re-encoding the image pixels. The public graphics and necessary public protocol addresses remain. Third-party copyright/license attribution remains intact. Public chain constants and deliberately synthetic security-test fixtures are not treated as private credentials.

Gitleaks found no remaining findings in the prepared public source, including encoded-content scanning. The public-file checker and exact known-credential matching also passed. Narrow, documented Gitleaks allowlists cover public contract identifiers, prose and liquidity-method names. No directory-wide secret-scan exemptions are used for source/tests.

This is a source-publication audit, not a guarantee that no unknown secret can exist, a penetration test, or an independent review of generated contracts. Review future changes before publication; the included CI and pre-push hook repeat the automated checks.

## Verification

Validated locally with Node 24.4.1 and PostgreSQL 15.14; documented setup and CI target Node 22/PostgreSQL 16.

| Check | Result |
|---|---|
| Dependency installation | Passed for app and MCP |
| ESLint and TypeScript | Passed |
| App unit/database tests | 874 passed, 0 failed, 10 skipped |
| MCP tests | 17 passed; live API checks are opt-in |
| Production build and standalone cleanup | Passed |
| Standalone HTTP smoke | Health including database, homepage, build docs and OpenAPI returned 200 |
| Local setup | Generates fresh secrets, private permissions; preserves existing configuration |
| Fresh database bootstrap | Current schema, SQL-only publication tables and required invariants verified |
| Domain rendering | Hostname validation and matching publisher/installer checksum verified |
| Privacy check | Passed, including synthetic rejection fixtures |
| Source documentation links | Checked locally |

Docker was unavailable in the validation environment. Real model generation, Docker/Foundry execution, Linux mount-namespace tests, the container-based privileged publisher installer, live DNS/TLS publication and live-chain deployment were **not validated**. No production service was changed. Solana, Starknet, generated backend hosting and general-purpose data workers remain documented extensions rather than shipped adapters.

## Publish this snapshot

Use this clean repository as the public source. Do not make an existing private repository public or attach its old Git history to this one.

The source ZIP contains tracked source files only, without `.git` or dependencies. If starting from that archive, run `git init -b main`, stage the source with `git add .`, run the checks below, then create your initial commit before pushing. Use a public-safe author identity for that commit.

```bash
git config core.hooksPath .githooks
npm run check:public
gitleaks git --redact --no-banner --log-opts='--all' .
# After creating an empty destination repository, replace the quoted placeholder:
git remote add origin 'YOUR_NEW_REPOSITORY_URL'
git push -u origin main
```

Before inviting contributors, enable branch protection and private vulnerability reporting on the destination. Future fixes should preserve MIT/third-party notices, add reproducible tests and keep capability claims aligned with implemented behavior. See [contributing](CONTRIBUTING.md), [agent guidance](docs/agent-guide.md) and [community adoption](docs/community.md).
