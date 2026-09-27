import type { DocPage } from "./content";
import { PRODUCT_TERMS } from "@/lib/product-terms";

export interface RoadmapItem {
  title: string;
  description: string;
}

export interface RoadmapStage {
  id: "shipped" | "now" | "next" | "later";
  title: string;
  status: string;
  description: string;
  items: readonly RoadmapItem[];
  links: readonly { href: string; label: string }[];
}

export const ROADMAP_STAGES: readonly RoadmapStage[] = [
  {
    id: "shipped",
    title: "Shipped",
    status: "Available today",
    description: "Available capabilities.",
    items: [
      {
        title: "Publish when ready",
        description: "Save an isolated build preview and click Publish live app to host it. Submit an optional app-directory listing for review, manage its description and linked token, or withdraw it while keeping the app hosted."
      },
      {
        title: "Prompts and briefs",
        description: "Build apps from prompts and attached briefs using the shared design and wallet foundation. Choose a platform model or your own model connection and keep source files and recorded progress in a project."
      },
      {
        title: "Tested contracts and published apps",
        description: "Run Foundry compilation and executable tests, record Slither analysis, deploy a selected contract to Robinhood Chain testnet and publish a front end at its own HTTPS address. Each stage keeps its recorded result."
      },
      {
        title: "Saved progress and build controls",
        description: "See queue position, cancel a queued build or restore its draft with Edit. Stop running work while retaining source and an earlier publication. Continue with saved requests, task notes and conversation summaries. Reconnect after closing the tab or a website restart."
      },
      {
        title: "Watchers and delivery records",
        description: "Configure transfer, registry-event, app-listing, token-event and new-pool watchers. Recorded matches appear in the dashboard; Telegram and signed webhooks are optional delivery channels."
      },
      {
        title: "Token markets and recorded readings",
        description: "Compare listed and priority community tokens in paginated Markets. Inspect full addresses, trust verdicts, same-name alternatives and each metric's source and time. Selected pools have rolling swap coverage and supported USD valuations; unavailable readings remain explicit."
      },
      {
        title: "API and AI access",
        description: "Use the public API, SDK source, registry snapshots and GitHub-installed MCP server. Read the same documentation through the website, Markdown export and AI skill."
      }
    ],
    links: [
      {
        href: "/docs/quickstart-build",
        label: "Build an app"
      },
      {
        href: "/docs/quickstart-watch",
        label: "Set up a watcher"
      },
      {
        href: "/registry/markets",
        label: "Compare token markets"
      },
      {
        href: "https://github.com/fletch-now",
        label: "Public repositories"
      }
    ]
  },
  {
    id: "now",
    title: "Now",
    status: "Work in progress",
    description: "Work in progress.",
    items: [
      {
        title: "Wallet-owned mainnet apps",
        description: "Deploy a checked contract through your wallet, prepare its mainnet frontend and choose a watcher for its supported events. Keep hosting and directory submission as separate choices."
      },
      {
        title: "App interactions",
        description: "Generated apps whose purchases, owner actions and claims work with the intended wallets and contract clocks."
      },
      {
        title: "Confirmed alert delivery",
        description: "Watch alerts with an inspected matching transaction and confirmed arrival at the linked destination, including community tokens, lookalikes and new pools."
      },
      {
        title: "Recurring token coverage",
        description: "More complete token readings through recurring metadata, pool-state and holder updates, with clear reasons for missing prices or historical coverage."
      },
      {
        title: "The $FLETCH token",
        description: "$FLETCH for platform usage credits, gallery rewards and watcher capacity. Mechanism details are to be announced."
      },
      {
        title: "Packaged developer tools",
        description: "CLI, SDK and MCP installation through npm, with packaged Claude Code and Cursor skills."
      },
      {
        title: "Builder subscription",
        description: `A $${PRODUCT_TERMS.plannedBuilder.monthlyUsd}/month Builder subscription with ${PRODUCT_TERMS.plannedBuilder.monthlyCredits} monthly credits and rollover, custom domains, queue priority, ${PRODUCT_TERMS.plannedBuilder.watchers} watchers and repository export.`
      },
      {
        title: "Team workspaces and scale",
        description: "Team workspaces and roles, dedicated build capacity, higher API and watcher limits, email delivery, volume invoicing, a named contact and machine-paid API calls through x402."
      },
      {
        title: "More build capacity",
        description: "More simultaneous builds and recovery onto another host as capacity grows."
      }
    ],
    links: [
      {
        href: "/docs/build",
        label: "Current Build behavior"
      },
      {
        href: "/registry/status",
        label: "Current data coverage"
      }
    ]
  },
  {
    id: "next",
    title: "Next",
    status: "Planned next",
    description: "Planned capabilities. Delivery dates have not been set.",
    items: [
      {
        title: "Longer builds and project memory",
        description: "Broader recovery from interrupted tool and model requests, steering during work and longer build acceptance. Saved history and context compaction are available; uncertain side effects still need reconciliation."
      },
      {
        title: "Build sizes and budgets",
        description: "Small, Medium and Large build prices with an estimate and a maximum budget you accept before starting."
      },
      {
        title: "Multi-contract apps and design themes",
        description: "Multi-contract apps with owner setup panels, plus selectable design themes before a build starts."
      },
      {
        title: "More alerts and destinations",
        description: "Arbitrary ABI-decoded event webhooks, price alerts and Slack or Discord destinations."
      },
      {
        title: "Wallet credit payments",
        description: "USDG credit purchases from your signed-in wallet, with transaction reconciliation and recovery."
      },
      {
        title: "App gallery and remixing",
        description: "Expand the public app directory with categories and templates, usage rankings, one-click remix and author credit."
      },
      {
        title: "Broader markets and trust signals",
        description: "Rolling 24-hour swap coverage across more pools and historical quote currencies, canonical bridge and second-issuer trust stamps, verified-token quotes and a premium-to-feed comparison."
      }
    ],
    links: []
  },
  {
    id: "later",
    title: "Later",
    status: "Planned for later",
    description: "No additional items are scheduled here.",
    items: [],
    links: []
  }
];

export const roadmapDocPage: DocPage = {
  slug: "roadmap",
  title: "Roadmap",
  description: "Available capabilities and planned improvements for Build, Watch and Registry.",
  next: "faq",
  sections: ROADMAP_STAGES.map(function section(stage) {
    return {
      title: stage.title,
      paragraphs: [stage.description],
      bullets: stage.items.map(function item(item) {
        return `${item.title}. ${item.description}`;
      }),
      links: stage.links,
    };
  }),
};
