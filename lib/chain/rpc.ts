// Chain access for both the Next.js server and the watch daemon (a plain Node
// process). No "server-only", no next/*, no React, no lib/dal — the daemon imports
// this module directly with tsx.

import { createPublicClient, http, BlockNotFoundError, type Chain, type PublicClient } from "viem";
import { budgetedRpcFetch } from "@/lib/chain/rpc-budget";
import { createDedicatedFetch, pacedFetch } from "@/lib/chain/pace";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";

// Free, unauthenticated, rate-limited, "not for production" per Robinhood's own
// docs — the development fallback, not the plan. usingPublicRpc tells the UI when
// a watcher is running on it so degraded delivery isn't a mystery.
// Exported so callers that must never leak a configured provider's URL (which can
// carry an embedded API key, e.g. Alchemy) — the v1 `/chains` route — can publish
// this address instead of whatever `getRpcUrl` resolves to.
export const PUBLIC_RPC_URLS: Record<number, string> = {
  [RH_MAINNET_ID]: "https://rpc.mainnet.chain.robinhood.com",
  [RH_TESTNET_ID]: "https://rpc.testnet.chain.robinhood.com",
};

function chainFor(chainId: number): Chain {
  if (chainId === RH_MAINNET_ID) {
    return robinhood;
  }
  if (chainId === RH_TESTNET_ID) {
    return robinhoodTestnet;
  }
  throw new Error(`unsupported chain id ${chainId}`);
}

function envRpcUrl(chainId: number): string | undefined {
  return process.env[`RPC_URL_${chainId}`]?.trim() || undefined;
}

export function getRpcUrl(chainId: number): string {
  const configured = envRpcUrl(chainId);
  if (configured) {
    return configured;
  }
  const fallback = PUBLIC_RPC_URLS[chainId];
  if (!fallback) {
    throw new Error(`no RPC endpoint configured for chain ${chainId}`);
  }
  return fallback;
}

export function usingPublicRpc(chainId: number): boolean {
  return getRpcUrl(chainId) === PUBLIC_RPC_URLS[chainId];
}

// One client per chain, reused across every watcher on that chain rather than
// opened per call — this process (server or daemon) lives for hours.
const clients = new Map<number, PublicClient>();

export function getChainClient(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) {
    return cached;
  }
  const client = createPublicClient({
    chain: chainFor(chainId),
    transport: http(getRpcUrl(chainId), { timeout: 4_000, retryCount: 0 }),
  });
  clients.set(chainId, client);
  return client;
}

const daemonClients = new Map<number, PublicClient>();
const dedicatedFetch = createDedicatedFetch();
// Bounded market reads share their own paced lane so a long legacy request
// cannot consume their timeout while they wait. Persistent budgets still apply.
const marketDedicatedFetch = createDedicatedFetch(200);
const metadataDedicatedFetch = createDedicatedFetch(200);
const logClients = new Map<string, PublicClient>();

// A provider may support current-state reads while its plan cannot serve log
// history. This explicit override keeps that distinction visible to operators.
export function getLogRpcUrl(chainId: number): string {
  return process.env[`RPC_LOG_URL_${chainId}`]?.trim() || getRpcUrl(chainId);
}

export function usingPublicLogRpc(chainId: number): boolean {
  return getLogRpcUrl(chainId) === PUBLIC_RPC_URLS[chainId];
}

export function getLogClient(chainId: number, daemon = false): PublicClient {
  const url = getLogRpcUrl(chainId);
  if (url === getRpcUrl(chainId)) {
    return daemon ? getDaemonClient(chainId) : getChainClient(chainId);
  }
  const key = `${chainId}:${daemon}`;
  const cached = logClients.get(key);
  if (cached) {
    return cached;
  }
  const fetchFn = usingPublicLogRpc(chainId) ? pacedFetch : dedicatedFetch;
  const client = createPublicClient({
    chain: chainFor(chainId),
    transport: http(url, {
      retryCount: 0,
      // Page/API reads must not wait in the worker's long history queue.
      timeout: daemon ? 600_000 : 4_000,
      fetchFn: daemon ? fetchFn : undefined,
    }),
  });
  logClients.set(key, client);
  return client;
}

// The daemon's client never retries on its own. The transport's default of
// three quick retries turned every refusal from the public RPC into four
// quota hits, which is how one refused request emptied the whole minute; the
// daemon's own gate paces and pauses instead. Calls made within the same
// tick travel as one JSON-RPC batch (the public endpoint accepts them), so a
// job reading 194 tokens costs a handful of requests, not 194.
export function getDaemonClient(chainId: number): PublicClient {
  const cached = daemonClients.get(chainId);
  if (cached) {
    return cached;
  }
  const client = createPublicClient({
    chain: chainFor(chainId),
    // One JSON-RPC call per HTTP request, paced: a batch of ten arrived as
    // a burst of ten, which is exactly the public RPC's burst limit, and a
    // refused batch took ten multicall chunks down with it. A request may
    // wait in its lane behind a long pass; the timeout covers the queue.
    transport: http(getRpcUrl(chainId), { retryCount: 0, timeout: 600_000, fetchFn: usingPublicRpc(chainId) ? pacedFetch : dedicatedFetch }),
  });
  daemonClients.set(chainId, client);
  return client;
}

// Metadata runs have a work deadline; keep their individual reads bounded too.
// Dedicated metadata has its own bounded lane; public metadata keeps the shared gate.
const metadataClients = new Map<number, PublicClient>();

export function getMetadataClient(chainId: number, checkBudget: () => Promise<{ ok: boolean }>): PublicClient {
  const cached = metadataClients.get(chainId);
  if (cached) return cached;
  const fetchFn = budgetedRpcFetch(usingPublicRpc(chainId) ? pacedFetch : metadataDedicatedFetch, checkBudget);
  const client = createPublicClient({
    chain: chainFor(chainId),
    transport: http(getRpcUrl(chainId), { retryCount: 0, timeout: 15_000, fetchFn }),
  });
  metadataClients.set(chainId, client);
  return client;
}

// Market state and on-demand reads share transport pacing but have separate
// persistent sub-budgets. Per-pass clients allow exact request receipts.
export function getMarketReadClient(chainId: number, checkBudget: () => Promise<{ ok: boolean }>): PublicClient {
  return createPublicClient({
    chain: chainFor(chainId),
    transport: http(getRpcUrl(chainId), { retryCount: 0, timeout: 15_000,
      fetchFn: budgetedRpcFetch(usingPublicRpc(chainId) ? pacedFetch : marketDedicatedFetch, checkBudget) }),
  });
}

export async function getHead(chainId: number): Promise<{ number: bigint; hash: string }> {
  const client = getChainClient(chainId);
  const block = await client.getBlock({ blockTag: "latest" });
  return { number: block.number, hash: block.hash };
}

// Returns null (rather than throwing) only when the provider reports no such
// block — the shape a reorg-rollback caller needs to walk back through blocks
// that may since have been replaced.
export async function getBlockHeader(
  chainId: number,
  number: bigint,
): Promise<{ number: bigint; hash: string; parentHash: string; timestamp: number } | null> {
  const client = getChainClient(chainId);
  try {
    const block = await client.getBlock({ blockNumber: number });
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: Number(block.timestamp),
    };
  } catch (error) {
    if (error instanceof BlockNotFoundError) {
      return null;
    }
    throw error;
  }
}
