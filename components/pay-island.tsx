"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { toast } from "sonner";
import { Check, Copy } from "@/components/ui/icons";
import { friendlyError } from "@/lib/errors";
import { RH_MAINNET_ID } from "@/lib/config";
import { PRICE_PER_CREDIT_USDG, USDG } from "@/lib/payments/usdg";

// Buying credits: pick how many, the wallet sends that much USDG to the treasury
// on Robinhood Chain, and the server credits the account from the receipt. Each
// step is a named state so the button always says what it is waiting for. A
// second path, paste a transaction hash, covers a payment made from a phone or a
// wallet the browser cannot reach; the server route is the same.

interface PayIslandProps {
  treasury: string;
  priceUsdg: number;
}

type Step = "idle" | "switching" | "signing" | "mining" | "confirming" | "done";

interface PurchaseResponse {
  credits?: number;
  already?: boolean;
  balance?: number;
  pending?: boolean;
  error?: string;
}

const CONFIRM_ATTEMPTS = 20;
const CONFIRM_DELAY_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise(function wait(resolve) {
    setTimeout(resolve, ms);
  });
}

// The route answers 202 while the receipt is not yet visible to the server's
// RPC; keep asking for a minute before giving up on the browser side. The
// daemon's sweep credits it either way.
async function confirmPurchase(txHash: string): Promise<PurchaseResponse> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const response = await fetch("/api/credits/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
    const body = (await response.json().catch(function ignore() {
      return {};
    })) as PurchaseResponse;
    if (response.status !== 202) {
      if (!response.ok) {
        throw new Error(body.error ?? "The server could not confirm the payment.");
      }
      return body;
    }
    await sleep(CONFIRM_DELAY_MS);
  }
  return { pending: true };
}

function stepLabel(step: Step, credits: number, priceUsdg: number): string {
  switch (step) {
    case "switching":
      return "Switching to Robinhood Chain…";
    case "signing":
      return "Confirm in your wallet…";
    case "mining":
      return "Waiting for the block…";
    case "confirming":
      return "Crediting…";
    case "done":
      return "Credited";
    default:
      return `Pay ${(credits * priceUsdg).toFixed(2)} USDG for ${credits} credit${credits === 1 ? "" : "s"}`;
  }
}

function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(value).catch(function ignore() {});
    setCopied(true);
    setTimeout(function reset() {
      setCopied(false);
    }, 1600);
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 break-all font-mono text-[12px] text-ink transition-colors hover:text-hood-deep">
      {value}
      {copied ? <Check className="h-3 w-3 shrink-0 text-hood-deep" strokeWidth={2.2} /> : <Copy className="h-3 w-3 shrink-0" strokeWidth={1.8} />}
    </button>
  );
}

export function PayIsland({ treasury, priceUsdg }: PayIslandProps) {
  const router = useRouter();
  const config = useConfig();
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [credits, setCredits] = useState(25);
  const [step, setStep] = useState<Step>("idle");
  const [pasted, setPasted] = useState("");
  const [pasting, setPasting] = useState(false);
  const balance = useReadContract({
    abi: erc20Abi,
    address: USDG.address,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: RH_MAINNET_ID,
    query: { enabled: Boolean(address) },
  });

  const amountUnits = parseUnits((credits * priceUsdg).toFixed(6), USDG.decimals);
  const usdgBalance = balance.data ?? null;
  const short = usdgBalance !== null && usdgBalance < amountUnits;

  async function finish(hash: string): Promise<void> {
    setStep("confirming");
    const result = await confirmPurchase(hash);
    if (result.pending) {
      toast.message("Paid. The credit lands within a minute; this page will show it.");
    } else if (result.already) {
      toast.message("That payment was already credited.");
    } else {
      toast.success(`+${result.credits} credits. Balance ${result.balance}.`);
    }
    setStep("done");
    router.refresh();
  }

  // One sequence, one handler: switch chain, sign, wait for the block, credit.
  // Each await moves the button's label; any failure returns it to idle with a
  // plain sentence about what happened.
  async function pay(): Promise<void> {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first.");
      return;
    }
    try {
      if (chainId !== RH_MAINNET_ID) {
        setStep("switching");
        await switchChainAsync({ chainId: RH_MAINNET_ID });
      }
      setStep("signing");
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: USDG.address,
        functionName: "transfer",
        args: [treasury as `0x${string}`, amountUnits],
        chainId: RH_MAINNET_ID,
      });
      setStep("mining");
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: RH_MAINNET_ID });
      if (receipt.status !== "success") {
        throw new Error("The transaction failed on chain.");
      }
      await finish(hash);
    } catch (cause) {
      toast.error(friendlyError(cause, "The payment did not go through."));
      setStep("idle");
    }
  }

  async function submitPasted(): Promise<void> {
    if (!/^0x[a-fA-F0-9]{64}$/.test(pasted.trim())) {
      toast.error("Paste the transaction hash: 0x followed by 64 hex characters.");
      return;
    }
    setPasting(true);
    try {
      await finish(pasted.trim());
      setPasted("");
    } catch (cause) {
      toast.error(friendlyError(cause, "Could not confirm that payment."));
    } finally {
      setPasting(false);
      setStep("idle");
    }
  }

  const busy = step !== "idle" && step !== "done";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] text-ink-soft">Credits</span>
          <input
            type="number"
            min={1}
            max={500}
            value={credits}
            onChange={function onChange(event) {
              setCredits(Math.max(1, Math.min(500, Number(event.target.value) || 1)));
            }}
            className="h-11 w-24 rounded-lg border border-line bg-paper px-3 font-mono text-[14px] text-ink focus:border-hood/60 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={pay}
          disabled={busy || short}
          className="h-11 rounded-full bg-hood px-5 text-[13.5px] font-semibold text-black transition-colors hover:bg-hood-strong disabled:opacity-50"
        >
          {stepLabel(step, credits, priceUsdg)}
        </button>
        <span className="text-[12.5px] text-ink-faint">
          {PRICE_PER_CREDIT_USDG} USDG per credit on Robinhood Chain. Your wallet pays gas.
        </span>
      </div>
      {short ? (
        <p className="text-[13px] text-amber-800">
          This wallet holds less USDG than the price. Top it up on Robinhood, or pay from another wallet and paste the hash below.
        </p>
      ) : null}
      {isConnected ? null : <p className="text-[13px] text-ink-soft">Connect the wallet you signed in with to pay from the browser.</p>}

      <div className="rounded-lg border border-line bg-panel/40 px-4 py-3 text-[12.5px] text-ink-soft">
        <p>
          Paying from a phone or another wallet: send USDG on Robinhood Chain (chain {RH_MAINNET_ID}) from a wallet that has signed in
          here to
        </p>
        <p className="mt-1">
          <CopyText value={treasury} />
        </p>
        <p className="mt-1">
          then paste the transaction hash. Credits are added on a sequencer-confirmed receipt, the same confirmation Watch uses.
        </p>
        <form
          onSubmit={function onSubmit(event) {
            event.preventDefault();
            void submitPasted();
          }}
          className="mt-3 flex flex-wrap gap-2"
        >
          <input
            type="text"
            value={pasted}
            onChange={function onChange(event) {
              setPasted(event.target.value);
            }}
            placeholder="0x… transaction hash"
            spellCheck={false}
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-[12.5px] text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pasting || pasted.trim().length < 66}
            className="h-10 rounded-full border border-line px-4 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
          >
            {pasting ? "Checking…" : "Credit this payment"}
          </button>
        </form>
      </div>
    </div>
  );
}
