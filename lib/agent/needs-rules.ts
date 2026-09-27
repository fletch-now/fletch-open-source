// The needs analysis, decided before the agent writes a file: does this app
// need a contract, and does it need a wallet. Pure rules here (no server
// imports) so they can be unit-tested; the model call lives in needs-analysis.ts.

export type NeedsSource = "model" | "existing" | "fallback";

export interface NeedsVerdict {
  contract: boolean;
  wallet: boolean;
  reason: string;
  source: NeedsSource;
}

export const NEEDS_SYSTEM_PROMPT = `You decide the architecture of a small web3 app for Robinhood Chain before it is built. Answer with one JSON object and nothing else: {"contract": boolean, "wallet": boolean, "reason": string}.

A smart contract is an on-chain execution and state engine, not a database or a settings file.
contract=false when the app only: reads public chain metrics (gas price, block times, chain id, RPC health); reads existing ERC-20 or ERC-721 balances, metadata, supply or transfers; reads DEX prices, Chainlink feeds or Uniswap pool state; stores the person's own settings, watchlists, thresholds, alert keys (those live in the browser).
contract=true only when the app needs: a new token, vault or DeFi protocol; escrow, pooled funds, bets, games or votes between people; custom access control; any state that must be shared between people and verifiable on chain.
wallet=false when nobody has anything to sign. wallet=true when the app sends transactions (a contract app always needs one; a read-only app never does).
reason: one sentence, under 140 characters, naming the deciding fact.`;

// The verdict as a decided instruction for the build prompt, not advice.
export function needsDirective(verdict: NeedsVerdict): string {
  if (verdict.source === "existing") {
    return "Decided for this build: the app already has a contract; keep it and change only what the request asks for.";
  }
  const lines = ["Decided for this build, after a needs analysis you must follow:"];
  if (verdict.contract) {
    lines.push("- A contract is needed. Write it in contracts/ with tests in test/.");
  } else {
    lines.push("- No contract. Write the front end only; contracts/ and test/ must not exist. Read the chain through a viem public client.");
  }
  if (verdict.wallet) {
    lines.push("- A wallet connection is needed for the actions that sign.");
  } else {
    lines.push("- No wallet connection: no connect button, no wagmi connectors, no useAccount or useConnect; nothing is signed.");
  }
  lines.push(`- Reason: ${verdict.reason}`);
  return lines.join("\n");
}

// One line for the console.
export function needsLine(verdict: NeedsVerdict): string {
  if (verdict.source === "existing") {
    return "Needs analysis: the app already has a contract, keeping it";
  }
  const shape = verdict.contract ? "contract app" : "read-only app, no contract";
  const wallet = verdict.wallet ? "wallet for signing" : "no wallet";
  const source = verdict.source === "fallback" ? " (analysis unavailable, agent decides)" : "";
  return `Needs analysis: ${shape}, ${wallet}${source}. ${verdict.reason}`;
}

// The model's answer, or null when it is not a usable verdict. Fenced JSON and
// stray prose around the object are tolerated; anything else is a miss.
export function parseVerdict(text: string): Omit<NeedsVerdict, "source"> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.contract !== "boolean" || typeof record.wallet !== "boolean") {
    return null;
  }
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 200) : "";
  // A contract app always has something to sign.
  return { contract: record.contract, wallet: record.contract || record.wallet, reason: reason || "No reason given." };
}

// Code that connects a wallet. Any of these in the front end of a no-wallet
// app is a violation of the verdict.
export const WALLET_MARKERS: RegExp[] = [/\bWalletProvider\b/, /\bWalletControl\b/, /\buseConnect\b/, /\buseAccount\b/, /\buseWriteContract\b/, /\bconnect\(\s*\{/, /\binjected\(\)/, /\bwalletConnect\(/, /\bWagmiProvider\b/, /\bcreateWalletClient\b/];

export function hasWalletCode(source: string): boolean {
  return WALLET_MARKERS.some(function matches(marker) {
    return marker.test(source);
  });
}

export function needsRepairPrompt(verdict: NeedsVerdict, violations: string[]): string {
  const list = violations.map(function line(violation, index) {
    return `${index + 1}. ${violation}`;
  });
  return `The needs analysis for this app decided: ${verdict.contract ? "a contract is needed" : "no contract"}, ${verdict.wallet ? "a wallet is needed" : "no wallet connection"}. Reason: ${verdict.reason}

What you wrote breaks that decision:
${list.join("\n")}

Fix it now: ${verdict.contract ? "" : "delete contracts/ and test/ and everything that reads from a contract address; "}${verdict.wallet ? "" : "remove every wallet connector, connect button, useAccount and useConnect, and read through a viem public client on the public RPC; "}keep the rest of the app as it is. Then stop with one sentence.`;
}
