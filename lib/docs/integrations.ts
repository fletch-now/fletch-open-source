import { APP_URL } from "@/lib/config";
import { WATCH_LIMITS } from "@/lib/watch/types";
import type { DocPage } from "./content";

export const mcpDocPage: DocPage = {
  slug: "mcp",
  title: "MCP server",
  description: "Give an agent registry tools over Fletch's public API. Registry reads need no key.",
  next: "quickstart-build",
  sections: [
    {
      title: "Run it",
      paragraphs: [
        "Run the MCP server from its public GitHub repository with Node 22.18 or later. The npm package remains unpublished; use the GitHub command below.",
      ],
      code: `npx -y github:fletch-now/fletch-mcp`,
      links: [{ href: "https://github.com/fletch-now/fletch-mcp", label: "MCP source and setup instructions" }],
    },
    {
      title: "Point a client at it",
      paragraphs: [
        "For an MCP client that accepts a local stdio server, add this entry to its server configuration. Check the client's documentation for the configuration file location. Claude Desktop, Claude Code and Cursor support this setup.",
      ],
      code: `{
  "mcpServers": {
    "fletch": {
      "command": "npx",
      "args": ["-y", "github:fletch-now/fletch-mcp"]
    }
  }
}`,
    },
    {
      title: "What an agent should ask first",
      paragraphs: [
        "Ask for status before using a figure. The status tool reports job timeliness and coverage; inspect the observation timestamp on the particular data you use. A job running on time can still have incomplete history or an old token reading.",
        "Use search_contracts to find recorded tokens by address, ticker, name or supported identifier. Use filter_catalog for current Markets filters and token_markets for one 25- or 50-row token page. Results retain trust verdicts and metric sources.",
        "Registry tools return the API's recorded data. Preserve null values, trust verdicts and coverage notes. Event times and account records have their own meanings; an answer does not always carry a fresh chain-reading timestamp.",
      ],
      links: [
        { href: "/llms.txt", label: "Short agent instructions" },
        { href: "/llms-full.txt", label: "Complete documentation for agents" },
        { href: "/docs/registry-reading", label: "Observation times and job coverage" },
      ],
    },
    {
      title: "Account access and tool scope",
      paragraphs: [
        "Registry reads use the public API without a key. The webhooks tool lists your own registered endpoints and requires FLETCH_API_KEY with watchers:read. Keep that key in the MCP process and use a trusted HTTPS API address. FLETCH_API_URL defaults to https://fletch.now.",
        "The server provides registry reads and webhook listing. Build submission and package approvals use the signed-in dashboard. Deployment, wallet signing and watcher creation use their own interfaces. Inspect the repository's current tool schemas when configuring an agent.",
      ],
      links: [{ href: "/docs/api", label: "API authentication and routes" }],
    },
  ],
};

export const webhooksDocPage: DocPage = {
  slug: "webhooks",
  title: "Webhooks",
  description: "Send Watch alerts to your server, verify their signatures and handle repeat delivery safely.",
  next: "mcp",
  sections: [
    {
      title: "Register an endpoint",
      paragraphs: [
        "A watcher can deliver to your own server instead of Telegram. Register an HTTPS endpoint with an API key that has watchers:write. The response includes the signing secret once. Save it securely; later reads omit it, and rotation issues a new secret.",
        "Then create a watcher with webhookId set to the returned endpoint ID, or update an existing watcher with PATCH /api/v1/watchers/{id}. Setting webhookId to null sends that watcher back to Telegram.",
      ],
      code: `curl -X POST ${APP_URL}/api/v1/webhooks \\
  -H "Authorization: Bearer flk_…" \\
  -H "content-type: application/json" \\
  -d '{"name":"prod","url":"https://example.com/fletch"}'`,
      links: [{ href: "/docs/api", label: "Webhook and watcher API reference" }],
    },
    {
      title: "Verify the signature",
      paragraphs: [
        'Each POST carries X-Fletch-Signature: t=<unix>,v1=<hex>. The hex is an HMAC-SHA256 of "<t>.<body>" using your endpoint secret. Verify the original request body before parsing or changing it, compare in constant time and reject timestamps outside your tolerance. The example allows five minutes.',
        "A valid signature establishes that the body was signed with the shared secret. Keep the secret private and deduplicate the delivery ID after verification.",
      ],
      table: {
        headings: ["Header", "Value"],
        rows: [
          ["Content-Type", "application/json"],
          ["User-Agent", "fletch-webhooks/1"],
          ["X-Fletch-Event", "The envelope's kind."],
          ["X-Fletch-Delivery", "The stable envelope id."],
          ["X-Fletch-Signature", "t=<unix seconds>,v1=<hex HMAC-SHA256>"],
        ],
      },
      code: `import crypto from "node:crypto";

function verify(rawBody, header, secret) {
  const match = /^t=(\\d+),v1=([a-f0-9]{64})$/.exec(header ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(\`\${match[1]}.\${rawBody}\`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}`,
    },
    {
      title: "Retries and duplicates",
      paragraphs: [
        `An HTTP 2xx response marks an alert as sent. Failed requests retry with randomized exponential backoff up to ${WATCH_LIMITS.maxDeliveryAttempts} attempts, then the delivery is marked failed. Each request times out after ${WATCH_LIMITS.webhookTimeoutMs / 1000} seconds. Redirects are not followed. A valid Retry-After header delays the next attempt, up to 24 hours. Endpoint hostnames are resolved and checked on each connection; private and reserved addresses are refused.`,
        "The JSON envelope contains id, kind, payload, watcher, queuedAt, attempt and sentAt. Use the stable id to deduplicate, recording it in the same transaction as the alert's effect. queuedAt is when Fletch recorded the match; sentAt is when this attempt was posted, and attempt starts at 1. These attempt fields can change while the delivery ID stays the same.",
      ],
    },
    {
      title: "Check delivery",
      paragraphs: [
        "Send a test from Settings or POST /api/v1/webhooks/{id}/test. It sends a signed ping immediately, with watcher set to null, and does not use the retry outbox. A successful ping confirms the endpoint returned HTTP 2xx. Check your receiver logs to confirm signature verification. A matching watcher event and its sent delivery record confirm alert acknowledgement.",
        "Settings shows assigned watchers, connection tests and watcher alert attempts separately. The API exposes lastTestAt, lastTestStatus and lastTestError alongside lastAlertAt, lastAlertStatus and lastAlertError. Older combined history remains in lastDeliveredAt; it includes both tests and alerts. Separate history is recorded from this release onward.",
        "Create a watcher from its endpoint in Settings, or open an existing watcher and save its notification channel. Changing to a new webhook also queues held matches from the last 24 hours. Queued notifications follow the selected channel; requests already in progress may complete at the previous endpoint.",
        "Disabling an endpoint pauses its running watchers and keeps queued notifications pending without using retry attempts. Enabling resumes only watchers paused by that endpoint. Deleting an endpoint pauses assigned watchers and marks queued notifications failed. Choose another channel before resuming those watchers.",
        "Watch currently sends its supported transfer, registry, token, Robinhood app status and new-pool events. General ABI-decoded custom logs and native Slack/Discord routing remain planned.",
      ],
      links: [
        { href: "/dashboard/settings", label: "Manage endpoints in Settings" },
        { href: "/dashboard/alerts", label: "Inspect delivery records" },
        { href: "/docs/roadmap", label: "Planned alert integrations" },
      ],
    },
  ],
};
