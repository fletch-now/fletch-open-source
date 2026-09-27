<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on this open-source builder

Read `README.md`, `docs/architecture.md` and `docs/agent-guide.md` before changing execution behavior. Follow the extension guide for the target runtime or application type. Existing EVM support does not imply Solana, Starknet, generated backend hosting or scraper workers are already implemented.

Keep generated/model-authored code inside the sandbox. Keep signing keys and provider credentials outside workspaces. Preserve ownership checks, immutable execution selection, cancellation, durable effect reconciliation and explicit publication. Report actual tool evidence; never label a simulated or skipped step as successful execution.

Use synthetic fixtures and placeholder domains. Do not commit environment files, personal paths, host identities, operational evidence, user prompts or customer data. Run the relevant tests, `npm run lint`, `npm run typecheck`, `npm run check:public` and Gitleaks before proposing publication. Clearly report missing prerequisites and unrun checks.

The source is MIT licensed. Retain third-party notices. Keep changes focused on the requested application and document how another person can run, extend and verify them.
