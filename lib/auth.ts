import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, customSession, siwe } from "better-auth/plugins";
import { ensureStarterCredit } from "@/lib/starter-credit";
import { walletsForUser } from "@/lib/wallets";
import { db, schema } from "@/lib/db";
import { getPublicClient } from "@/lib/chains";
import { APP_DOMAIN, RH_TESTNET_ID } from "@/lib/config";
import { walletHandle } from "@/lib/names";
import { COOKIE_SECURE, SESSION_COOKIE_PREFIX, USE_SECURE_COOKIE_PREFIX } from "@/lib/auth-cookie";

function chainIdFromSiweMessage(message: string): number {
  // Parse the typed EIP-4361 struct rather than regex-scraping (which could match
  // attacker-controlled statement/resource text and silently pick the wrong chain).
  try {
    return parseSiweMessage(message).chainId ?? RH_TESTNET_ID;
  } catch {
    return RH_TESTNET_ID;
  }
}

// Verifies EOA, ERC-1271, and ERC-6492 signatures via viem's public client,
// which resolves smart-account (AppKit embedded wallet) signatures too.
async function verifySiweSignature(args: {
  message: string;
  signature: string;
  address: string;
}): Promise<boolean> {
  const client = getPublicClient(chainIdFromSiweMessage(args.message));
  try {
    return await client.verifyMessage({
      address: args.address as `0x${string}`,
      message: args.message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

const baseOptions = {
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Wallet-native in prod. Email/password is enabled ONLY for the dev test-login
  // (FORGE_DEV_LOGIN=1) so the authed UI can be clicked through without a wallet.
  emailAndPassword: { enabled: process.env.FORGE_DEV_LOGIN === "1" },
  // See lib/auth-cookie.ts: a __Host- session cookie cannot be set from a
  // subdomain, which is what makes hosting apps under apps.fletch.now safe.
  advanced: {
    cookiePrefix: SESSION_COOKIE_PREFIX,
    useSecureCookies: USE_SECURE_COOKIE_PREFIX,
    defaultCookieAttributes: { secure: COOKIE_SECURE, sameSite: "lax", path: "/" },
  },
  databaseHooks: {
    session: {
      create: {
        after: async function welcome(session): Promise<void> {
          // SIWE verifies the signature and saves the wallet before this hook.
          await ensureStarterCredit(session.userId);
        },
      },
    },
    user: {
      create: {
        // Every wallet account gets a readable handle at creation, so the
        // dashboard and admin list never have to talk about a bare address.
        before: async function nameOnSignup(user) {
          // SIWE fills name with the raw wallet address; that is not a name.
          if (user.name && !/^0x[0-9a-fA-F]{40}$/.test(user.name)) {
            return { data: user };
          }
          return { data: { ...user, name: walletHandle(user.name ?? user.email ?? String(Math.random())) } };
        },
      },
    },
  },
  plugins: [
    siwe({
      domain: APP_DOMAIN,
      anonymous: true,
      getNonce: async function getNonce(): Promise<string> {
        return generateSiweNonce();
      },
      verifyMessage: verifySiweSignature,
    }),
    admin(),
  ],
} satisfies BetterAuthOptions;

// The wallet's address rides on the session so the header can show it before
// wagmi has reconnected, and on pages that never load wagmi at all. The base
// options are handed to the plugin so the admin fields on `user` keep their types.
export const auth = betterAuth({
  ...baseOptions,
  plugins: [
    ...baseOptions.plugins,
    customSession(async function withWallet({ user, session }) {
      const wallets = await walletsForUser(user.id);
      return { user, session, wallet: wallets[0] ?? null };
    }, baseOptions),
  ],
});

export type Session = typeof auth.$Infer.Session;
