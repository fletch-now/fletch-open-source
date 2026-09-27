# Ordinary web apps, templates and backend services

## Frontend-only apps already work

Use a brief such as: “Build a responsive habit tracker with local browser storage. No blockchain, smart contract or wallet.” Needs analysis in `lib/agent/needs-rules.ts` and the CLI builder controls whether a contract/wallet is needed. The platform itself still uses its existing account login; this is separate from the generated application's features.

The included generated-app stack is Vite, React and TypeScript. It produces static output for previews and publication. The fact that the platform uses Next.js does not make generated apps Next.js servers.

## Change the foundation

1. Inspect `docker/webapp-template/template.json`, `foundation/`, `example/`, `prepare.mjs` and `build.mjs`, plus `lib/build/web.ts`.
2. Add approved dependencies to the template package manifest and regenerate its lockfile with npm. Review their licenses and build behavior.
3. Update the image-owned foundation and template version. Preserve required build exports, network/wallet rules and output checks unless your new target deliberately replaces them.
4. Update prompts/design guidance in `lib/agent/`, and test both fresh projects and continuation of an existing project.
5. Build a new agent image, run the template build, and verify browser behavior in the preview. Agent workspaces must not download arbitrary packages during normal offline compilation.

For a new framework, implement a separate template identity and output adapter. Do not teach a prompt to bypass the locked foundation. Persist the chosen template/version so restoring a project does not silently change its dependencies.

## APIs and full-stack applications

The current publisher serves static files. A generated API, database worker, SSR server or WebSocket service will not run merely by copying its source to `FORGE_SITES_ROOT`. Keep frontend calls pointed at an explicitly provisioned API until you implement a server runtime.

A server publisher needs isolated per-project processes/containers, runtime secret injection, resource and network policies, dependency locking, a build/release image, health checks, TLS routing, logs, backup/restore, migrations and rollback. Store a deployment handle in the platform instead of treating it as a static directory. Preserve explicit owner publication and durable effect recording.

Untrusted application servers need their own origin, credentials and network boundary. They must not inherit the builder's PostgreSQL credentials, provider keys, deployer key, Docker socket or host mounts. Use per-app databases or restricted roles rather than sharing the platform database. See [publishing](../operations/publishing.md) for the adapter boundary and [server operations](../operations/servers.md) for operating the builder itself.
