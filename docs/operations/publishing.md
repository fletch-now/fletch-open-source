# Publish generated applications

## Built-in static publisher

The generated-app compiler produces static Vite assets. The owner requests publication after reviewing a draft. `lib/hosting/publications.ts` runs the request under worker ownership; `lib/hosting/publish.ts` copies the build into `<sitesRoot>/<slug>/<buildId>`, atomically switches `current`, runs a narrow privileged certificate helper, then confirms the HTTPS URL returns 200. A failed attempt restores the preceding release.

This publisher does not launch arbitrary generated Node servers. Secrets cannot be kept in static browser code. Add a backend adapter if your templates need server-only computation, a database or secret-bearing API calls.

## Your domains and Linux templates

Use a distinct app-hosting domain with wildcard DNS, preferably a separate registrable domain from the dashboard. This keeps untrusted user apps away from the platform's cookie origin. Example domains in the source are non-operational placeholders.

```bash
python3 scripts/configure-instance.py \
  --app-domain builder.example.org \
  --apps-domain apps.example.net \
  --output release-config
```

This writes a local, ignored bundle and never connects to a server. Set the same values in the web build/runtime environment. Review the generated nginx configs, publishing helper, certificate hooks, service accounts, filesystem paths and network defaults. The renderer updates the helper's pinned SHA256 in the matching installer. Keep the helper and installer from the **same** bundle.

On the Linux host:

1. Point the dashboard hostname and wildcard `*.apps-domain` DNS at the intended host/load balancer. Set any certificate DNS plugin credentials outside Git.
2. Create `/var/lib/fletch/sites` and the TLS/webroot paths expected by the reviewed configs. Keep the publishing helper and sudoers configuration root-owned and not writable by the app/worker.
3. Install the reviewed `fletch-apps-cert-hook`, nginx app configs and Certbot renewal hook from the bundle. Provision certificates before directing traffic. Run `nginx -t` before each reload.
4. Use the bundle's `install-publish-helper.py install` with its matching `fletch-publish-site`. Inspect the script before running it as root. The installer checks ownership, file type and the pinned source digest.
5. Install `fletch-publish.sudoers` with mode 0440 and validate it using `visudo -cf`. It permits the fixed helper; do not grant an unrestricted root shell to the worker.
6. Ensure the worker's systemd mount namespace permits the helper's intended certificate/nginx writes. Run the installer's `check` when workers are active. Test a disposable project and verify HTTPS from the actual worker host.

The supplied scripts support per-host certificate issuance and an activated wildcard certificate. Follow their validations instead of disabling them if a path or permission differs. Your certificate/DNS provider must be configured for your account; the optional NameSilo helpers are one provider-specific implementation.

## Other static hosts

Replace the platform-owned publication step with an adapter that uploads verified `dist` output to your static host. Keep provider credentials on the worker, never in prompts or workspaces. Preserve these semantics:

- validate owner, slug, regular files and output size;
- upload to an immutable build/version key;
- check cancellation and active worker ownership before changing the live alias;
- record a stable idempotency/effect key before dispatch;
- verify the resulting HTTPS endpoint;
- on failure retain the prior live version;
- implement unpublish, listing state and cleanup consistently.

Update `lib/hosting/publish.ts`, `publications.ts`, `publication-types.ts`, health checks and tests together. The current interface is not a drop-in S3/Cloudflare/Vercel plugin registry.

## Generated server apps

Add a separate runtime class with image builds, private networking, resource quotas, per-project secrets, health checks, logs, upgrades and rollback. Do not execute generated servers inside the control-plane process or its privileged publishing helper. Model tools should not receive your cloud control token. Store runtime deployments as evidence distinct from static publication and contract deployment. Make operator quotas and user approval visible before any spend.
