# Fletch user-controlled model gateway

This standalone Node 20.3+ program keeps an OpenAI, Anthropic or Kimi API key in
its own process environment. Fletch receives an outbound relay connection and
model requests/results, never the provider key. The gateway runs no model tools;
Fletch's Docker sandbox continues to execute generated code. Fletch can see your
prompts and outputs. Controlling the gateway machine grants access to its key.

Review these two `.mjs` files on your own machine before running them. The source download has a published SHA256 checksum and deterministic packaging. A signed binary/release and OS-keychain integration have not been delivered.

Download `/downloads/fletch-gateway.tar.gz` and the adjacent `.sha256` file from
your Fletch host, verify the checksum, extract the archive and `cd fletch-gateway`.
A checksum served by the same host checks download integrity; it does not establish
an independent publisher signature. No dependency installation is required.

1. In Fletch Settings create a gateway pairing for a specific provider/model.
2. Run `node gateway.mjs pair --server https://your-fletch.example`.
   Paste the single-use token when asked. It expires after ten minutes.
3. Supply `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `MOONSHOT_API_KEY` in the local
   process environment through your secret manager. Never paste the API key into
   Fletch or a pairing form. Avoid shell history when setting secrets.
4. Run `node gateway.mjs run`, select the paired gateway in
   Fletch's builder, and submit a build. Confirm the full build ID in the local
   terminal. The prompt shows project, provider, model and spend bounds.

Local approval permits at most 60 model requests, 16,384 output tokens per request
and 30 minutes; provider usage is billed. Fletch's independent build limits also
apply. URLs, headers, model IDs, remote tools and output limits cannot be expanded
by a model response. Ctrl+C stops local calls and discards approvals. Revoking the
gateway in Settings blocks later relay traffic and build leases. A provider call
already accepted upstream may still be billed when cancelled or revoked.

The connection capability is saved under `~/.fletch-gateway/connection.json` with
mode 0600, without the API key. Re-pair after losing/revoking it. Removing a local
file alone does not revoke the server connection; also revoke it in Settings.
The relay removes prompt/output payloads after a request finishes; ordinary saved
build prompts, generated files and logs remain subject to Fletch retention.
Disconnects/timeouts fail the bound build without charging platform credits;
reconnect and explicitly submit a follow-up to retry. Automatic continuation of
an interrupted model call is not implemented.
