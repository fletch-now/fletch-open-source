# MCP server and local model gateway

These are separate components. MCP exposes registry API tools to clients. The gateway keeps a user's model-provider key on their machine and relays model requests for builds.

## Run MCP against your own instance

```bash
npm ci --prefix packages/fletch-mcp
FLETCH_API_URL=https://builder.example.com node packages/fletch-mcp/index.mjs
```

The process speaks MCP over stdio. Configure it in an MCP client with an absolute path to `index.mjs`:

```json
{
  "mcpServers": {
    "my-builder-registry": {
      "command": "node",
      "args": ["/opt/fletch/packages/fletch-mcp/index.mjs"],
      "env": { "FLETCH_API_URL": "https://builder.example.com" }
    }
  }
}
```

Without that environment override the package defaults to the hosted Fletch API. Registry reads need no API key. The optional `FLETCH_API_KEY` is used for the account webhook-list tool and requires HTTPS. Keep it in a client secret store, not a committed MCP JSON file. The client refuses redirects for authenticated requests.

The current tools cover Robinhood registry/market observations, asset data, chain health, events and account webhook listing. They do not create a project, execute arbitrary commands or deploy a contract. Read the [package README](../packages/fletch-mcp/README.md) for tool names, data freshness and pagination behavior.

## Add an MCP tool

Extend `packages/fletch-mcp/index.mjs` with a bounded input schema, a specific API route and truthful tool annotations. Keep authentication enforcement in the server route. Return source age, pagination and unavailable-state information rather than guessing missing data. Add an SDK-client test against a local API fixture; never require production credentials for CI.

A future build/publish tool must use the platform's authenticated owner, budget and execution-selection rules. Mutating tools need appropriate annotations, idempotency, cancellation and explicit policy for deployment/publication; do not wrap an unrestricted shell or expose the signer through MCP.

## Pair the model gateway

No dependency installation is needed for the gateway:

```bash
cd packages/fletch-gateway
node gateway.mjs pair --server https://builder.example.com
node gateway.mjs run
```

Create a pairing in the instance's Settings first. Supply its single-use pairing token at the terminal prompt. Configure the selected provider's key in the gateway process environment through your local secret manager, then select that gateway in the builder. The gateway asks for approval of the build ID and enforces request/time/output limits.

Provider keys stay in the local process; Fletch still receives prompts and outputs. The saved connection capability under `~/.fletch-gateway/connection.json` is sensitive even though it contains no provider key. Revoke the connection in Settings if lost. See the [gateway README](../packages/fletch-gateway/README.md) for limits, packaging and cancellation behavior.
