import { STARTER_CREDITS } from "@/lib/config";
import { BUILD_WATCH_NETWORK_DESCRIPTION, CHECKOUT_DESCRIPTION } from "@/lib/product-terms";
import { WATCH_LIMITS } from "@/lib/watch/types";
import { buildDocPage } from "./build";
import { overviewDocPage, whyDocPage, conceptDocPages } from "./concepts";
import { registryReadingSections } from "./registry-jobs";
import { roadmapDocPage } from "./roadmap";
import { mcpDocPage, webhooksDocPage } from "./integrations";
import type { DocDiagramId } from "./diagrams";

export interface DocSection {
  title: string;
  diagram?: DocDiagramId;
  paragraphs?: readonly string[];
  steps?: readonly string[];
  bullets?: readonly string[];
  code?: string;
  table?: { headings: readonly string[]; rows: readonly (readonly string[])[] };
  links?: readonly { href: string; label: string }[];
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  sections: readonly DocSection[];
  next: string;
  supplemental?: boolean;
}

// Updated by the production verification pass, never by the render clock.
export const DOCS_VERIFIED_AT = "2026-09-14";
export const TOKEN_EXAMPLE = "0x6bac06600d220ac5ac281ad1f504d2cf0f90f6e6";

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: "quickstart-build",
    title: "Quickstart: build an app",
    next: "quickstart-watch",
    description:
      "Describe the app, inspect its build results and open the recorded publication link.",
    sections: [
      {
        title: "Build your first app",
        steps: [
          "The homepage Ship action opens your prompt in Build for review. It does not start a build. On mobile, use your wallet app's browser if Safari or Chrome has no wallet connection. Verified new addresses receive one starter build credit.",
          "Open Dashboard → Build, connect your wallet and choose New app. Describe what users can do, what belongs on chain and what the page should show.",
          "Attach a long specification with the paperclip. Long pasted briefs become text files with a visible attachment chip. The planner receives attached text before it decides whether the app needs contracts or a wallet. Add a short instruction such as 'Use the attached brief.'",
          "Choose Platform model or a saved model connection. Read the cost on the Build button and send. Enter sends; Shift+Enter inserts a newline. While Enhance is running, wait for it to finish before submitting.",
          "If the execution slots are occupied, the reply shows your queue position, the number running and any slots reserved for recovery. Cancel removes a queued run. Edit restores its prompt, files and model selection to the composer. Once it starts, Build details streams the recorded steps.",
          "Review the saved preview and toolchain results. Click Publish live app when you want to host it. Publication uses the saved bundle without another model call or build credit. Open the confirmed live URL and test the app on the stated network.",
        ],
        code: "A raffle where anyone buys tickets with ETH, the owner draws a winner after a block deadline, and the winner claims the pot.",
        links: [{ href: "/dashboard/build", label: "Open Build" }],
      },
      {
        title: "Add your app to the public directory",
        paragraphs: [
          "Hosting and directory visibility are separate. After publishing, open the project's Manage directory listing section. Write a name, short description and introduction, choose a recorded project token if relevant, and explicitly submit it for review. Only approved submissions appear in Published apps.",
          "Owners can withdraw a listing while keeping its app hosted. Editing a listing or publishing a new build requires renewed review. Token details show the contract, network, observation block and check time; source verification is a separate recorded result.",
        ],
        links: [{ href: "/apps", label: "Publication guide" }, { href: "/published", label: "Browse published apps" }],
      },
      {
        title: "Allow time and check the build results",
        paragraphs: [
          "Contract builds require successful compilation, executable passing tests and completed security analysis before deployment. A successful new build also needs a built frontend saved as a preview. Public hosting starts when its owner clicks Publish live app. Each stage takes time and produces its own recorded result. Open the reports and live link, then check the app's required interactions. The compiler verdict stays visible even when the model's reply is shorter.",
          "Describe the style you want or attach a reference. New projects receive a purpose-based starting palette and layout; your explicit style takes precedence. The agent records its choices in DESIGN.md and preserves the existing design through edits unless you request a redesign.",
          "Closing the browser leaves the server-owned build running. Reopen the project to reconnect to its stored progress. A failed charged build receives its Fletch credit refund; provider charges for own-key usage follow the provider's billing. Read the current execution limits before starting a large specification.",
        ],
        links: [
          {
            href: "/docs/limits",
            label: "Credits, time limits and current availability",
          },
        ],
      },
    ],
  },
  {
    slug: "quickstart-watch",
    title: "Quickstart: watch a token",
    next: "quickstart-api",
    description:
      "Connect a wallet, choose a condition, link Telegram and check the first matching event.",
    sections: [
      {
        title: "Create your first watcher",
        steps: [
          "Open Dashboard → Watch and connect your wallet. Sign the sign-in message, then choose New watcher.",
          "Choose Large transfers for a token-wide amount threshold, or Wallet activity to follow a particular sender or recipient. Use Listed asset to select a listing, or Any token address to paste a full contract address. The address lookup shows the recorded trust verdict before you submit.",
          "Enter the amount in the token's own units. Large transfers needs a positive threshold. Wallet activity also needs a wallet address and accepts 0 to match every transfer involving that wallet. Give the watcher a name and choose Create watcher.",
          "Open Dashboard → Settings → Telegram alerts. Under the Fletch bot option, open the link and press Start in Telegram. Return to Settings and confirm it shows linked. For your own bot, paste the BotFather token, save it, press Start in that bot and use the Find my chat control.",
          "Return to Watch and leave the watcher enabled. After a new transfer meets the condition, open Dashboard → Alerts and inspect its status and transaction link. A sent delivery should also appear in your linked Telegram chat. An empty history means no matching event has been recorded yet.",
        ],
        links: [
          { href: "/dashboard/watch/new", label: "Create a watcher" },
          { href: "/dashboard/settings", label: "Link Telegram in Settings" },
          { href: "/dashboard/alerts", label: "Inspect alert deliveries" },
        ],
      },
      {
        title: "Before you leave the tab",
        paragraphs: [
          `Watch is free during beta, with ${WATCH_LIMITS.watchersPerUser} watchers per account. The first Telegram watcher can be saved before you link a chat; additional Telegram watchers require the link. Match records can be held while delivery has no destination. A saved watcher and a linked chat are separate states.`,
          "A failed bytecode or decimals check asks you to confirm Watch anyway. This records your acknowledgement; it cannot make an unreadable contract emit ERC-20 transfer events. For a first alert, choose a token and condition with activity you can independently inspect.",
          "If delivery does not arrive, check the linked chat, watcher status, Alerts and the registry status page. A matching transaction and a delivered message are the end-to-end check.",
        ],
        links: [
          { href: "/registry/status", label: "Check the daemon and data jobs" },
        ],
      },
    ],
  },
  {
    slug: "quickstart-api",
    title: "Quickstart: use the API",
    next: "",
    description:
      "One request returns a token's recorded trust verdict, metadata and observation time.",
    sections: [
      {
        title: "Create a scoped key",
        steps: [
          "Sign in, open Dashboard → Settings → API keys and name a key. Choose Read the registry (registry:read) for this example, then Create key.",
          "Copy the key when it is shown. Keep it in your local environment as FLETCH_API_KEY. This is a Fletch API credential; model provider keys belong in the separate model connection form.",
          "Run the request below. Inspect trust, source, address, symbol and readAt. Use impersonates when the verdict is lookalike. Use the complete address as the identity.",
        ],
        code: `curl --fail-with-body --silent --show-error \\
  -H "Authorization: Bearer $FLETCH_API_KEY" \\
  https://fletch.now/api/v1/tokens/${TOKEN_EXAMPLE}`,
        links: [
          { href: "/dashboard/settings", label: "Create a key in Settings" },
        ],
      },
      {
        title: "Read the response",
        paragraphs: [
          "The response is JSON. trust is verified, listed, lookalike, community or unknown. readAt is the observation time, source names the registry or discovered record, and null means a fact is unavailable. market may be null even when the token is known.",
          "Public registry reads also work without the Authorization header. A valid key without registry:read uses the anonymous allowance for these public reads. Account operations require the scope named by their OpenAPI entry: missing or invalid authentication returns 401, and a missing required scope returns 403. A 429 indicates a rate limit. Honor Retry-After before retrying.",
        ],
        code: "curl --fail-with-body --silent --show-error https://fletch.now/api/v1/status",
        links: [
          {
            href: "/docs/api",
            label: "Every endpoint, parameter and response schema",
          },
          { href: "/docs/agents", label: "Caching and agent integration" },
        ],
      },
    ],
  },
  overviewDocPage,
  whyDocPage,
  buildDocPage,
  {
    slug: "watch",
    title: "Watch",
    next: "markets",
    description:
      "Token conditions, chain events, delivery channels and the daemon that keeps checking them.",
    sections: [
      {
        title: "Choose the event",
        table: {
          headings: ["Kind", "What matches"],
          rows: [
            [
              "large_transfer",
              "ERC-20 transfers at or above a positive amount in the token's units.",
            ],
            [
              "wallet_activity",
              "ERC-20 transfers sent or received by one wallet; threshold 0 includes every matching transfer.",
            ],
            [
              "token_event",
              "Recorded authority events for a listed token, including pauses, halts, multiplier changes and feed or supply observations.",
            ],
            [
              "registry_event",
              "Recorded issuer-registry and chain events, including upgrades, blocked addresses and listings.",
            ],
            [
              "new_pool",
              "Newly discovered pools after their state has been read; optionally only tokens that collide with a verified asset.",
            ],
          ],
        },
      },
      {
        title: "Targets and controls",
        paragraphs: [
          "Transfer watchers accept a listed asset or a pasted mainnet token address. An unlisted address is checked for bytecode and readable decimals. If that check fails, an explicit Watch anyway confirmation is recorded on the watcher. Token-event watchers require a registry asset. Registry-event and new-pool watchers have chain-wide targets.",
          "In Watch, use Pause, Resume or Delete. To change the condition, create a replacement watcher and remove the old one when appropriate. The API can change an existing watcher's enabled state or delivery endpoint. A threshold is a token amount, so use its decimals and units rather than interpreting the amount as dollars.",
          `An account can have ${WATCH_LIMITS.watchersPerUser} watchers, including at most ${WATCH_LIMITS.newPoolWatchersPerUser} new-pool watcher. Platform capacity is ${WATCH_LIMITS.watchersPlatform}. A new-pool matcher handles up to ${WATCH_LIMITS.newPoolsPerRun} pools per watcher per run.`,
        ],
      },
      {
        title: "Telegram and your own endpoint",
        paragraphs: [
          "Settings offers the configured Fletch bot and your own Telegram bot. For the Fletch bot, use the account-linking URL and press Start. For your own bot, create it with BotFather, save its token, press Start and find your chat from Settings. The linked destination is shown before you rely on delivery.",
          "The first Telegram watcher may be saved before linking; further Telegram watchers require a chat. Unlinked matches are held. A registered, enabled webhook can be chosen as a watcher's destination instead. Its signed JSON delivery uses the same outbox and retry process.",
        ],
        links: [
          { href: "/docs/webhooks", label: "Signed webhooks and retries" },
        ],
      },
      {
        title: "Trust in the message",
        paragraphs: [
          "Token transfer and new-pool payloads carry a trust stamp when the alert is formed. A lookalike warning includes the verified address it matches. Authority alerts carry the recorded issuer event and its registry link. Historical payloads created before trust stamps existed may have no stamp.",
          "Follow the transaction and provenance links to inspect the observed contract and the evidence behind its trust stamp.",
        ],
        links: [{ href: "/docs/trust", label: "What each trust level means" }],
      },
      {
        title: "Heartbeat, lag and delivery",
        diagram: "watch",
        paragraphs: [
          `The transfer poll loop runs every ${WATCH_LIMITS.pollIntervalMs / 1000} seconds and the delivery loop every ${WATCH_LIMITS.deliverIntervalMs / 1000} seconds. These are scheduling intervals; RPC work, backlogs and retries affect delivery time. The daily RPC ceiling is ${WATCH_LIMITS.rpcCallsPerDay.toLocaleString("en-US")}.`,
          "Active means the watcher is near its last observed head. Catching up means its checkpoint is behind. Degraded means a read or delivery dependency needs attention. A beating daemon proves the process is reporting; inspect individual jobs and checkpoints to judge coverage.",
          `Delivery records can be held, pending, sent, failed or retracted. Transient failures retry with backoff for up to ${WATCH_LIMITS.maxDeliveryAttempts} attempts. Events are sequencer-confirmed and can be affected by a reorganization. The recorded block hash and transaction identify the observation.`,
        ],
        links: [
          {
            href: "/registry/status",
            label: "Inspect current jobs and coverage",
          },
          { href: "/dashboard/alerts", label: "Inspect your deliveries" },
        ],
      },
    ],
  },
  {
    slug: "markets",
    title: "Registry & Markets",
    next: "registry-reading",
    description:
      "Find the right contract, compare recorded pool facts and understand freshness and coverage.",
    sections: [
      {
        title: "Listings and discovery",
        paragraphs: [
          "The Registry follows Robinhood's published asset list and preserves when each listing was first seen. Bytecode and metadata checks establish whether the contract matches the listing. Discovered tokens are stored separately; a factory event or user-submitted address does not create an issuer listing.",
          "DEX discovery reads events from recorded Uniswap deployments. Metadata comes from token contract calls. Pool state, swaps, holders and transfer history are separate indexing jobs with separate coverage. Discovery of a pool can precede a usable price or complete activity window.",
        ],
        links: [
          { href: "/registry", label: "Browse issuer listings" },
          { href: "/registry/markets", label: "Compare tokens" },
        ],
      },
      {
        title: "Search and compare",
        paragraphs: [
          "Markets opens with tracked tokens, one contract per row. Search accepts a ticker with an optional $, words in a name in any order, recorded on-chain aliases, an ISIN, a full or shortened address, a chain-qualified address, or a token link. V3 pool addresses and V4 pool IDs find their recorded token currencies.",
          "Matching contracts searches active registry asset records, visible contract metadata, lookalike observations and explorer candidates, including contracts outside tracked markets. Each result shows its source, observation age and identity verdict. Similar names are labelled when a literal text search has no match. Check the full address before selecting a contract.",
          "Contract results have their own ten-row pages. Market filters apply to the market table, which starts with 25 rows and offers 50 per page. Open a matching contract to inspect it, or choose Check market readings to request its recorded market data. Missing metadata and market readings stay unavailable. An empty search does not establish that a contract does not exist.",
          "Volume sorts measured selected-pool 24-hour volume, with missing observations last. It never substitutes depth. A token with several pools has one selected pool in this view; its volume is scoped to that pool. Pool-level Traction is a separately named order that includes depth and swap activity.",
          "Market shortcuts select community trading, at least 100 daily swaps, current price/volume/cap inputs, or recorded same-name alternatives. More filters combines activity, data availability, identity comparisons, separate V3/V4 depth thresholds and a minimum USD volume. Quiet means a complete current window with zero swaps. Missing observations fail numeric filters, even a minimum of zero.",
          "Sort by price, volume, swap count, market cap estimate, pool count, V3 quote holdings, V4 1% depth or name. Each numeric sort uses its named measure with unavailable values last. Sorting or filtering on swaps and depth adds that measure to the table. Copy This table as JSON to retain your filters; the filter catalog publishes the same choices and presets for apps and agents.",
          "A stale or unread search result and a token-page view can queue a bounded refresh. This work is rate limited and shares a small worker budget. A page request can therefore return its existing recorded state while the refresh waits.",
          "Developers can call /api/v1/chains/4663/search with q, page and limit. Pages run from 1 to 99999; limit is 10, 20 or 50. The normalized query is limited to 128 characters. Search responses support ETag and a fifteen-second cache. Markets JSON adds contractSearch and its separate searchPage parameter. contractSearchError reports an unavailable search while existing market readings remain accessible.",
        ],
        links: [
          { href: "/api/v1/chains/4663/search?q=NVDA&limit=10", label: "Contract search JSON" },
          { href: "/developers", label: "API reference" },
        ],
      },
      {
        title: "Tiers and coverage",
        table: {
          headings: ["Tier or reading", "How to use it"],
          rows: [
            [
              "Active",
              "The priority universe selects recorded major contracts and issuer listings. Background state and swap work focuses on their selected pools. An active catalog label alone does not establish current coverage.",
            ],
            [
              "Quiet",
              "Lower-activity catalog pools retain existing observations. Complete rolling swap history is concentrated on the priority set.",
            ],
            [
              "Dormant",
              "Individual state and metadata reads are demand-driven. A stored pool can remain unread until needed.",
            ],
            [
              "Live tail",
              "Counts recent canonical swap logs. Its newest block and lag describe how close the indexer is to the observed head.",
            ],
            [
              "Historical coverage",
              "Records which block ranges were counted for a pool. A complete rolling window requires the entire interval, not just a recent swap.",
            ],
          ],
        },
        paragraphs: [
          "The status panel reports newest counted block, lag, pool enrollment and complete windows per tier. Today's newest counted block alone does not prove every pool has 24 hours of history. Separate tail and backfill jobs keep those claims distinct.",
        ],
      },
      {
        title: "Read the numbers",
        paragraphs: [
          "DEX price is derived from pool state. Feed price is a separate reading from a recorded feed. Depth semantics depend on the pool: v3 uses observed quote-side holdings, while v4 uses a bounded estimate where per-pool reserves are unavailable. Read the field's label and API description.",
          "Token and pool tables use the same three-minute expiry for pool state. Selected pools are sampled on a 45-second schedule. Supply and burn balances become due after three minutes and expire after five. Derived market value expires when its first required input expires. Invalid or future observation times fail the freshness check. Exact rolling swap and transaction counts require complete canonical coverage and a current metrics reading.",
          "USDG swap volume sums the absolute quote leg and uses nominal denomination at 1 USDG = $1. WETH swap volume uses a historical oracle estimate from the recorded feed; the archive sample is at most one hour old and the oracle answer must remain within the feed's published heartbeat. Each value carries its method. Unsupported historical quotes stay unavailable.",
          "Holder counts and concentration are temporarily hidden on Registry pages. Their API fields and background readers remain available. API holder metrics name their source and observation time. A complete chain snapshot scans token Transfer history, reads balanceOf at one pinned block and checks the sum against totalSupply. Robinscan counts come from the labeled holder total on the exact contract's public token page. Their time is when Fletch fetched the page; Robinscan does not publish the index snapshot time. Current API explorer counts retain their own source and fetch time. Partial transfer scans remain coverage records.",
          "A missing USD volume, market value, change percentage or feed premium stays a dash. A readable token name does not supply those measurements. Inspect each API metric's observation: sourceAt, fetchedAt, expiresAt, readStatus, inputs and coverage. Selection records its time and policy separately. Open Registry pages request a new reading every 30 seconds while visible.",
          "For a community token with readable supply, decimals, burn balances and a usable pool price, market capitalization uses total supply minus balances at the zero and dead addresses, multiplied by that price. This is an upper bound on circulating value: other locked or inactive balances may still be included. FDV uses the full supply. The API exposes burnedRaw and marketCapUsd; missing inputs or burns exceeding total supply leave marketCapUsd null. A confirmed zero outstanding supply renders zero.",
        ],
      },
      {
        title: "The token page",
        paragraphs: [
          "Listed token pages show the contract, issuer listing, available on-chain state, feed readings, pools and historical sections. Stock Tokens retain the issuer's multiplier semantics; apply conversions according to the field description. Bridged-asset pages may show origin and escrow reconciliation when those reads exist.",
          "Transfer history has its own ledger checkpoints. Holder and concentration panels are currently hidden. First seen is the first recorded observation, while checked-at timestamps describe later reads. Discovered tokens use address routes so a ticker collision cannot claim a listed token's symbol URL.",
        ],
        links: [
          {
            href: "/registry/changes",
            label: "Recorded changes and event feeds",
          },
          { href: "/docs/limits", label: "Coverage still being completed" },
        ],
      },
    ],
  },
  {
    slug: "registry-reading",
    title: "How the registry reads the chain",
    description: "The source, contract call, schedule and coverage behind each recorded observation.",
    sections: registryReadingSections,
    next: "trust",
  },
  {
    slug: "trust",
    title: "Trust levels",
    next: "truth-oracle",
    description:
      "A provenance verdict identifies the evidence behind a token's identity. It is not an endorsement or a security audit.",
    sections: [
      {
        title: "The current vocabulary",
        diagram: "trust",
        table: {
          headings: ["Verdict", "Evidence", "How to interpret it"],
          rows: [
            [
              "verified",
              "Robinhood lists the address; bytecode was found and the contract's symbol and decimals match the listing.",
              "The recorded contract matches that issuer listing. Read the asset type to distinguish Stock Tokens, stablecoins and bridged assets.",
            ],
            [
              "listed",
              "The address is on Robinhood's list, with confirmation incomplete or a contract metadata mismatch.",
              "The listing is known; inspect the contract observations before treating it as confirmed.",
            ],
            [
              "lookalike",
              "A non-listed token's normalized symbol or name collides with a verified asset, or the recorded lookalike scan supplies matching evidence.",
              "Compare the included verified address. The collision describes identity evidence, not the deployer's intent.",
            ],
            [
              "community",
              "A discovered contract has bytecode plus readable name, symbol and decimals, with no recorded verified-asset collision.",
              "The metadata is the contract's own claim. It remains unverified by the issuer registry.",
            ],
            [
              "unknown",
              "The address is unresolved, or bytecode and complete metadata could not be confirmed.",
              "Missing fields remain empty. Retry after a successful refresh or inspect the contract directly.",
            ],
          ],
        },
      },
      {
        title: "How normalization works",
        paragraphs: [
          "The shared trust rules case-fold names and symbols, remove whitespace, invisible marks and accents, and map common Cyrillic and Greek lookalikes. They fold l/L/I/1 together and O/0 together. For example, Cyrillic Т and Greek Τ compare with Latin T. Normalization tests cover these collisions.",
          "The lookalike scan records beacon dependencies, which cannot establish who deployed a contract. Matching beacons and historical unlisted-stock classifications remain collision evidence. Verified identity requires the official listing and matching contract metadata. Local normalization checks continue when explorer access fails.",
        ],
      },
      {
        title: "Resolve a contract",
        code: `curl --fail-with-body https://fletch.now/api/v1/tokens/${TOKEN_EXAMPLE}`,
        paragraphs: [
          "The response carries trust, label, detail, source, metadata and readAt. A lookalike also carries impersonates with the verified symbol and address. Address reads may queue a bounded metadata or pool refresh and return the current stored result immediately.",
          "Bridge reconciliation is recorded separately on relevant asset pages. Current public trust responses use the five values above. Consult the limits page for planned additions to this vocabulary.",
        ],
        links: [
          { href: "/docs/api", label: "Generated token response contract" },
        ],
      },
    ],
  },
  ...conceptDocPages,
  {
    slug: "agents",
    title: "For agents",
    next: "api",
    description:
      "Fetch relevant chain facts on demand and preserve their provenance, timestamp and coverage.",
    sections: [
      {
        title: "Choose an integration",
        table: {
          headings: ["Interface", "Available capability", "Status and entry point"],
          rows: [
            ["JSON API", "Public registry reads; scoped account operations including builds and watchers.", "Live: /api/v1. Inspect each response's timestamps and coverage."],
            ["OpenAPI", "Endpoint parameters, scopes, request bodies and response schemas.", "Live: /api/v1/openapi.json. The API reference is generated from this document."],
            ["llms.txt and full export", "A compact retrieval guide, plus all manuals, diagram descriptions and the complete API contract.", "Live: /llms.txt and /llms-full.txt. Fetch status separately for current observations."],
            ["MCP", "Read registry facts through a local stdio server configured in an MCP client.", "Available from github.com/fletch-now/fletch-mcp. Run the GitHub command in the MCP guide."],
            ["Signed Watch webhooks", "Send supported watcher events to a registered HTTPS endpoint and verify the signature.", "Implemented in Watch. Use endpoint test delivery, then verify a matching event in Alerts."],
          ],
        },
        links: [{ href: "/docs/api", label: "Generated API reference" }, { href: "/docs/mcp", label: "MCP installation and client setup" }, { href: "/docs/webhooks", label: "Webhook signature and retry guide" }],
      },
      {
        title: "Connect the interface you use",
        links: [
          { href: "/llms.txt", label: "llms.txt: compact integration guide" },
          {
            href: "/llms-full.txt",
            label: "All product docs and complete OpenAPI contract",
          },
          { href: "/skill.md", label: "Fletch integration skill" },
          {
            href: "/developers",
            label: "Developer page with Copy all docs",
          },
          { href: "/docs/mcp", label: "MCP setup" },
          { href: "/docs/all", label: "All documentation on one page" },
          {
            href: "https://github.com/fletch-now",
            label: "Public SDK, MCP and registry data repositories",
          },
        ],
      },
      {
        title: "A small retrieval loop",
        steps: [
          "Read the verdict, jobs, timestamps and checkpoints at /api/v1/status when your task depends on current chain data.",
          "Resolve a known address through /api/v1/tokens/{address}, or narrow a listed-asset lookup by symbol. Search pools only when the task needs market data. Keep only the fields relevant to the user's task.",
          "Carry the chain ID, address, trust verdict and observation times alongside a number. Preserve nulls and partial-coverage markers. Fetch a specific historical endpoint for a historical question.",
          "Honor ETag and If-None-Match. A 304 has no JSON body; reuse the previous representation. Respect Retry-After on 429 and apply bounded backoff. Subscribe to the registry event stream or signed webhooks when they fit the task.",
        ],
      },
      {
        title: "Authentication and precision",
        paragraphs: [
          "Public registry GETs support cross-origin reads. Account operations use a scoped Fletch bearer key and the x-required-scope in OpenAPI. Keep credentials on your server or local process. A registry:read key does not grant watcher writes or build creation.",
          "Raw token quantities and large block values may be decimal strings. Preserve integer precision and use the token's decimals. A price snapshot is valid only within its own observation window. Ask for provenance before turning a matching ticker into an address in generated code.",
        ],
        links: [
          { href: "/docs/webhooks", label: "Receive signed events" },
          {
            href: "/registry/changes",
            label: "Changes, RSS, Atom and SSE links",
          },
        ],
      },
    ],
  },
  {
    slug: "api",
    title: "API reference",
    description:
      "Requests, responses, authentication and schemas generated from the published OpenAPI document.",
    sections: [],
    next: "limits",
  },
  {
    slug: "limits",
    title: "Limits, pricing, and what is not built yet",
    next: "roadmap",
    description:
      "The deployed limits and availability, followed by work that remains planned.",
    sections: [
      {
        title: "Current limits",
        table: {
          headings: ["Area", "Current production behavior"],
          rows: [
            [
              "Initial grant",
              `${STARTER_CREDITS} build credit once per new address, after verified wallet sign-in. Reconnecting or using the address on another chain does not grant another credit. Accounts created before this offer retain their earlier grant rules.`,
            ],
            [
              "Build cost",
              "Standard beta pricing is 1 Fletch credit per platform build; 0 with your own model key. Package pricing is not enabled. Provider API charges still apply.",
            ],
            [
              "Execution",
              "A shared execution limit is shown in the build queue; additional accepted runs wait. Standard beta builds retain the 45-minute agent-turn limit. Package builds also enforce their approved request, tool and active-time allowances.",
            ],
            [
              "Prompt",
              "24,000 characters; five text files, 64 KiB each and 128 KiB total.",
            ],
            [
              "Images",
              "PNG/JPEG with a vision-capable selected model: three images, 2 MiB each, 4 MiB total, 4096px per side, 16 megapixels.",
            ],
            [
              "Watch",
              `${WATCH_LIMITS.watchersPerUser} watchers per account, ${WATCH_LIMITS.newPoolWatchersPerUser} new-pool watcher, ${WATCH_LIMITS.watchersPlatform} platform-wide.`,
            ],
            [
              "RPC",
              `${WATCH_LIMITS.rpcCallsPerDay.toLocaleString("en-US")} calls per day under the shared watcher/indexer ceiling; workers have separate sub-budgets.`,
            ],
            [
              "Public API",
              "120 anonymous registry reads per minute per IP. Keyed requests: 600 per hour per key.",
            ],
            [
              "Webhooks",
              `${WATCH_LIMITS.webhookEndpointsPerUser} endpoints per account, ${WATCH_LIMITS.webhookTimeoutMs / 1000}s delivery timeout and up to ${WATCH_LIMITS.maxDeliveryAttempts} attempts.`,
            ],
          ],
        },
      },
      {
        title: "Payment and deployment availability",
        paragraphs: [
          `${CHECKOUT_DESCRIPTION} Monthly credits, rollover and expanded limits require that subscription to launch. During beta, the initial grant and per-build rules in the table are the rules the backend applies. Own-key builds are available during beta and cost zero Fletch build credits.`,
          `${BUILD_WATCH_NETWORK_DESCRIPTION} Wallet-owned mainnet deployment remains planned. A failed charged build receives its Fletch credit refund as a separate ledger entry. Provider API charges follow the provider's billing terms.`,
          "The deployed wallet foundation supports compatible injected EVM wallets. The production Reown project ID is currently absent, so QR WalletConnect pairing is unavailable until it is configured. Hosted model keys use server-side encryption and decryption; server operators can access them.",
        ],
      },
      {
        title: "Optional build packages",
        paragraphs: [
          "The optional package flow uses Small, Medium and Large packages with a fixed credit price and included model requests, platform tool runs and active time. It appears when package pricing is enabled. The review shows the exact price and approved maximum before submission; changing the draft or connection requires a fresh review. Current beta pricing remains the standard rate above.",
          "A supported build can save a completed agent step and pause when its allowance runs out. Review another package to continue or choose Stop. An extension adds one package under the original agreement and requires your approval. The same allowance counters apply to own-key builds at zero Fletch credits; your provider invoice follows the provider's billing.",
          "Continuation currently requires a verified completed step and saved session from the initial Kimi agent stage. If a later stage cannot safely continue, the build fails with saved source and releases its reserved Fletch credits. Existing builds keep their original agreement. A five-hour app build and general recovery from arbitrary interruptions remain unverified.",
        ],
      },
      {
        title: "Current build verification limits",
        paragraphs: [
          "New builds fail when required output, passing contract tests, required contract deployment or a saved frontend preview is missing. Saved source and the previous published app remain available after a failed update. Older build records can still contain a succeeded status with incomplete stages; inspect their reports and publication receipts.",
          "Repairs rerun the toolchain and the final reply uses its latest reports. These checks establish compilation, test and publication results. Automated verification of every requested user action, complete wallet signing acceptance and general multi-contract deployment remain in progress; test the app's transaction flows before relying on it.",
        ],
      },
      {
        title: "Planned",
        bullets: [
          "Published package prices and paid end-to-end acceptance of allowance review and continuation.",
          "Automated verification of every requested user action, complete wallet signing acceptance and general multi-contract deployment. Current completion checks require the relevant compiler, test, security, deployment and saved-preview evidence. Publication has a separate verification step.",
          "Long-duration app acceptance, broader interruption recovery and off-host workspace restoration. Context compaction and saved continuation notes are available; summaries are bounded and may omit older detail.",
          "Expand complete rolling swap coverage beyond the selected priority pools and support more historical quote currencies. The current sources and gaps appear beside each token metric.",
          "Verified quote-token pricing coverage, broader supply and burn-balance sampling, depth-integrity checks and the remaining Markets acceptance cases.",
          "Bridged and verified Ondo trust stamps backed by their required issuer and escrow evidence.",
          "USDG credit checkout, the Builder subscription, recurring rollover credits, customer domains, expanded watcher caps and repository export as a plan entitlement.",
          "Team workspaces, dedicated capacity, Slack and email alerts, x402 payments and an npm-published MCP package.",
        ],
      },
      {
        title: "Check the current reading",
        paragraphs: [
          "Use the status page to check job freshness and historical checkpoints, then inspect the observation times for the token you need. The roadmap lists the remaining coverage and app-verification work.",
        ],
        links: [{ href: "/registry/status", label: "Live data status" }, { href: "/docs/roadmap", label: "All shipped milestones and planned work" }],
      },
    ],
  },
  roadmapDocPage,
  {
    slug: "faq",
    title: "FAQ",
    next: "webhooks",
    description:
      "Short answers about identity, builds, prices, wallets and alerts.",
    sections: [
      {
        title: "Does verified mean a token is safe to buy?",
        paragraphs: [
          "Verified means the recorded contract matches Robinhood's listing checks. Financial risk, contract behavior and the terms of the underlying asset require separate review.",
        ],
      },
      {
        title: "Why does a price or volume show a dash?",
        paragraphs: [
          "The relevant read may be missing, stale or incomplete. Inspect the observation time and coverage note. A resolved name or recently discovered pool does not supply a price or a full day of swaps.",
        ],
      },
      {
        title: "Can I close the browser during a build?",
        paragraphs: [
          "Yes. The running job belongs to the server. Reopen its project to load saved progress and reconnect. Current execution time and restart limitations are listed on the limits page.",
        ],
      },
      {
        title: "Why is my build queued?",
        paragraphs: [
          "The available execution slots are occupied by running builds or attempts reserved for recovery. The queue shows those counts separately and your position. Cancel removes a queued build and Edit restores its draft. Once a worker claims it, the console shows its running state.",
        ],
      },
      {
        title: "Can I use Phantom?",
        paragraphs: [
          "Generated signing apps use the shared component's compatible injected EVM wallet discovery, including Phantom's EVM provider. Use a browser with the extension available and check its chain support. Signing acceptance still depends on testing the generated app's transaction flow.",
        ],
      },
      {
        title: "Can Fletch operators see my hosted model key?",
        paragraphs: [
          "Operators with the server's access and encryption material can access it. It is encrypted in storage and the upstream key is kept out of generated user code. Revoke the connection in Settings when needed.",
        ],
      },
      {
        title: "Why has my watcher sent nothing?",
        paragraphs: [
          "Check that it is enabled, its condition has matched a new event, Telegram or the webhook is linked, and the delivery is sent. A held event needs a destination. A pending event may be waiting for a retry. Inspect the daemon and job status for lag.",
        ],
      },
      {
        title: "Do I need a Fletch key to read the registry?",
        paragraphs: [
          "Public registry GETs work without a key under the anonymous rate limit. Scoped keys authenticate account operations. The generated reference marks each endpoint's requirement.",
        ],
      },
      {
        title: "Which chain does each part use?",
        paragraphs: [
          "Registry and Watch follow mainnet 4663. The hosted builder currently deploys contracts to testnet 46630. Confirm the network in each receipt before using the generated app.",
        ],
      },
    ],
  },
  webhooksDocPage,
  mcpDocPage,
];

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function findDoc(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}
