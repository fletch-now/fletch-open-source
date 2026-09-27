"use client";

import { useEffect, useId, useRef, type JSX } from "react";
import { APP_URL } from "@/lib/config";

interface Props {
  onClose: () => void;
}

export function WalletHelp({ onClose }: Props): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(function show(): () => void {
    const element = dialog.current!;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return function close(): void {
      element.close();
      document.body.style.overflow = previous;
    };
  }, []);

  async function copyPage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const { toast } = await import("sonner");
      toast.success("Page link copied. Open it in your wallet's browser.");
    } catch {
      const { toast } = await import("sonner");
      toast.error("Copy this page's address from your browser.");
    }
  }

  // The wallet app uses separate browser storage. Carry the current path and
  // prompt in the link, while keeping the destination on Fletch's fixed origin.
  const destination = new URL(APP_URL);
  destination.pathname = window.location.pathname;
  destination.search = window.location.search;
  const walletUrl = `https://metamask.app.link/dapp/${destination.host}${destination.pathname}${destination.search}`;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      onCancel={onClose}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-sm overflow-y-auto rounded-2xl border border-line bg-paper p-5 text-ink shadow-xl backdrop:bg-black/60"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={heading} className="display pt-2 text-xl">
          Connect with a wallet app
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wallet help"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line focus-visible:outline-2 focus-visible:outline-hood"
        >
          ×
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        This browser has no wallet connection. On iPhone or Android, open Fletch
        in your wallet app&apos;s browser, then tap Connect wallet.
      </p>
      <a
        href={walletUrl}
        rel="noreferrer"
        className="mt-5 flex min-h-12 items-center justify-center rounded-full bg-hood px-4 text-sm font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood-deep"
      >
        Open in MetaMask
      </a>
      <p className="mt-3 text-xs leading-5 text-ink-soft">
        If the link opens the wallet home screen, use its Explore tab to open{" "}
        {destination.host}. You can also copy this page into another EVM
        wallet&apos;s browser.
      </p>
      <button
        type="button"
        onClick={function copy() {
          void copyPage();
        }}
        className="mt-3 min-h-11 w-full rounded-full border border-line-strong px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-hood"
      >
        Copy page link
      </button>
      <p className="mt-4 border-t border-line pt-4 text-sm leading-6 text-ink-soft">
        For the most room to build and review your app, use a desktop browser
        with a wallet extension.
      </p>
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Get MetaMask
      </a>
    </dialog>
  );
}
