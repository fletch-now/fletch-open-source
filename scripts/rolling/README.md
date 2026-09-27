# Rolling web releases

Compile the website on the build server. The hosting server runs the finished
artifact, Registry, Watch and the build coordinator. User build workers and their
workspaces are independent of a web release. Keep the configured build ceiling
at 50 until the owner authorizes capacity work.

1. Export an exact Git commit to a fresh directory under
   `/opt/fletch/web-releases/` on the build server. Remove the archive's
   `.env.example`; no environment file belongs in the release source. Give the
   `fletch` user ownership of that directory.
2. On the hosting server, run
   `node scripts/rolling/export-web-build-config.mjs --output=/root/web-build-config.json`.
   Transfer that private file to the build server. It contains public build
   settings and the current Server Action encryption key. Do not copy the
   production environment file.
3. Run `compile-web.mjs` as host root under a transient systemd service with
   `MemoryMax=8G` and `CPUQuota=300%`. Supply `--id`, `--root`, `--port`, the full
   `--commit` and `--config=/root/web-build-config.json`. The script runs compilation
   as `fletch`, checks the standalone output and its Swagger assets, and writes
   `release-ready.json`. `--retry` can reuse a failed compilation; a completed
   artifact cannot be rebuilt in place.
4. Transfer the exact source and finished `.next` directory to the same release
   path on the hosting server. Include `release-ready.json`; exclude the root
   development `node_modules` and build cache. Compare archive SHA-256 hashes.
   The servers' existing private WireGuard link supports direct transfer. If
   using their shared private filesystem, restrict the transfer directory to
   mode 0700 and the archive to 0600, then remove it after extraction.
5. Apply any backwards-compatible migration before switching traffic. New tables
   must receive the required runtime-role privileges. For migration 0070, the
   web role requires SELECT and INSERT on `app_listing_slugs`, in addition to its
   existing listing/project permissions.
6. Start the candidate on its unused localhost port using `releaseUnit()` from
   `web-config.mjs`. Check health, relevant APIs and browser flows before changing
   nginx. Tests must not trigger customer builds or edit customer listings.
7. Run `web-deploy.mjs --id=... --root=... --port=...` for preflight, then use the
   same command with `--apply=yes` to switch traffic. It preserves old assets,
   existing web clients and independent build workers, and records the rollout.
8. Check the public site and protected worker process identities. Remove private
   build-config copies and transfer artifacts. An unused candidate can be removed
   only after confirming that no current/retained release or running unit uses it.

`prepare-web.mjs` remains available for a hosting-side compilation, but refuses to
start with less than 8 GiB available memory. Prefer the separate build server.
A bounded policy for retiring old web processes is still required; keeping all
past releases running consumes hosting memory even when builds are offloaded.
