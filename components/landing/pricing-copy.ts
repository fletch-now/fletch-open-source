import type { Plan } from "@/components/landing/plan-card";
import { TELEGRAM_URL } from "@/lib/config";
import { CHECKOUT_DESCRIPTION, PRODUCT_TERMS, STARTER_CREDIT_DESCRIPTION } from "@/lib/product-terms";

// Owner-approved landing prices. Deployment and billing configuration are separate.

export const PLANS: Plan[] = [
  {
    number: "01",
    name: "Free",
    description: "For a first app and a first alert",
    price: "$0",
    priceNote: "wallet sign-in, no card",
    features: [
      STARTER_CREDIT_DESCRIPTION,
      "A failed compile refunds its credit",
      "A saved preview, with hosting when you click Publish live app",
      `${PRODUCT_TERMS.watchersPerAccount} watchers for supported mainnet events`,
      "The public registry, every token page, and an API key",
    ],
    cta: { label: "Start free", href: "/dashboard/build" },
    highlight: false,
    badge: "BETA",
  },
  {
    number: "02",
    name: "Builder",
    description: "For shipping something every week",
    price: `$${PRODUCT_TERMS.plannedBuilder.monthlyUsd}/mo`,
    priceNote: "planned subscription; checkout is not open",
    features: [
      `${PRODUCT_TERMS.plannedBuilder.monthlyCredits} build credits a month, unused ones roll over`,
      "Use your own model API key (also available in beta)",
      "Mainnet deployment with source verification attempts",
      "Hosted apps at your own domain",
      "Front of the sandbox queue",
      `${PRODUCT_TERMS.plannedBuilder.watchers} watchers, with Telegram or webhook delivery`,
      "Build history exported as a repository",
    ],
    highlight: true,
    badge: "PLANNED",
    state: "Planned. The current beta is available while subscriptions are being prepared.",
  },
  {
    number: "03",
    name: "Desk",
    description: "For a team that works on one chain",
    price: "Coming soon",
    priceNote: "invoiced in USDG, priced on volume",
    features: [
      "A shared workspace with roles",
      "Dedicated sandbox capacity",
      "Watchers beyond the cap, Slack and email delivery",
      "API keys with higher limits, machine-payable per call (x402)",
      "A named contact",
    ],
    cta: TELEGRAM_URL ? { label: "Talk to us", href: TELEGRAM_URL } : undefined,
    highlight: false,
    badge: "FOR TEAMS",
  },
];

export const NOTES = [
  "Wallet sign-in, no card",
  "A failed compile refunds its platform credit",
  "The source is yours to take anywhere",
];

export const PRICING_INTRO = `Start with ${STARTER_CREDIT_DESCRIPTION}. ${CHECKOUT_DESCRIPTION} A failed charged build refunds its Fletch credit.`;
