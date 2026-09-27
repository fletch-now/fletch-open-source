# Guidance for coding agents adapting Fletch

This repository can be modified by people or coding agents. Read `AGENTS.md`, the README capability table and architecture before implementing a target. Inspect the installed framework/tool versions. Do not infer an existing plugin system or supported runtime from a documentation example.

## Establish the task

Identify whether you are changing the builder platform or generating an app with it. Write down the users, data sources, runtime, persistence, network access, identity and publication target. Classify each requirement as already supported, configuration work or a new adapter.

For a simple browser app, use the frontend-only path. For a SaaS application, plan a separate tenant-aware backend. For data collection, plan isolated workers and scheduling. For a new blockchain family, plan its native toolchain, wallet, artifact and signing model. Avoid adding a wallet or contract to an application that has no on-chain requirement.

## Implement and verify

1. Inspect the current path end to end: route → owner/selection validation → queue → worker → sandbox → reports → preview/publication.
2. Make the smallest coherent change through that path. Persist new target/template identifiers explicitly so follow-up builds and restored projects retain their meaning.
3. Preserve the existing security boundaries. Generated code stays untrusted; signing and privileged publication remain trusted operations. Credentials never enter generated source or browser bundles.
4. Use bounded structured tool calls and cancellation. Record external effects durably and reconcile retries. Do not weaken append-only accounting or owner checks to get a demo working.
5. Add tests for the changed behavior and relevant failure cases. Run existing affected suites, lint and typecheck. Use synthetic data and disposable local services.
6. Update the capability table, environment example, operating guide and migration instructions. Describe setup steps exactly and distinguish an unimplemented idea from a runnable command.

Completion reports should state changed files, verified commands/results, skipped checks, required infrastructure and remaining limitations. Never represent a stub, mock, unrun test, unavailable analyzer or unconfirmed deployment as working production behavior.

## Reusable task brief

```text
Adapt this builder for [application/runtime].
Users and workflow: [who does what].
Data and access: [sources, ownership, retention, permissions].
Frontend: [template, screens, accessibility, error states].
Backend: [existing API or new isolated service; persistent state].
Execution: [tools, image, limits, network policy, cancellation].
Publication: [static site or new server adapter; health and rollback].
Acceptance: [observable outcomes, failure cases, reproducible checks].
Preserve sandboxing, owner binding, credential isolation and durable effects.
Implement only the requested scope; document missing prerequisites honestly.
```

Before sharing changes, run the public-file check and credential scan. Do not include local environment files, host fingerprints, user prompts, screenshots of private sessions or production debugging records. See [security](../SECURITY.md) and [testing](testing.md).
