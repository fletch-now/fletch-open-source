---
name: fletch-design
description: Design and refine generated Fletch apps from their complete brief, using a varied project direction, the sandbox foundation and one EVM wallet component. Applies to initial builds and subsequent edits or repairs.
---

Design facts: build the interface around the app's main task, then give it a deliberate visual treatment:
- Explicit user aesthetics override every visual default below, including emoji,
  gradients, glass, shadows, fonts and layout. Follow an attached visual reference
  only when the selected model actually receives its image; never claim to have
  seen a text-only attachment. For signing apps, use the one template wallet
  component (freely restyle it), and offer only EVM-compatible wallets.
- Read the complete brief. Identify who uses the app, their main task and the
  information needed to act. A swap form needs quote entry and trade status; payroll
  needs funding, a recipient ledger and accrued withdrawals; a raffle needs
  ticket purchase, its deadline and claim state. Support tickets are a work queue.
  A supplied workflow hint is fallible; the complete request decides the workflow.
  Put that workflow on the first screen. Generic heroes and four statistic cards
  must not displace the actual product.
- For a new app, use the selected direction as a coherent starting point for
  composition, density and typography. Vary the spatial hierarchy and scale with
  the purpose: a board with turn controls, a compact quote form beside positions,
  or a recipient table with a funding rail are different interfaces. A palette
  change alone is insufficient. Use one distinctive, useful element; avoid
  decorative controls that do nothing. Make a short DESIGN.md recording the
  actual palette, type scale, composition, primary action and motion policy.
- On edits and repairs, read the existing source and DESIGN.md. Preserve their
  actual design. The saved starting direction is not an instruction to restore
  an old theme. Follow an explicit redesign request and update DESIGN.md to match.
- Define the complete palette after the foundation: --bg, --surface, --text,
  --muted, --accent, --on-accent, --positive, --negative and CSS color-scheme.
  Use --on-accent for filled accent controls. Dark surfaces need matching muted,
  positive and negative text colors. Verify normal text contrast of at least
  4.5:1 on its actual surface, including labels and buttons; focus indicators
  need 3:1 against adjacent colors. Use one accent plus semantic financial
  outcomes. Do not inherit Tailwind blue-500 or indigo-500 as the app identity.
- The foundation loads Instrument Sans for UI and IBM Plex Mono for numbers.
  Keep --font-ui and --font-mono; choose a purpose-specific scale with the named
  --text-display, --text-heading, --text-body and --text-caption tokens. Vary
  hierarchy through scale, weight, line height and alignment. A dense tool needs
  smaller headings than a game lobby. Body text remains readable. Updating
  numbers use tabular figures, units and consistent precision. Use a four-pixel
  spacing scale and two radii, --radius-control and --radius-panel, chosen to
  fit the direction. Keep user-requested typography; use only available assets.
- One primary action per task area. Secondary controls have less emphasis.
  Prefer rows, tables and whitespace to wrapping every fact in a bordered card.
  Align labels and numbers, group related controls and make reading order clear.
  Use responsive grid or flex layouts with shrinking children (min-width: 0),
  wrapping controls and local scrolling for wide data tables. Long addresses
  have a readable short form and a way to copy or inspect the full value.
  At 320px, the page itself must not scroll sideways. Use fluid type and spacing
  where useful; fixed large headings must not push the main action off screen.
- Empty states explain what appears and how to populate it. Loading preserves
  layout with a skeleton or one spinner. Show query failures and unavailable
  data with a reason. Include hover, focus-visible and clear disabled states;
  labels remain visible outside tooltips. Plan keyboard order and touch targets.
  Use brief motion to explain a state change. Under prefers-reduced-motion,
  disable decorative transitions and animations. Never simulate live balances
  or transactions for visual effect.
- Set a purpose-specific document title and a small original SVG favicon. Defaults:
  no emoji headings/buttons/brands, stacked wallet buttons, equal-weight default
  button rows, gradient hero text, glass cards, shadows on everything, generic AI
  or built-with slogans, lorem ipsum, placeholder images or invented live data.
- Examples show range, not templates to copy: Robinhood Lands can use a purposeful
  game theme, hand-drawn glyph accents, mono statistic cards and outcome-colored
  logs. A Fletch dashboard can use white surfaces, hairline borders, stat tiles and
  status chips. Different purposes should produce different palettes and layouts.
- Reuse the foundation in fletch/: tokens.css, ui.tsx, reads.ts and wallet.tsx.
  The image also keeps /opt/webapp/example as a reference; do not copy its example
  page into the finished app. Import ../fletch/tokens.css from src/main.tsx and
  define the app's palette after that import. The foundation is editable; preserve
  existing project styles on follow-ups unless the user asks to change them.
- Read-only apps use public-client hooks and no wallet provider or connect control.
  reads.ts names the two block clocks explicitly: useChainBlockNumber for RPC
  execution heights; useSolidityBlockNumber for Solidity block.number deadlines.
  Match the clock to the contract and handle query errors before enabling actions.
  Apps that sign use WalletProvider once and WalletControl once from wallet.tsx.
  AppKit uses only the supplied VITE_WALLETCONNECT_PROJECT_ID. If it is absent,
  keep detected Phantom EVM (window.phantom.ethereum), other compatible injected
  wallets and EIP-6963 discovery; only WalletConnect remains unavailable.
  Preserve wallet-connectors.ts and the shared component's injected discovery when
  restyling. In embedded previews retain its open-hosted-app guidance; discovery
  and network support depend on the installed wallet and browser.
  Never invent an ID or add a second wallet control.
  The component offers EVM accounts, an address chip, disconnect and an explicit
  wrong-network switch. Check useWalletReady before every signing action.
- Finish with a design review and focused corrections after the first complete
  implementation. Read the actual JSX and CSS: check that the primary workflow
  is present, the chosen composition is implemented, token overrides are complete,
  content can wrap, and loading, empty, disconnected, wrong-network, pending,
  rejected and completed states exist where applicable. Remove unused starter
  content, duplicate controls and needless nested panels. Keep corrections within
  the requested change; a contract repair does not authorize a visual redesign.
  The supplied sandbox currently has no browser or screenshot tool. A source
  review cannot prove appearance or wallet interaction. If a browser is explicitly
  provided, render phone and desktop sizes and inspect the primary flow, contrast,
  overflow and states. Otherwise report that rendered layout and wallet interaction
  were not checked. Never claim to have opened a page or inspected a screenshot
  unless that tool actually ran. Keep design review separate from compiler,
  security and transaction verdicts.
- Your final reply includes one plain sentence naming the palette/light-or-dark
  design choice and its purpose, or that you followed the user's requested style.
  Keep this design description separate from toolchain verdicts. Do not claim
  compilation, security, deployment or live data based on your own prose.
