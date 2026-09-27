"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage, type Connector } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { createSiweMessage } from "viem/siwe";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { friendlyError } from "@/lib/errors";
import { APP_DOMAIN, APP_URL } from "@/lib/config";
import { HAS_APPKIT } from "@/components/wallet-provider";
import { ConnectedPill } from "@/components/connected-pill";
import { WalletHelp } from "@/components/wallet-help";

// One tap: connect the wallet if needed, then sign the SIWE message. Signing is
// what creates the account; better-auth upserts the user and its wallet row on
// verify. The message carries whatever chain the wallet is on, because a
// signature does not depend on the chain and forcing a switch here is what broke
// wallets that do not list Robinhood Chain.

interface ConnectWalletProps {
  tone?: "light" | "night";
}

// A wallet that never answers would leave the button on "Connecting…" forever.
const WALLET_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise(function race(resolve, reject) {
    const timer = setTimeout(function expire() {
      reject(new Error(`${what} timed out. Check the wallet window and try again.`));
    }, WALLET_TIMEOUT_MS);
    promise.then(
      function done(value) {
        clearTimeout(timer);
        resolve(value);
      },
      function failed(cause) {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

// Signed out the button is an outlined pill, so the filled Dashboard button
// beside it in the header reads as the primary action; signed in it becomes
// the green address pill (components/connected-pill.tsx).
function buttonClass(night: boolean, busy: boolean): string {
  const tone = night
    ? "border border-white/30 text-white hover:border-white hover:bg-white/10"
    : "border border-line-strong text-ink hover:border-ink hover:bg-panel";
  return `inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60 ${tone} ${busy ? "cursor-wait" : ""}`;
}

async function signInWith(account: `0x${string}`, chain: number, sign: (message: string) => Promise<`0x${string}`>): Promise<void> {
  const nonceResult = await authClient.siwe.nonce();
  const nonce = nonceResult.data?.nonce;
  if (!nonce) {
    throw new Error("Could not start sign-in.");
  }
  const message = createSiweMessage({
    address: account,
    chainId: chain,
    domain: APP_DOMAIN,
    uri: APP_URL,
    version: "1",
    nonce,
    statement: "Sign in to Fletch.",
  });
  const signature = await withTimeout(sign(message), "Signing");
  const verified = await authClient.siwe.verify({ message, signature });
  if (verified.error) {
    throw new Error(verified.error.message ?? "Sign-in failed.");
  }
}

function afterSignIn(): void {
  toast.success("Wallet connected");
  // Full reload on purpose: router.push keeps the stale client-side session
  // and wagmi state, so the header would render the wrong identity.
  window.location.href = window.location.pathname.startsWith("/dashboard")
    ? `${window.location.pathname}${window.location.search}`
    : "/dashboard";
}

async function signOutAndReload(): Promise<void> {
  await authClient.signOut();
  toast.success("Signed out");
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
}

// EIP-6963 gives one connector per extension plus wagmi's generic one; the
// generic one is only useful when no extension announced itself. The page
// mounts several WalletProviders on one shared wagmi config, and each mount
// appends the announced extensions again, so the list is reduced to one entry
// per wallet id before it is shown.
function walletChoices(connectors: readonly Connector[]): Connector[] {
  const seen = new Set<string>();
  const unique = connectors.filter(function once(connector) {
    if (seen.has(connector.id)) {
      return false;
    }
    seen.add(connector.id);
    return true;
  });
  const named = unique.filter(function announced(connector) {
    return connector.id !== "injected";
  });
  return named.length > 0 ? named : unique;
}

// Injected wallets only: the browser's extensions, each listed by name when
// there is more than one, connected without any chain switch.
function InjectedConnect({ tone = "light" }: ConnectWalletProps) {
  const night = tone === "night";
  const { address, chainId, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [availableChoices, setAvailableChoices] = useState<Connector[]>([]);

  const choices = walletChoices(connectors);

  async function connectAndSign(connector: Connector): Promise<void> {
    setBusy(true);
    setChoosing(false);
    try {
      const ready =
        isConnected && address && chainId
          ? { account: address, chain: chainId }
          : await withTimeout(connectAsync({ connector }), "Connecting").then(function shape(result) {
              return { account: result.accounts[0], chain: result.chainId };
            });
      await signInWith(ready.account, ready.chain, function sign(message) {
        return signMessageAsync({ message });
      });
      afterSignIn();
    } catch (cause) {
      toast.error(friendlyError(cause, "Could not connect your wallet."));
      // A half-connected wallet makes the next attempt sign with a stale
      // account; start clean.
      await disconnectAsync().catch(function ignore() {});
    } finally {
      setBusy(false);
    }
  }

  async function handleClick(): Promise<void> {
    if (busy) return;
    if (choosing) { setChoosing(false); return; }
    setBusy(true);
    try {
      const providers = await Promise.all(choices.map(async function available(connector): Promise<Connector | null> {
        const provider = await connector.getProvider().catch(function missing() { return undefined; });
        return provider ? connector : null;
      }));
      const available = providers.filter(function found(connector): connector is Connector { return connector !== null; });
      setAvailableChoices(available);
      if (available.length === 0) setHelpOpen(true);
      else if (available.length === 1) await connectAndSign(available[0]);
      else setChoosing(true);
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return <span className="h-9 w-[132px]" />;
  }

  if (session) {
    return <ConnectedPill address={session.wallet ?? address} handle={session.user.name} night={night} onDisconnect={signOutAndReload} />;
  }

  return (
    <div className="relative">
      <button type="button" onClick={function connect() { void handleClick(); }} disabled={busy} className={buttonClass(night, busy)}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-hood/50" : "bg-hood"}`} />
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
      {choosing ? (
        <div className="absolute right-0 top-13 z-50 w-[240px] overflow-hidden rounded-2xl border border-line bg-raised p-1.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.35)]">
          <p className="px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">Choose a wallet</p>
          <ul>
            {availableChoices.map(function renderChoice(connector) {
              return (
                <li key={connector.id}>
                  <button
                    type="button"
                    onClick={function pick() {
                      void connectAndSign(connector);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium text-ink transition-colors hover:bg-panel"
                  >
                    {connector.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URI from the extension
                      <img src={connector.icon} alt="" className="h-6 w-6 rounded-md" />
                    ) : (
                      <span aria-hidden="true" className="h-6 w-6 rounded-md bg-panel" />
                    )}
                    {connector.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {helpOpen ? <WalletHelp onClose={function closeHelp() { setHelpOpen(false); }} /> : null}
    </div>
  );
}

// With a Reown project id: the AppKit modal handles wallet choice, QR pairing
// and mobile wallets; the signature step is the same.
function AppKitConnect({ tone = "light" }: ConnectWalletProps) {
  const night = tone === "night";
  const { address, chainId, isConnected } = useAccount();
  const { open } = useAppKit();
  const { signMessageAsync } = useSignMessage();
  const { data: session, isPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);

  async function handleClick(): Promise<void> {
    if (!isConnected || !address || !chainId) {
      await open();
      return;
    }
    setBusy(true);
    try {
      await signInWith(address, chainId, function sign(message) {
        return signMessageAsync({ message });
      });
      afterSignIn();
    } catch (cause) {
      toast.error(friendlyError(cause, "Could not connect your wallet."));
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return <span className="h-9 w-[132px]" />;
  }

  if (session) {
    return <ConnectedPill address={session.wallet ?? address} handle={session.user.name} night={night} onDisconnect={signOutAndReload} />;
  }

  const label = isConnected ? "Sign in" : "Connect wallet";
  return (
    <button type="button" onClick={handleClick} disabled={busy} className={buttonClass(night, busy)}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${busy ? "bg-hood/50" : "bg-hood"}`} />
      {busy ? "Signing…" : label}
    </button>
  );
}

export function ConnectWallet(props: ConnectWalletProps) {
  return HAS_APPKIT ? <AppKitConnect {...props} /> : <InjectedConnect {...props} />;
}
