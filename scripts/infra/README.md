# Infrastructure templates

These scripts describe a Linux control host and separate Docker executor. They are templates to review and configure, not a one-command provisioning system. The example private network is `10.77.0.0/30`; choose and consistently substitute an unused private subnet for your installation.

Machine identities are intentionally absent. Scripts that check `/etc/machine-id` require an explicit expected value through `--machine-id`, a documented positional argument, or `FLETCH_CONTROL_MACHINE_ID` for the remote acceptance test. Obtain and verify that identity on your own host through a trusted session. Do not remove these target checks. Keep identity values, SSH/WireGuard material and executor fingerprints in private operations configuration outside Git.

`offload.env.example` leaves `FORGE_EXECUTOR_HOST_ID` blank. Fill it with your executor's verified SHA256 identity using the protocol implemented by `executor-inspect.py` and `lib/build/executor.ts`. Generate fresh SSH/WireGuard keys. Review forced commands, shared-workspace ownership, firewall rules, model-proxy ports, resource caps and service paths before installing anything.

Host benchmarks are synthetic, can consume significant resources and must run on an idle disposable executor. They require the expected machine ID and your agent image. Shared-workspace benchmarks resolve the local `fletch` service account instead of assuming numeric user IDs. The remote acceptance test contains sample capacity assertions; adapt them to your reviewed resource limits.

Follow [server operations](../../docs/operations/servers.md) and [publishing](../../docs/operations/publishing.md) for the complete topology. Do not run provisioning or acceptance scripts on an existing service merely to check that they parse.
