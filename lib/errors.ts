// Wallet and RPC libraries throw messages written for developers — viem appends
// "Details: …" and "Version: viem@x.y.z", which should never reach a user. This
// maps the common cases to plain sentences and strips the debug tail from the rest.

const PATTERNS: Array<{ test: RegExp; message: string }> = [
  { test: /user rejected|user denied|rejected the request/i, message: "You declined the request in your wallet." },
  { test: /error attempting to sign|signing failed|sign message failed/i, message: "Your wallet could not sign the message. Open the wallet, make sure it is unlocked, and try again." },
  { test: /chain not supported|not supported by the wallet|unsupported network/i, message: "Your wallet does not list Robinhood Chain. Sign-in still works; add the chain before paying or deploying." },
  { test: /connector not found|no injected|no ethereum provider/i, message: "No browser wallet found. Install MetaMask to continue." },
  { test: /already pending|request already/i, message: "Check your wallet — a request is already open." },
  { test: /chain mismatch|does not match the target chain|unsupported chain|unrecognized chain/i, message: "Wrong network. Switch to Robinhood Chain and try again." },
  { test: /insufficient funds/i, message: "Not enough ETH to cover gas." },
  { test: /nonce too low|replacement transaction/i, message: "That transaction was already submitted." },
  { test: /timeout|timed out/i, message: "The network took too long to respond." },
  { test: /failed to fetch|network ?error|load failed/i, message: "Could not reach the server. Check your connection." },
];

export function friendlyError(cause: unknown, fallback = "Something went wrong."): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  if (!raw) {
    return fallback;
  }
  for (const pattern of PATTERNS) {
    if (pattern.test.test(raw)) {
      return pattern.message;
    }
  }
  // Keep the first line only — everything from "Details:"/"Version:" is debug noise.
  const [firstLine] = raw.split(/\n|Details:|Version:/);
  const trimmed = firstLine.trim();
  if (!trimmed || trimmed.length > 140) {
    return fallback;
  }
  return trimmed;
}
