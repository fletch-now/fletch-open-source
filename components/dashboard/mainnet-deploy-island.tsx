"use client";

import { publicDiagnostic } from "@/lib/public-copy";
import { useState } from "react";
import type { Abi, Hex } from "viem";
import { useAccount, useConfig, useDeployContract, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { RH_MAINNET_ID } from "@/lib/config";

// Deploys the compiled contract to Robinhood Chain mainnet from the connected
// wallet, then tells the server the transaction so it can check the bytecode,
// verify the source and rebuild the front end. The server never holds a key
// for mainnet; this island is the only signer.

interface MainnetDeployIslandProps {
  buildId: string;
  abi: Abi;
  bytecode: Hex;
  contractName: string;
  // True when the constructor takes the owner address; the connected wallet
  // is passed, so the person owns the mainnet contract too.
  takesOwner: boolean;
}

interface Recorded {
  address: string;
  explorerUrl: string;
  verified: boolean;
  verifyError: string | null;
  previewUrl: string | null;
  hostingNote: string | null;
}

type Step = "idle" | "switching" | "signing" | "mining" | "recording" | "done";

const STEP_TEXT: Record<Step, string> = {
  idle: "Deploy to mainnet with this wallet",
  switching: "Switching your wallet to Robinhood Chain…",
  signing: "Confirm the deployment in your wallet…",
  mining: "Waiting for the transaction to be mined…",
  recording: "Recording, verifying and rebuilding the page…",
  done: "Deployed to mainnet",
};

export function MainnetDeployIsland({ buildId, abi, bytecode, contractName, takesOwner }: MainnetDeployIslandProps) {
  const { address, chainId, isConnected } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { deployContractAsync } = useDeployContract();
  const [step, setStep] = useState<Step>("idle");
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function deploy(): Promise<void> {
    setError(null);
    try {
      if (chainId !== RH_MAINNET_ID) {
        setStep("switching");
        await switchChainAsync({ chainId: RH_MAINNET_ID });
      }
      setStep("signing");
      if (!address) {
        throw new Error("Connect a wallet first.");
      }
      const txHash = takesOwner
        ? await deployContractAsync({ abi, bytecode, chainId: RH_MAINNET_ID, args: [address] })
        : await deployContractAsync({ abi, bytecode, chainId: RH_MAINNET_ID });
      setStep("mining");
      await waitForTransactionReceipt(config, { hash: txHash, chainId: RH_MAINNET_ID });
      setStep("recording");
      const response = await fetch(`/api/builds/${buildId}/mainnet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash }),
      });
      const body = (await response.json().catch(function notJson() {
        return null;
      })) as (Recorded & { error?: string }) | null;
      if (!response.ok || !body || body.error) {
        throw new Error(body?.error ?? "The server could not record the deployment.");
      }
      setRecorded(body);
      setStep("done");
      toast.success(`${contractName} is live on mainnet at ${body.address}`);
    } catch (cause) {
      setStep("idle");
      setError(friendlyError(cause));
    }
  }

  if (recorded) {
    return (
      <div className="rounded-card border border-hood/40 bg-hood-wash px-4 py-3 text-[13px] text-ink">
        <p className="font-medium">
          {contractName} on Robinhood Chain mainnet:{" "}
          <a href={recorded.explorerUrl} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
            {recorded.address}
          </a>
        </p>
        <p className="mt-1 text-ink-soft">{recorded.verified ? "Source verified on the chain explorer." : `Not verified: ${publicDiagnostic(recorded.verifyError ?? "unknown")}`}</p>
        <p className="mt-1 text-ink-soft">
          {recorded.previewUrl ? (
            <>
              Front end rebuilt for mainnet:{" "}
              <a href={recorded.previewUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {recorded.previewUrl}
              </a>
            </>
          ) : (
            (recorded.hostingNote ?? "This build has no front end.")
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={deploy}
        disabled={!isConnected || step !== "idle"}
        className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13.5px] font-semibold text-paper transition-colors hover:bg-ink/90 disabled:opacity-50"
      >
        {STEP_TEXT[step]}
      </button>
      <p className="text-[12.5px] leading-5 text-ink-faint">
        {isConnected
          ? `Signs from ${address?.slice(0, 6)}…${address?.slice(-4)}, pays mainnet gas from it${takesOwner ? ", and becomes the contract's owner" : ""}. The same bytecode that passed the tests goes on chain; the server checks it byte for byte before recording.`
          : "Connect a wallet in the header to deploy to mainnet. The server holds no mainnet key; your wallet signs and pays the gas."}
      </p>
      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
    </div>
  );
}
