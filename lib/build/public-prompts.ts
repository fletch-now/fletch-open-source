// Owner-supplied v2 briefs. Keep the home and builder pills on the same text.
export const PUBLIC_BUILD_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "On-chain game",
    prompt: `BUILD: A strategy game on the testnet where every move is a transaction. This is a full-stack write build: contracts, wallet flows, and signed moves - a read-only board is a failed build. The game concept is yours - territory conquest, siege duels, resource races, king of the hill - as long as matches have real stakes: players join with a small entry that fills a prize pool, the winner is paid out automatically by the contract, and nobody (including the deployer) can cheat the outcome.

GAME LOGIC - one source of truth: a single game state on chain; every number the interface shows derives from it, no component invents values. Entry, turns, combat or scoring, and payout are all contract rules. If your resolution needs randomness, make it manipulation-resistant and say how.

A PROVEN RECIPE, yours to vary or replace: for a territory game, a procedural organic map works beautifully - seeded so every player sees the same world, Voronoi territories inside a rough fractal coastline, neighbors sharing identical wiggly borders, adjacency doubling as the attack rule so geometry and rules can never disagree, pseudo-3D relief drawn entirely as hand-built SVG. Or throw the map away and build a different board - a ladder, an arena, an orbit - with the same discipline: hand-drawn, seeded, alive.

FRONTEND: the board is the hero and it must feel like a game - clear ownership or standing at a glance, hover inspection, capture or move animations, a live match feed from chain events, a lobby of open matches. When no wallet is connected, an autonomous simulation (bots playing by the SAME rules, marked as demo) keeps the world alive - zero empty states, nothing demo ever signable.

MAKE IT YOURS: name the game, invent its factions or theme, choose its entire visual register and commit - parchment wargame, neon arcade, brutalist chess, anything executed with taste. No icon libraries, no emoji on the canvas, no template look, compact number formatting.

NON-NEGOTIABLES: deploy every contract yourself - the player never pastes an address or configures anything; wallet connect with a one-click network switch and every action disabled until the chain is right; no transaction ever built against an undefined address; failed reads show visibly with retry, never endless loading.

PROVE IT: play a full match yourself against the live testnet - join, moves, victory, automatic payout - before you call it done.`,
  },
  {
    label: "App + token",
    prompt: `BUILD: A fair-launch token launchpad on the testnet - the pump.fun pattern, rebuilt your way. Full-stack write build: anyone connects, pays a small creation fee, launches a token with a name, ticker, and image, and it trades instantly on a bonding curve. No presale, no team allocation, everyone buys from the same curve.

MECHANICS - the proven core, your parameters: fixed total supply minted once to the curve, no mint function, no owner powers on tokens; a constant-product curve with virtual reserves so price rises smoothly from tiny; a portion of supply reserved for graduation - when the curve raises its target, trading locks and liquidity moves to a pool with the LP position burned; a small fee on trades and creation. Choose your own supply, reserve constants, target, and fees - but verify the math: the curve must be able to sell out and reach its target, round-trips must never pay out more than went in, and a fuzz of random trades must never make the curve insolvent. The quote currency is yours to solve: find real test money or deploy your own with an in-app faucet, used consistently.

FRONTEND: a board that is FULL on first load - real launched tokens first and fully tradeable, and behind them a set of invented demo tokens (names, tickers, art of your own making - no copyrighted characters) with market-realistic simulated movement, every one badged demo with no trade ticket and nothing signable. Token pages with a real price chart built from trade events, a trade ticket with fees and slippage shown honestly, live trade feed, holders, graduation progress. New real launches appear instantly at the top.

MAKE IT YOURS: name the launchpad, brand it, pick its energy - degen chaos, clean fintech, terminal minimalism - and commit everywhere. No icon packs, no emoji in interface chrome (token names can be anything), compact formats.

NON-NEGOTIABLES: deploy everything yourself including the quote token if needed; ticker collisions with well-known assets get a warning at creation; wallet gated to the right chain with one-click switch; demo and real never mix in a single number; no writes to undefined addresses.

PROVE IT: faucet, create a token, buy it, sell it - the full loop against the live testnet before finishing.`,
  },
  {
    label: "Limit order bot",
    prompt: `BUILD: Limit orders for tokens on the testnet - set a price, close the tab, the order fills when the market crosses it. Full-stack write build with two hard problems that are yours to solve and state: the venue (if no usable market exists on the testnet, create and seed one so trades actually clear, with an in-app way to get starter tokens) and the trigger (a keeper you run, or a public execute-with-bounty anyone can call - explain your choice in the interface's own words).

ORDER LOGIC - one source of truth: orders live on chain in escrow - token, side, limit, amount, status; status changes only through chain events, the interface never invents a fill; one live price feeds the chart, the ticket, and the trigger identically; cancel refunds in full. Partial fills are your call - if unsupported, say so honestly in the ticket.

FRONTEND: a trading terminal in your own register - live price chart with the user's open orders drawn on it at their levels, an order ticket with escrow preview, open orders with live distance-to-trigger, history linking every fill to its transaction. Quiet markets may carry clearly-badged simulated background trading for life - real orders and fills stay unmistakably real, nothing simulated signable.

MAKE IT YOURS: name it, choose the visual language - dense pro terminal, calm minimal, editorial - and hold it. Mono numbers, compact formats, no icon libraries, no emoji, no template look.

NON-NEGOTIABLES: deploy everything yourself, zero user configuration; chain-gated wallet flow with one-click switch; no zero-address writes; visible failure states with retry.

PROVE IT: place a real order, move the price across it, watch the automatic fill land on chain - before finishing.`,
  },
  {
    label: "RWA Token Vault",
    prompt: `BUILD: A yield vault for tokenized real-world assets on the testnet: deposit, receive shares, watch the position grow, withdraw with gains. Full-stack write build. No real yield exists on a testnet, so design an honest demo strategy - fully on chain, deterministic, able to pay every number it displays - and label it a demo strategy in plain sight. Deploy the vault and demo asset tokens yourself, with an in-app way for users to get deposit assets.

VAULT LOGIC - one source of truth: share price is vault assets over shares, read from chain, nothing else; APY derives from the actual on-chain rate, never typed in; the displayed position value must equal what a withdrawal would actually pay, to the dust. Tune the rate so growth is visible within minutes - a demo that moves. The share-price line only rises if the contract genuinely accrues; never fake the slope.

FRONTEND: an asset-management product someone would trust - an overview of vaults with share price, rate, and a real 7-day line; vault pages where the growth chart is the centerpiece and the position value ticks live between reads; a deposit-withdraw ticket with share preview and honest microcopy including the demo label. Seed a few vaults with believable balances by depositing real funds yourself.

MAKE IT YOURS: name it, pick the register - private-bank calm, DeFi glow, brutalist ledger - and execute consistently. Disciplined type, compact money formats, no icon packs, no emoji, no template look.

NON-NEGOTIABLES: nothing displayed the contract could not pay; deploy everything, zero user configuration; chain-gated wallet with one-click switch; no zero-address writes; honest failure states.

PROVE IT: deposit, let yield visibly accrue, withdraw more than you put in - on the live testnet, before finishing.`,
  },
  {
    label: "Prediction market",
    prompt: `BUILD: A prediction market on the testnet: binary questions, YES and NO shares whose prices always sum to one dollar, winners redeem a dollar a share after resolution. Full-stack write build. Pricing mechanism is your call - constant-product, LMSR, parimutuel - and the trust model is stated plainly on every market page: who resolves, when, what the caveat is. Quote money is yours to solve: real test funds or your own faucet-backed token, used consistently.

MARKET LOGIC - one source of truth: the YES price IS the probability IS the chart's latest point IS what the ticket quotes - one on-chain number everywhere; the ticket's cost and payout preview must equal contract math exactly; positions, volume, and history derive from chain events.

SEEDING: invent your own markets - questions people would genuinely argue about, staggered close dates, a mix of near-certain and contested - create them on chain and trade both sides yourself so charts have shape on first load. The display layer may add believable pre-history, badged demo; the moment a real trade lands, real data leads, and nothing a wallet signs is ever priced from a fabricated number.

FRONTEND: clarity is the product - a board where the live probability is the hero of every card; market pages with a probability-over-time chart, a ticket with exact cost and payout, positions, a resolution box in honest words; resolved markets get a settled state with redemption.

MAKE IT YOURS: name it, choose the aesthetic - and commit. Mono percents and money, compact formats, no icon libraries, no emoji, no template look, no fake round volumes.

NON-NEGOTIABLES: deploy everything, zero user configuration; chain-gated wallet with one-click switch; no zero-address writes; visible failure states.

PROVE IT: create a market, trade both sides from two wallets, resolve it, redeem winnings - on the live testnet, before finishing.`,
  },
  {
    label: "Whale tracker",
    prompt: `BUILD: A whale-intelligence tool for the chain - real transfer data, live, no padding ever. Pick a small set of assets with genuine activity and DEFAULT to whichever moves most, so the page is alive on first load without inventing anything. Read-only is the heart; add one purposeful contract so wallets matter - for example an on-chain watchlist a connected user signs their flags into - deployed by you.

DATA LOGIC - one source of truth: every figure derives from indexed transfers and live reads, and must survive a cross-check against the explorer; size tiers (shrimp to whale) computed per asset from that asset's real transfer distribution, never hardcoded fantasy thresholds; flow classification (pool, bridge, wallet) by checking what the counterparty is, with an honest unknown; if an asset is quiet, show "3 transfers this week" and make the quiet state look designed.

FRONTEND: headline stats that tick; a live transfer feed with tier marks, amounts, from and to linking to the explorer; top holders with share of supply; a volume-over-time chart; switching assets swaps the whole page cleanly.

MAKE IT YOURS: name it, choose the register - terminal density, editorial briefing, schematic precision - and hold it everywhere. Mono wherever data lives, compact formats, no icon libraries, no emoji, no template look.

NON-NEGOTIABLES: no invented or padded transfers under any circumstance; chain-gated wallet for the one write feature, one-click switch; visible failure states with retry.

PROVE IT: cross-check your headline numbers against the explorer, and sign one real watchlist entry - before finishing.`,
  },
  {
    label: "Telegram alert bot",
    prompt: `BUILD: An always-on alert product: pick a token or paste any contract, set a condition - transfers above a size, activity on an address, balance changes - and alerts keep firing after the tab closes. The always-on engine IS the product, and it runs server-side; the interface only shows what the engine reports.

DELIVERY - two modes: default is a built-in alerts inbox needing zero setup, so the whole product works without any external account; connecting the user's own Telegram bot is the guided upgrade - a two-step flow with copy-paste-ready instructions and a send-test-message button that proves it in one click.

ON-CHAIN TOUCH: one simple contract you deploy - for example a subscription registry a connected wallet signs its watchers into - so wallet connect has a real purpose, chain-gated with a one-click switch.

WATCHER LOGIC - one source of truth: a watcher is target, condition, delivery, status, last-fired, count - and the engine's state is authoritative; a status light means something real (live because the engine confirmed, error with the reason in plain words); every alert carries the decoded event with block and transaction links; alerts are always real observations, never fabricated. Ship a pre-made demo watcher on a busy token so the inbox is alive on first load.

FRONTEND: mission control in your own visual language - a watcher list with living status, a focused create flow with live validation, a reverse-chron inbox where new alerts arrive visibly, filters that work.

MAKE IT YOURS: name it, pick the register, commit. Mono for addresses and amounts, compact formats, no icon libraries, no emoji, no template look.

NON-NEGOTIABLES: deploy your contract yourself, zero required setup beyond the optional Telegram step; no zero-address writes; honest engine-error states.

PROVE IT: create a watcher, trigger it with your own transaction, watch the alert arrive in the inbox - before finishing.`,
  },
  {
    label: "Event indexer",
    prompt: `BUILD: A zero-setup event indexer for the chain: paste any contract address and its events decode and stream - live rows as they land, auto-decoded when the contract is verified, a graceful raw-topic view when not, filters by event and block range, per-event detail, and machine access: a JSON endpoint per indexed contract plus webhooks pushing new events out. The pitch: what needs an indexing service and custom code becomes one paste.

INDEX LOGIC - one source of truth: the indexed store is authoritative and the stream, the endpoint, and the webhook must agree exactly - same events, same order, same decoded arguments; decoding provenance is explicit per contract (verified ABI versus raw); coverage is honest - show the indexed range and a live lag readout.

DEMO THAT PROVES ITSELF: preload one or two contracts with real regular activity so the stream is alive immediately - finding good candidates is part of the job - and deploy one small contract of your own, an event playground a connected wallet can fire a test event at with one signed click, chain-gated with a one-click switch, so any visitor can watch their own transaction appear in the stream and the endpoint seconds later.

FRONTEND: a developer tool worth screenshotting in whatever register you choose - maximum useful density, consistent per-event coloring, a detail view with clean decoded arguments and raw topics behind a toggle, copyable endpoint URLs, and one perfect curl example whose shown response is real, never lorem.

MAKE IT YOURS: name it, choose the aesthetic - instrument panel, printed schematic, terminal - and execute it fully. Mono for all data, compact formats, no icon libraries, no emoji, no template look.

NON-NEGOTIABLES: interface, endpoint, and webhook never disagree; no pretending to decode unverified contracts; deploy your playground yourself; no zero-address writes; visible lag and failure states.

PROVE IT: index a contract, fire a real event from your own wallet, watch it appear in the stream AND the JSON endpoint - before finishing.`,
  },
];
