import type { NextConfig } from "next";

// A wallet-signing app must not be frameable: an attacker who can iframe it can
// overlay their own UI on top of a real sign-in prompt. The rest are the standard
// hardening headers; HSTS is added only in production, where TLS is guaranteed.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // NOT "same-origin": that severs window.opener, and the wallet SDKs (Coinbase
  // Smart Wallet, WalletConnect) sign in through a popup that talks back to this
  // page. "allow-popups" keeps the cross-origin isolation that matters — other
  // origins still cannot get a handle on this window — while letting popups this
  // page opens keep their opener reference.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // frame-ancestors is the modern equivalent of X-Frame-Options and is the one
  // browsers honour when both are present. Kept narrow deliberately: a full CSP
  // needs the wallet SDKs' origins enumerated first, or sign-in silently breaks.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Telegram also uses a plain TelegramBot UA. It must receive the metadata in
  // the initial head just like Twitter and the other non-JavaScript crawlers.
  htmlLimitedBots: /bot|Google|Lighthouse|Slurp|spider|bitly|tumblr|vkShare|preview|ia_archiver|facebookexternalhit|facebookcatalog|WhatsApp|Yeti|weblight/i,
  // Emit a self-contained server (.next/standalone) for a small Docker image and a
  // long-running Node process (required for SSE build streaming).
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./.git/**/*", "./.local/**/*", "./release-config/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/v1/docs/assets/*": [
      "./node_modules/swagger-ui-dist/swagger-ui.css",
      "./node_modules/swagger-ui-dist/swagger-ui-bundle.js",
      "./node_modules/swagger-ui-dist/swagger-ui-standalone-preset.js",
    ],
  },

  // The registry lived at /tokens; every link and index that learned that
  // address keeps working, permanently, at the new one.
  async redirects() {
    return [
      { source: "/tokens/address/:address", destination: "/registry/markets/:address", permanent: true },
      { source: "/registry/token/:address/:path*", destination: "/registry/markets/:address/:path*", permanent: true },
      { source: "/tokens", destination: "/registry", permanent: true },
      { source: "/tokens/:path*", destination: "/registry/:path*", permanent: true },
    ];
  },

  async headers() {
    const headers = [...SECURITY_HEADERS];
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    // Preview responses supply a per-document sandbox and script nonce. Next's
    // configured headers win over route headers, so keep those policies separate.
    return [
      ...["/dashboard/:path*", "/trafalgar/:path*", "/admin/:path*"].map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] })),
      { source: "/:path((?!api/previews(?:/|$)).*)", headers },
      { source: "/api/previews/:path*", headers: headers.filter(function previewDefaults(header) {
        return !["Content-Security-Policy", "X-Frame-Options", "Referrer-Policy"].includes(header.key);
      }) },
    ];
  },

  // Root-level sitemap URLs cover the entire site before Search Console setup.
  async rewrites() {
    return [{ source: "/sitemap-:kind(site|apps|tokens)-:page(\\d+).xml", destination: "/sitemaps/:kind/:page.xml" }];
  },
};

export default nextConfig;
