"use client";

import { Component, type ReactNode } from "react";

interface WalletBoundaryProps {
  children: ReactNode;
}

interface WalletBoundaryState {
  failed: boolean;
}

// The wallet SDKs initialise against a remote service on load. When that throws
// (a rejected project id, a blocked network, a stale cached session) the error used
// to climb to the page boundary and replace the whole dashboard with "That didn't
// load". A wallet button that cannot start is a wallet button that says so; the
// rest of the page has nothing to do with it.
export class WalletBoundary extends Component<WalletBoundaryProps, WalletBoundaryState> {
  state: WalletBoundaryState = { failed: false };

  static getDerivedStateFromError(): WalletBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error("Wallet UI failed to start", error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <span
          title="The wallet connector could not start. Reload the page to try again."
          className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] text-ink-faint"
        >
          Wallet unavailable
        </span>
      );
    }
    return this.props.children;
  }
}
