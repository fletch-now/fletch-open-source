# Security

## Reporting

Use the repository's **Security → Report a vulnerability** flow when private vulnerability reporting is enabled. If that option is unavailable, ask the repository maintainer for a private channel without including exploit details or secrets in a public issue. Fork operators should enable private reporting before inviting users and publish their own incident contact. No unconfigured email address is implied by this file.

Include the affected commit, component, a minimal reproduction using synthetic data and the observed impact. Never send a live private key or another user's data. Do not test against the hosted service or third-party infrastructure without authorization.

## Boundaries operators must preserve

- Model-authored code and attached files are untrusted. Run them in the configured sandbox with bounded mounts, resources, output and lifetime. Never enable host-tool execution on a public service.
- Keep signing keys, database access and upstream model credentials outside generated workspaces. Hosted model encryption protects stored ciphertext; it does not prevent the operator from accessing keys used by their server.
- User-generated previews and published sites need separate origins and the included preview restrictions. A user's static site must not inherit platform cookies or server credentials.
- Enforce owner identity, execution selection, spend policy and publication authorization server-side. Reconcile external effects after worker failure; never repeat a transaction merely because a browser disconnected.
- Treat backups, checkpoints, prompt logs, MCP capabilities and gateway pairings as private operational data.

Compiler checks, tests and static analysis are useful evidence, not a guarantee against malicious or vulnerable contracts. This public-source preparation is not an independent penetration test or a comprehensive smart-contract audit. Operators remain responsible for their deployment, dependency updates and generated applications.

## Credentials and history

Use the example configuration and generate your own credentials. `.gitignore`, the public-file checker, the pre-push hook and Gitleaks provide complementary checks. Review staged changes; exclusions do not protect a file already tracked by Git.

If a real secret is committed, revoke or rotate it at the issuing service first. Removing the current file does not remove earlier commits, forks, caches or clones. Follow [GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). Do not publish a private production repository's full history simply because its latest tree looks clean.

Never upload production environment files, database dumps, personal workspaces, deployment logs or generated keypairs for debugging. Redact logs before sharing and retain enough structured evidence to reproduce failures safely.
