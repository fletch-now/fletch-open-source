// The addresses and identifiers the authority pipelines read from. Every value
// was verified on chain or in Blockscout's verified source on 2026-09-03
// (docs/RESEARCH-DATA.md). Nothing here is configurable per environment:
// these are facts about Robinhood Chain, not about this deployment.

import type { Address, Hex } from "viem";

// One contract is at once the upgrade beacon, the global pause, the blocklist
// and the role registry for every Stock Token.
export const ACCESS_CONTROLS_REGISTRY: Address = "0xe10b6f6B275de231345c20D14Ab812db62151b00";

// EIP-1967 beacon slot: keccak256("eip1967.proxy.beacon") - 1. A canonical
// Stock Token's proxy points this slot at ACCESS_CONTROLS_REGISTRY.
export const EIP1967_BEACON_SLOT: Hex = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

// Multicall3 is deployed at its canonical address on chain 4663 (code checked).
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

// Ethereum L1 contracts of the rollup, for chain health. Read with an L1 RPC.
export const L1_SEQUENCER_INBOX: Address = "0xBd0D173EEb87D57A09521c24388a12789F33ba96";
export const L1_BRIDGE: Address = "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3";
export const L1_BATCH_POSTER: Address = "0xDaa526086787d9DEbE1D7F3FFdb1fE50cf8687F4";

export const STATUS_PAGE_COMPONENTS = "https://status.robinhoodchain.offchain.io/api/v2/components.json";
export const CHAINLINK_FEED_DIRECTORY = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
export const ROBINHOOD_PRICES_ENDPOINT = "https://api.robinhood.com/rhj/prices";
export const ROBINHOOD_CORPORATE_ACTIONS_ENDPOINT = "https://api.robinhood.com/rhj/corporate-actions";

// Chainlink equity feeds report a heartbeat of one day; past that the answer is stale.
export const FEED_HEARTBEAT_SECONDS = 86_400;

// Multipliers are 18-decimal fixed point on chain: 1e18 is 1.0.
export const MULTIPLIER_SCALE = BigInt(10) ** BigInt(18);

// Block ranges per eth_getLogs call. The public RPC answers a sparse filter over
// the chain's whole history in one call and refuses a dense one; the scanner
// halves the window on refusal, so these are ceilings, not tuning.
export const CONTROL_LOG_CHUNK = BigInt(100_000_000);
export const SUPPLY_LOG_CHUNK = BigInt(2_000_000);
export const MULTIPLIER_LOG_CHUNK = BigInt(100_000_000);

// Where scans start when no checkpoint exists: the registry's first Upgraded
// event was at block 7796, so a little before it covers everything.
export const GENESIS_SCAN_BLOCK = BigInt(7_000);

// A fresh database backfills from genesis; REGISTRY_BACKFILL_FROM moves that
// start forward for a local run that only needs recent history.
export function backfillStart(): bigint {
  const override = process.env.REGISTRY_BACKFILL_FROM;
  return override && /^\d+$/.test(override) ? BigInt(override) : GENESIS_SCAN_BLOCK;
}

// The Arbitrum token bridge gives every L1 ERC-20 exactly one L2 address, computed
// by the L2 GatewayRouter. A contract at that address is the proof a token was
// bridged; nothing else on the chain can claim to be "the" WBTC.
export const L2_GATEWAY_ROUTER: Address = "0x1E324B9316138CA9a73F960213621AD1aaf01B89";

export interface BridgeCandidate {
  symbol: string;
  name: string;
  l1Address: Address;
}

// L1 tokens worth asking the router about: the majors, plus everything Chainlink
// runs a non-equity feed for on this chain. Absence of code at the computed
// address is an answer ("never bridged"), so listing a token here never adds it.
export const BRIDGE_CANDIDATES: readonly BridgeCandidate[] = [
  { symbol: "WBTC", name: "Wrapped BTC", l1Address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { symbol: "cbBTC", name: "Coinbase Wrapped BTC", l1Address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" },
  { symbol: "tBTC", name: "tBTC v2", l1Address: "0x18084fbA666a33d37592fA2633fD49a74DD93a88" },
  { symbol: "LBTC", name: "Lombard Staked BTC", l1Address: "0x8236a87084f8B84306f72007F36F2618A5634494" },
  { symbol: "USDC", name: "USD Coin", l1Address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  { symbol: "USDT", name: "Tether USD", l1Address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  { symbol: "DAI", name: "Dai Stablecoin", l1Address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
  { symbol: "USDS", name: "USDS Stablecoin", l1Address: "0xdC035D45d973E3EC169d2276DDab16f1e407384F" },
  { symbol: "USDe", name: "Ethena USDe", l1Address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3" },
  { symbol: "EURC", name: "Euro Coin", l1Address: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c" },
  { symbol: "ENA", name: "Ethena", l1Address: "0x57e114B691Db790C35207b2e685D4A43181e6061" },
  { symbol: "LINK", name: "ChainLink Token", l1Address: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  { symbol: "wstETH", name: "Wrapped liquid staked Ether 2.0", l1Address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" },
  { symbol: "weETH", name: "Wrapped eETH", l1Address: "0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee" },
  { symbol: "UNI", name: "Uniswap", l1Address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  { symbol: "AAVE", name: "Aave Token", l1Address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  { symbol: "PENDLE", name: "Pendle", l1Address: "0x808507121B80c02388fAd14726482e061B8da827" },
  { symbol: "ARB", name: "Arbitrum", l1Address: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1" },
  { symbol: "PEPE", name: "Pepe", l1Address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
  { symbol: "ONDO", name: "Ondo", l1Address: "0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3" },
];

// Uniswap v4 on Robinhood Chain (docs.uniswap.org/contracts/v4/deployments,
// bytecode checked). One PoolManager holds every pool; StateView reads a
// pool's price and liquidity without touching the manager's storage layout.
export const UNISWAP_V4_POOL_MANAGER: Address = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const UNISWAP_V4_STATE_VIEW: Address = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
// Pool creation is sparse per currency but the launchpads have made tens of
// thousands of pools; the scanner narrows from here when refused.
export const POOL_LOG_CHUNK = BigInt(5_000_000);

// Uniswap v3 on the same chain, where pools are contracts rather than ids in
// one manager. Verified in Blockscout as UniswapV3Factory (solc 0.7.6) on
// 2026-09-04; its PoolCreated indexes token0, token1 and fee, so the two-sided
// currency filter the v4 scan uses works here too. Enabled fee tiers read from
// the factory the same day: 100/1, 500/10, 3000/60, 10000/200.
export const UNISWAP_V3_FACTORY: Address = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";

// The Pons launchpad, verified as PonsLaunchFactory (solc 0.8.30). It holds no
// pools of its own: read on 2026-09-04 it has one DEX config, named
// "uniswap v3", whose factory is UNISWAP_V3_FACTORY above, and one launch
// config pairing every launch with WETH at the 1% fee tier. So a Pons pool is
// a Uniswap v3 pool and arrives through the v3 scan; the address is kept here
// because the fact that it configures no second venue is what makes that true.
export const PONS_LAUNCH_FACTORY: Address = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb";

// The venues a dex_pools row can belong to, as stored in `venue` and published
// on every pool and event, with how each is named in prose. One home for the
// pair so the job, the pages, the labels and the changelog cannot drift.
export const VENUE_V4 = "uniswap_v4";
export const VENUE_V3 = "uniswap_v3";

const VENUE_TITLES: Record<string, string> = { [VENUE_V4]: "Uniswap v4", [VENUE_V3]: "Uniswap v3" };

// An unknown venue reads as its stored name rather than as a blank.
export function venueTitle(venue: string): string {
  return VENUE_TITLES[venue] ?? venue;
}

// A v3 PoolCreated filter is answered by the public RPC in seconds over a few
// hundred thousand blocks and times out over millions, so the scan starts
// narrower than the v4 one and widens where history is sparse.
export const V3_POOL_LOG_CHUNK = BigInt(500_000);
// One run of the v3 discovery advances at most this far, so a first pass over
// the chain's history arrives over several runs instead of one that outlives
// its cadence.
export const V3_POOL_STEP_BLOCKS = BigInt(2_000_000);

// The token bridge. On L2 the standard and custom ERC-20 gateways emit
// DepositFinalized and WithdrawalInitiated (addresses found by scanning for
// the events); on L1 the router names each token's gateway, whose balance is
// the escrow backing the bridged supply.
export const L2_ERC20_GATEWAY: Address = "0xfd9b17206278c16ddaacf6ac8f05dbf97edcb31e";
export const L2_CUSTOM_GATEWAY: Address = "0x1d187c3e2da52d72bc9c41e3aba0fdfa6a7bf055";
export const L1_GATEWAY_ROUTER: Address = "0x6a2E3a1e16FC29f27Ce61429746D558d656975bB";
export const BRIDGE_LOG_CHUNK = BigInt(2_000_000);
// A withdrawal can be executed on L1 once the challenge window has passed.
export const WITHDRAWAL_WINDOW_SECONDS = 7 * 86_400;

// The rollup on Ethereum (BoLD: assertions, not nodes) and the L2 precompiles
// that answer for the chain's own version and owners.
export const L1_ROLLUP: Address = "0x23A19d23e89166adedbDcB432518AB01e4272D94";
export const ARB_SYS: Address = "0x0000000000000000000000000000000000000064";
export const ARB_OWNER_PUBLIC: Address = "0x000000000000000000000000000000000000006b";
// Nitro reports arbOSVersion() as the ArbOS version plus 55.
export const ARBOS_VERSION_OFFSET = 55;

// The issuer's paperwork: the EU legal hub lists the base prospectus and one
// Final Terms PDF per ticker; the docs site carries the pages that change
// (restricted jurisdictions, corporate actions, service providers).
export const ISSUER_LEGAL_HUB = "https://robinhood.com/eu/en/legal/rhj/";
export const ISSUER_PAGES: ReadonlyArray<{ slug: string; url: string }> = [
  { slug: "rhj", url: "https://docs.robinhood.com/rhj/" },
  { slug: "restricted-jurisdictions", url: "https://docs.robinhood.com/rhj/restricted-jurisdictions" },
  { slug: "corporate-actions", url: "https://docs.robinhood.com/rhj/corporate-actions" },
  { slug: "price-deviations", url: "https://docs.robinhood.com/rhj/price-deviations" },
  { slug: "service-providers", url: "https://docs.robinhood.com/rhj/service-providers" },
  { slug: "product", url: "https://docs.robinhood.com/rhj/product" },
  { slug: "chain-notices", url: "https://docs.robinhood.com/chain/notices-and-upgrades/" },
];
