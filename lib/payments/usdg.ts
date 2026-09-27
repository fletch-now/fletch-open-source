import { erc20Abi, getAddress, isAddress, parseEventLogs, type Hex, type Log } from "viem";
import { getChainClient } from "@/lib/chain/rpc";
import { RH_MAINNET_ID } from "@/lib/config";

// Credits are bought with USDG on Robinhood Chain mainnet: a plain ERC-20
// transfer from the wallet that signed in, to the treasury. The server reads the
// receipt itself and credits what was paid, floored to whole credits. No
// "server-only" here: the watch daemon imports this module to sweep payments the
// browser never confirmed.

// Global Dollar (Paxos) on chain 4663, from docs.robinhood.com/chain/contracts;
// the same address the registry seeds and every watcher can target.
export const USDG = {
  chainId: RH_MAINNET_ID,
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  decimals: 6,
} as const;

// 0.40 USDG per credit, kept in base units so every calculation is integer.
export const PRICE_PER_CREDIT_USDG = 0.4;
export const PRICE_PER_CREDIT_UNITS = BigInt(400_000);

export const PURCHASE_KEY_PREFIX = `usdg:${RH_MAINNET_ID}:`;

// The treasury as configured, checksummed, or null when unset or malformed. Both
// the server (lib/payments/treasury.ts) and the daemon sweep read it this way.
export function parseTreasury(raw: string | undefined): string | null {
  if (!raw || !isAddress(raw)) {
    return null;
  }
  return getAddress(raw);
}

export function purchaseKey(txHash: string): string {
  return `${PURCHASE_KEY_PREFIX}${txHash.toLowerCase()}`;
}

// Whole credits for an amount in base units; the remainder is not lost, it is
// simply not enough for another credit.
export function creditsFor(rawTotal: bigint): number {
  if (rawTotal <= BigInt(0)) {
    return 0;
  }
  return Number(rawTotal / PRICE_PER_CREDIT_UNITS);
}

export interface TransferLike {
  address: string;
  from: string;
  to: string;
  value: bigint;
}

// The USDG transfers in a receipt that landed in the treasury from one of the
// person's wallets. Addresses are compared lowercased: wallets sign in with
// whatever casing their wallet reports.
export function transfersToTreasury(transfers: TransferLike[], treasury: string, wallets: string[]): TransferLike[] {
  const treasuryLower = treasury.toLowerCase();
  const usdgLower = USDG.address.toLowerCase();
  const owned = new Set(wallets.map((wallet) => wallet.toLowerCase()));
  return transfers.filter(function matches(transfer) {
    return (
      transfer.address.toLowerCase() === usdgLower &&
      transfer.to.toLowerCase() === treasuryLower &&
      owned.has(transfer.from.toLowerCase())
    );
  });
}

export function sumValue(transfers: Array<{ value: bigint }>): bigint {
  return transfers.reduce(function add(total, transfer) {
    return total + transfer.value;
  }, BigInt(0));
}

export type VerifyResult =
  | { ok: true; credits: number; paidUnits: bigint }
  | { ok: false; pending: true }
  | { ok: false; pending: false; reason: string };

function decodeTransfers(logs: Log[]): TransferLike[] {
  const events = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs, strict: false });
  return events.map(function shape(event) {
    return {
      address: event.address,
      from: event.args.from ?? "",
      to: event.args.to ?? "",
      value: event.args.value ?? BigInt(0),
    };
  });
}

// Reads the receipt from the chain. A hash that is not mined yet is reported as
// pending, so the browser can retry rather than tell the person it failed.
export async function verifyUsdgPayment(txHash: Hex, treasury: string, wallets: string[]): Promise<VerifyResult> {
  const client = getChainClient(RH_MAINNET_ID);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TransactionReceiptNotFoundError") {
      return { ok: false, pending: true };
    }
    return { ok: false, pending: false, reason: "The chain could not be read right now. Try again in a moment." };
  }
  if (receipt.status !== "success") {
    return { ok: false, pending: false, reason: "That transaction reverted." };
  }
  const paid = sumValue(transfersToTreasury(decodeTransfers(receipt.logs), treasury, wallets));
  const credits = creditsFor(paid);
  if (credits === 0) {
    return {
      ok: false,
      pending: false,
      reason: `No USDG from your wallet reached the treasury ${getAddress(treasury)} in that transaction, or it was under ${PRICE_PER_CREDIT_USDG} USDG.`,
    };
  }
  return { ok: true, credits, paidUnits: paid };
}
