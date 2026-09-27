// The ABIs the pipelines decode with, copied from Blockscout's verified source
// for AccessControlsRegistry (0xe10b…) and the Stock implementation (0xb354…),
// trimmed to what is read. A drift here would silently drop events, so the
// event signatures are exactly as the contracts declare them.

import { parseAbi } from "viem";

export const REGISTRY_ABI = parseAbi([
  "event Blocked(address indexed account)",
  "event Unblocked(address indexed account)",
  "event Paused()",
  "event Unpaused()",
  "event Upgraded(address indexed implementation)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  "function implementation() view returns (address)",
  "function paused() view returns (bool)",
  "function isBlocked(address account) view returns (bool)",
]);

export const STOCK_ABI = parseAbi([
  "event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function tokenPaused() view returns (bool)",
  "function oraclePaused() view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function totalSupplyUI() view returns (uint256)",
]);

export const AGGREGATOR_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

export const SEQUENCER_INBOX_ABI = parseAbi(["function batchCount() view returns (uint256)"]);
export const BRIDGE_ABI = parseAbi(["function delayedMessageCount() view returns (uint256)"]);

export const GATEWAY_ROUTER_ABI = parseAbi(["function calculateL2TokenAddress(address l1ERC20) view returns (address)"]);

export const ERC20_META_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);

export const POOL_MANAGER_ABI = parseAbi([
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

export const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

// Uniswap v3: the factory announces every pool, and each pool answers for its
// own price and depth. slot0 returns seven values here against v4's four, so
// the venues cannot share a read, but sqrtPriceX96 means the same thing in both.
export const UNISWAP_V3_FACTORY_ABI = parseAbi(["event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"]);

export const UNISWAP_V3_POOL_ABI = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);

export const L2_GATEWAY_ABI = parseAbi([
  "event DepositFinalized(address indexed l1Token, address indexed _from, address indexed _to, uint256 _amount)",
  "event WithdrawalInitiated(address l1Token, address indexed _from, address indexed _to, uint256 indexed _l2ToL1Id, uint256 _exitNum, uint256 _amount)",
]);

export const L1_GATEWAY_ROUTER_ABI = parseAbi(["function getGateway(address token) view returns (address)"]);
export const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export const ROLLUP_BOLD_ABI = parseAbi([
  "function latestConfirmed() view returns (bytes32)",
  "function confirmPeriodBlocks() view returns (uint64)",
  "function getAssertion(bytes32 assertionHash) view returns ((uint64 firstChildBlock, uint64 secondChildBlock, uint64 createdAtBlock, bool isFirstChild, uint8 status, bytes32 configHash))",
]);

export const ARB_PRECOMPILE_ABI = parseAbi(["function arbOSVersion() view returns (uint64)", "function getAllChainOwners() view returns (address[])"]);
