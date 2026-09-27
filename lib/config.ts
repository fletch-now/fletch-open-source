// Network IDs for the included Robinhood Chain implementation.
export const RH_MAINNET_ID = 4663;
export const RH_TESTNET_ID = 46630;

// Wallets granted the admin role at read time (see lib/dal.ts).
export const ADMIN_WALLETS: string[] = (process.env.ADMIN_WALLETS ?? "")
  .split(",")
  .map(function normalize(wallet: string): string {
    return wallet.trim().toLowerCase();
  })
  .filter(Boolean);

// SIWE binds to this domain; it must match the message the wallet signs.
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "localhost:3000";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// Legacy first-build grant for accounts predating the starter-credit rollout.
export const FREE_BUILD_GRANT = 3;
export const STARTER_CREDITS = 1;

// Credits are bought with USDG on Robinhood Chain; the price itself lives in
// lib/payments/usdg.ts, next to the code that reads receipts. This is the
// example pack the pricing page shows.
export const CREDIT_PACK = {
  credits: 25,
  priceUsdg: 10,
  label: "25 build credits",
};

// Generated apps are hosted after the owner requests publication. Auth cookies
// remain host-only; user apps do not share the dashboard session.
export const APPS_DOMAIN = process.env.NEXT_PUBLIC_APPS_DOMAIN ?? "apps.example.com";

// The public organisation. Every repository under it is MIT or CC BY and
// links back here; nothing private is mirrored there.
export const GITHUB_URL = "https://github.com/fletch-now";

export const X_URL = "https://x.com/fletch_now";
export const TELEGRAM_URL = "https://t.me/fletch_now";
