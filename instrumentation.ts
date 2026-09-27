// Runs once when the server starts. Configuration mistakes that would otherwise
// surface as a broken wallet sign-in hours later are caught here instead.

// SIWE binds the signature to APP_DOMAIN. If it silently falls back to localhost
// in production, every sign-in fails verification — the exact class of bug that is
// invisible until a real user tries to connect.
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_DOMAIN",
];

// Smoke-testing the production build on a laptop is a real need, and the checks
// below would otherwise refuse to start. The escape hatch requires an explicit
// opt-in AND an app URL pointing at localhost, so it can never engage on a real
// deployment — those have a real domain by definition.
function isLocalProductionRun(): boolean {
  if (process.env.FORGE_ALLOW_LOCAL_PROD !== "1") {
    return false;
  }
  // Parsed, not substring-matched: "https://localhost.attacker.com" contains
  // "localhost" and would otherwise unlock the escape hatch on a real deployment.
  try {
    const host = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const localRun = isLocalProductionRun();
  if (localRun) {
    console.warn(
      "Local production run: domain and dev-login checks are relaxed because NEXT_PUBLIC_APP_URL is localhost. Never set FORGE_ALLOW_LOCAL_PROD on a deployed instance.",
    );
  }

  const missing = REQUIRED_IN_PRODUCTION.filter(function unset(name) {
    return !process.env[name];
  });
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing required environment ${missing.join(", ")}. See .env.example.`,
    );
  }

  if (process.env.FORGE_DEV_LOGIN === "1" && !localRun) {
    throw new Error(
      "Refusing to start: FORGE_DEV_LOGIN=1 is a full admin backdoor and must never be set in production.",
    );
  }

  if (process.env.NEXT_PUBLIC_APP_DOMAIN?.includes("localhost") && !localRun) {
    throw new Error(
      "Refusing to start: NEXT_PUBLIC_APP_DOMAIN is localhost, which breaks SIWE signature verification.",
    );
  }

  // Not fatal: the product runs without purchases, and the pay flow says so. A
  // malformed address is fatal, because real USDG would be sent to it.
  const treasury = process.env.FLETCH_TREASURY_ADDRESS ?? "";
  if (!treasury) {
    console.warn("FLETCH_TREASURY_ADDRESS is not set: credit purchases are disabled.");
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(treasury)) {
    throw new Error("Refusing to start: FLETCH_TREASURY_ADDRESS is not a 0x address of 40 hex characters.");
  }
  // The single-call builder compiles nothing and verifies nothing. Reaching it in
  // production means shipping unverified output under a product that promises the
  // opposite, so a missing FORGE_AGENT is a refusal rather than a quiet downgrade.
  if (process.env.MOONSHOT_API_KEY && process.env.FORGE_AGENT !== "cli") {
    throw new Error(
      "Refusing to start: a model key is set but FORGE_AGENT is not 'cli', which would run the non-verifying single-call builder.",
    );
  }

  if (process.env.FORGE_AGENT === "cli" && process.env.FORGE_AGENT_SANDBOX !== "docker") {
    throw new Error(
      "Refusing to start: FORGE_AGENT=cli without FORGE_AGENT_SANDBOX=docker executes model-authored code directly on this host.",
    );
  }
  if (process.env.FORGE_AGENT_SANDBOX === "docker" && !process.env.FORGE_AGENT_IMAGE) {
    throw new Error("Refusing to start: FORGE_AGENT_SANDBOX=docker but FORGE_AGENT_IMAGE is not set, so nothing could run in a sandbox.");
  }

  // Guarded import so the edge bundle never traces the db modules.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const mod = await import("@/instrumentation-node");
    await mod.startBuildServices();
  }
}
