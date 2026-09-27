import { JOB_CADENCES, JOB_NAMES, type JobName } from "@/lib/registry/authority/cadence";
import type { DocSection } from "@/lib/docs/content";

interface JobDescription {
  source: string;
  method: string;
  where: string;
}

const JOB_DESCRIPTIONS = {
  "explorer-scouting": {
    source: "Chain explorer token search and pinned Robinhood Chain RPC reads",
    method: "Each minute, read up to eight catalog search pages and verify up to twelve candidate contracts. Keep pagination and failed attempts in PostgreSQL. Repeat completed catalog searches after six hours; catalog changes make them due sooner. Explorer labels nominate addresses; RPC reads establish the metadata used in Markets.",
    where: "Markets contract candidates, token metadata and Status scouting coverage",
  },
  "stock-pair-history": { source: "Uniswap factory events on Robinhood Chain", method: "Resume a bounded historical scan for Stock Token pools, including community pairings with no USD quote. Keep independent checkpoints and retain unavailable prices.", where: "Stock/community pairings on token pages and Markets" },
  "app-catalog": {
    source: "Robinhood public crypto catalog at nummus.robinhood.com/currency_pairs/",
    method: "Poll every 15 seconds. Commit the complete catalog and field changes together. Retain the last snapshot on errors; flag readings older than 60 seconds. Failure retries back off to five minutes.",
    where: "Token pages, Markets, Listings, Atom, JSON, live stream and Robinhood app watchers",
  },
  "control-plane": {
    source: "AccessControlsRegistry on mainnet",
    method: "Read pause, block, upgrade and role logs; call implementation() and paused(); retain a block checkpoint.",
    where: "Registry header, Changes, token control history and registry alerts",
  },
  "authority-match": {
    source: "Recorded authority events and enabled subscriptions",
    method: "Match up to 200 unmatched events to registry or token watchers and enqueue deliveries.",
    where: "Dashboard Alerts, Telegram and webhooks",
  },
  "new-pool-match": {
    source: "Discovered pools and enabled new-pool subscriptions",
    method: "Match pools after the subscription's starting block; apply depth and lookalike filters; enqueue up to 20 per watcher.",
    where: "Dashboard Alerts, Telegram and webhooks",
  },
  "chain-health": {
    source: "L2 RPC, Ethereum rollup contracts and the chain operator's status JSON",
    method: "Read block timing, gas, confirmed assertions, governance and inbox activity; retain unavailable fields as unread.",
    where: "Registry chain health and chain API",
  },
  feeds: {
    source: "Chainlink's Robinhood feed directory and matching feed contracts",
    method: "Cache the directory for one hour; call latestRoundData() through Multicall3; record answers and round times.",
    where: "Token feed panel, Registry feed filters, history and token alerts",
  },
  "supply-events": {
    source: "Tracked issued-token Transfer logs",
    method: "Scan transfers from or to the zero address as mints and burns, with separate resumable checkpoints.",
    where: "Token supply history, supply reconciliation and Changes",
  },
  "multiplier-events": {
    source: "Stock Token multiplier logs",
    method: "Decode announced multiplier changes and retain their transaction and block references.",
    where: "Token multiplier history and Changes",
  },
  "token-state": {
    source: "Tracked token contracts",
    method: "Multicall current and pending multipliers, effective time, pause flags and raw/display supply where supported.",
    where: "Token state panel, Registry filters, daily history and token alerts",
  },
  "api-prices": {
    source: "Robinhood's public /rhj/prices/{symbol} endpoint",
    method: "Read bid, ask and trading halt; compare midpoint times the recorded multiplier with the feed answer.",
    where: "Token quotes, halt/divergence filters and history",
  },
  "corporate-actions": {
    source: "Robinhood's public /rhj/corporate-actions endpoint",
    method: "Store announced actions and report additions or changed status after the initial baseline.",
    where: "Token corporate actions and Changes",
  },
  canonical: {
    source: "Active Stock Token storage and bytecode",
    method: "Read the EIP-1967 beacon slot and compare its address with AccessControlsRegistry; retain the code hash.",
    where: "Token canonical observation, Registry totals and Changes",
  },
  bridged: {
    source: "Configured Ethereum token candidates and the L2 GatewayRouter",
    method: "Call calculateL2TokenAddress(), check deployed bytecode and read ERC-20 metadata and supply.",
    where: "Registry bridged listings and token pages",
  },
  "transfer-ledger": {
    source: "Transfer logs for tracked assets, excluding wrapped native tokens",
    method: "Apply balance deltas and daily activity in committed windows, 300 blocks behind head.",
    where: "Holder API, recorded activity and history; holder panels are hidden",
  },
  "holder-labels": {
    source: "Holder balances, known addresses, pools and mint recipients",
    method: "Combine known labels with bounded getCode probes and mint-pattern inference for material holders.",
    where: "Stored holder labels and float categories; panels are hidden",
  },
  concentration: {
    source: "Covered transfer ledger and holder labels",
    method: "Record top-holder shares, Gini and float categories when the ledger is sufficiently caught up.",
    where: "Stored concentration history and API; panels are hidden",
  },
  "dex-pools": {
    source: "Uniswap v4 PoolManager Initialize logs",
    method: "Scan pools with a tracked asset or quote on either side and store discovered pool identities.",
    where: "Markets, token DEX panels and new-pool alerts",
  },
  "dex-pools-v3": {
    source: "Uniswap v3 factory PoolCreated logs",
    method: "Scan tracked sides in bounded block ranges and store pool addresses and factory provenance.",
    where: "Markets, token DEX panels and new-pool alerts",
  },
  "dex-state": {
    source: "v4 StateView, v3 pools and quote-token balances",
    method: "Refresh the selected priority pools at a pinned block. Preserve membership and reject state writes older than an existing observation.",
    where: "Markets prices/depth, token DEX panels and premium observations",
  },
  "priority-universe": {
    source: "Issuer listings, named ecosystem tokens and recorded pool activity",
    method: "Nominate up to 1,200 pools, read pinned state and compare contracts within each depth method. Update membership each minute while selected-pool refreshes continue separately. Identity metadata has a 24-hour cache.",
    where: "Token-market membership, dominance explanations and selected pools",
  },
  "priority-holders": {
    source: "Priority token contracts and the authenticated explorer counters API",
    method: "Keep current complete chain snapshots. Fetch reported explorer counts for a bounded batch of priority tokens, retaining the source URL and fetch time. The explorer does not publish the index time behind its count. Failed reads retain the previous observation and back off for 15 minutes.",
    where: "Priority token API holder metric with source and observation time",
  },
  "dex-tokens": {
    source: "Priority token contracts",
    method: "Refresh stale or missing priority identity metadata in bounded batches: symbol, name, decimals and bytecode. Record partial failures and coverage.",
    where: "Markets token pages, trust badges and metadata backlog status",
  },
  "dex-token-discovery": {
    source: "Token sides of recorded active or quiet pools",
    method: "Read up to 12 token identities per pass, with a reserved share for unread candidates. Prioritize recorded activity and depth; failed reads back off for one hour.",
    where: "Community token discovery, search and metadata backlog status",
  },
  "priority-supply": {
    source: "Selected priority token contracts",
    method: "Read supply and burn-address balances at a pinned block, up to 120 addresses per pass. Reads become due after three minutes and expire after five minutes. Record each input's block, time and failure separately.",
    where: "Token supply and market capitalization inputs, API observations and coverage status",
  },
  "dex-prices": {
    source: "Recorded pool state",
    method: "Save selected priority-pool observations with their pinned timestamps, without another RPC scan; retain 48 hours for change calculations.",
    where: "Markets price changes and token DEX views",
  },
  "dex-tiers": {
    source: "Recorded pool depth, liquidity, activity and observation times",
    method: "Assign active, quiet or dormant tiers to control subsequent sampling.",
    where: "Markets pool tiers and sampling coverage",
  },
  "dex-swaps": {
    source: "v4 Swap logs and factory-enrolled v3 pool Swap logs",
    method: "Advance the selected priority pools through canonical Swap logs; preserve per-pool coverage, raw legs and historical quote evidence.",
    where: "Markets activity, rolling-window coverage and swap-indexer status",
  },
  "dex-swap-backfill": {
    source: "Historical Swap logs for enrolled active and quiet pools",
    method: "Extend contiguous coverage backwards for up to 100 pools in a bounded range.",
    where: "Markets rolling-window coverage and swap-indexer status",
  },
  "market-refresh": {
    source: "Queued requests for token metadata or pool state",
    method: "Claim up to one token and one pool request per tick; use bounded RPC reads and persisted retry state.",
    where: "Markets and token pages after a refresh request",
  },
  "bridge-flows": {
    source: "Configured L2 gateway deposit and withdrawal logs",
    method: "Scan tracked bridge movements 30 blocks behind head and record withdrawal waiting times.",
    where: "Bridged-token panels, bridge API and Changes",
  },
  "bridge-escrow": {
    source: "Ethereum gateway balances and recorded L2 supply",
    method: "Resolve getGateway(), read the L1 token's balanceOf(gateway), and compare it with stored L2 supply.",
    where: "Bridged-token escrow panel and bridge API",
  },
  "issuer-docs": {
    source: "Robinhood Europe's legal hub and linked document headers",
    method: "Parse document links; read ETag, Last-Modified and size with HEAD; track additions, changes and removed links.",
    where: "Issuer documents, token paperwork and Changes",
  },
  "issuer-pages": {
    source: "Configured Robinhood issuer and chain-notice pages",
    method: "Fetch page text, remove markup and page chrome, and compare SHA-256 hashes.",
    where: "Issuer pages and Changes",
  },
  "feed-history": {
    source: "Attached Chainlink feed contracts",
    method: "Call getRoundData() for up to 100 older rounds per feed per pass, toward a 2,000-round target.",
    where: "Token feed charts and feed-history API",
  },
  "second-source": {
    source: "Chain explorer token details and counters",
    method: "Read holder, transfer and supply counts; compare indexed supply with the recorded contract supply.",
    where: "Token second-source comparison and history",
  },
  lookalikes: {
    source: "Chain explorer token search and candidate beacon storage",
    method: "Compare ticker/name claims; read the beacon for newly found candidates and retain observed holder counts.",
    where: "Lookalikes, token warnings, trust badges and Changes",
  },
  "supply-snapshot": {
    source: "Contract totalSupply() and recorded mint/burn totals",
    method: "Once scanners are close enough to head, record total supply minus net mint/burn history for the UTC day.",
    where: "Token supply reconciliation, residual filter and Changes",
  },
  "state-daily": {
    source: "Recorded token state, feeds, quotes, holders and coverage",
    method: "Upsert the current UTC day's observations; retain unread fields where the source was not read that day.",
    where: "Token daily history and history API",
  },
} satisfies Record<JobName, JobDescription>;

export interface RegistryJobRow extends JobDescription {
  job: JobName;
  cadenceMs: number;
  cadence: string;
}

function cadenceText(milliseconds: number): string {
  if (milliseconds % 3_600_000 === 0) return `${milliseconds / 3_600_000} h`;
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000} min`;
  return `${milliseconds / 1_000} s`;
}

export const REGISTRY_JOB_ROWS: readonly RegistryJobRow[] = JOB_NAMES.map(function describe(job): RegistryJobRow {
  return { job, ...JOB_DESCRIPTIONS[job], cadenceMs: JOB_CADENCES[job], cadence: cadenceText(JOB_CADENCES[job]) };
});

export const registryReadingSections: readonly DocSection[] = [
  {
    title: "The scheduled jobs",
    paragraphs: [
      `The Registry daemon runs these ${REGISTRY_JOB_ROWS.length} jobs against mainnet, chain 4663. The status page shows each job's last run, last success and available coverage.`,
      "The table shows each job's normal interval. Jobs run independently and cannot overlap themselves. Most wait that interval after finishing; the catalog, pool discovery, membership and live state readers schedule from the start of their previous successful run, with a five-second minimum gap. Failed jobs retain their recorded error and use the retry schedule.",
    ],
    table: {
      headings: ["Job", "Source", "Method", "Cadence", "Where it shows"],
      rows: REGISTRY_JOB_ROWS.map(function cells(row): readonly string[] {
        return [row.job, row.source, row.method, row.cadence, row.where];
      }),
    },
    links: [{ href: "/registry/status", label: "Read job status and coverage" }],
  },
  {
    title: "Listings and address checks",
    paragraphs: [
      "A separate 15-minute service imports Robinhood's published Stock Token list, checks bytecode at listed addresses and refreshes ERC-20 metadata when due. Successful metadata reads are normally reused for seven days. Bridged assets come from a configured set of Ethereum tokens checked through the gateway router.",
      "For an active Stock Token, the canonical job reads the EIP-1967 beacon storage slot and checks whether it points to AccessControlsRegistry. It also records the bytecode hash and the registry's recorded implementation address. The trust badge has its own listing, symbol and decimals checks, described on the trust page.",
      "Lookalike discovery searches the first explorer results page for each tracked ticker. New candidates receive a beacon read; discovered DEX tokens can also supply folded-name collisions. Unicode normalization catches selected Greek and Cyrillic lookalikes and invisible characters. The result describes an address and matching labels; search coverage remains bounded.",
    ],
    links: [{ href: "/docs/trust", label: "Read the trust decision rules" }],
  },
  {
    title: "Feeds, supply and holders",
    paragraphs: [
      "Chainlink answers carry the feed's update time. The reader uses a 24-hour heartbeat to mark an answer stale and keeps the previous successful observation when a call fails. Robinhood's quote comparison multiplies the bid/ask midpoint by the recorded token multiplier before comparing it with the feed.",
      "The transfer ledger commits holder balance deltas, activity and block progress together. Newly tracked assets need their own historical coverage. Concentration and supply snapshots wait for their required scanners to catch up; a successful skipped run can still leave a figure unread.",
      "The holder ledger stays 300 blocks behind head. A deeper reorganization is logged for investigation and its applied balances are not automatically reversed. Control-plane and supply scanners use separate hash checks and a 2,000-block rewind. Watch uses the different rollback path shown on its product page.",
      "Holder labels combine known addresses, bytecode reads and mint-pattern inference. Explorer holder counts remain a separate measurement. Daily history records available observations for the current UTC day, so an earlier missing day remains a coverage gap.",
    ],
  },
  {
    title: "Markets work in bounded passes",
    paragraphs: [
      "Pool discovery reads supported v3 and v4 events involving tracked assets or quote tokens. A one-minute pass nominates up to 1,200 pools from issuer listings, every observed app-catalog ticker and recorded economic activity, then selects representative contracts. Active and selected pools lead; older attempts rotate through the remaining candidates. A separate 45-second pass refreshes selected pools. Older catalog observations remain available with their timestamps.",
      "The membership pass checks up to ten due metadata records per minute; the independent metadata reader handles additional bounded batches. Successful reads become due after a day; failed attempts wait five minutes. Pool-state and demand reads have daily allowances of 120,000 and 4,000 RPC methods and also consume the shared 400,000-call bucket. Explorer holder counts use a separate bounded, paced reader. The Registry daemon limits explorer API traffic to 50,000 requests per day; provider credits are accounted separately.",
      "The swap reader records raw token legs and block hashes, then checks contiguous coverage for each rolling window. USDG volume uses nominal dollar denomination; WETH volume uses recorded historical oracle estimates. Unsupported quotes and incomplete windows carry an explanation. A v3 depth reading uses that pool's quote balance; v4 depth is a one-percent price-movement estimate bounded by the shared PoolManager's quote holdings. Each measure keeps its own label and observation time.",
    ],
    links: [{ href: "/registry/markets", label: "Explore Markets" }],
  },
  {
    title: "Bridge and issuer observations",
    paragraphs: [
      "Bridge flows come from the configured L2 gateways. Escrow compares an Ethereum gateway's token balance with the stored L2 supply reading, which may have a different timestamp. Withdrawal waiting time is derived from recorded events and the configured challenge window; a claim still needs its own transaction.",
      "Issuer document tracking compares linked-document headers such as ETag and Last-Modified. Issuer page tracking hashes cleaned page text. These observations help identify changed source material; they do not establish what a document's legal terms mean.",
    ],
    links: [{ href: "/registry/issuer", label: "Read issuer observations" }],
  },
  {
    title: "Freshness, failure and coverage",
    paragraphs: [
      "Each job records its start, finish, result and available error. The live swap reader retries failures after one minute. Other failed jobs retry with increasing delays capped by their normal interval. Partial reads can retain earlier values, so a successful job run alone does not make every asset current.",
      "A job is late when its last success is older than twice its base cadence, with a minimum one-minute allowance. A history scanner more than 10,000 blocks behind is filling; if its checkpoint stops moving beyond the larger of 30 minutes or twice its cadence, it is stalled. Missing figure timestamps are unread. Token metadata can remain filling while due or failed entries remain.",
      "The Registry worker reports every 15 seconds. After a minute without a heartbeat, its overall status is stale. While the worker is running, the overall status becomes degraded when at least 10 jobs are failing, late, stalled or awaiting their first completed run. Fewer than 10 keeps the overall status live. Each job retains its own status and observation age. The separate observer records job results every minute without advancing their timestamps.",
      "The status API includes checkedAt and ages measured from that reading, and caches the same reading for ten seconds. Read the verdict in the response body: stale data can still return HTTP 200. Per-figure newest times describe the newest recorded observation, so use asset timestamps and scanner coverage for a particular token.",
    ],
    links: [{ href: "/registry/status", label: "Inspect freshness and unread figures" }],
  },
];
