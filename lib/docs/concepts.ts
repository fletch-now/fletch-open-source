import type { DocPage } from "./content";
import { BUILD_WATCH_NETWORK_DESCRIPTION, STARTER_CREDIT_DESCRIPTION } from "@/lib/product-terms";

export const overviewDocPage: DocPage = {
  slug: "", title: "What Fletch is", next: "why",
  description: "Describe an app, build it on Robinhood Chain testnet and inspect its source, test results and hosted page.",
  sections: [
    { title: "Available in this beta",
      paragraphs: [
        `Start with ${STARTER_CREDIT_DESCRIPTION}. Write or choose a prompt, review it in Build, and click Ship to start. You can also connect your own provider API key in Settings and select Use in Build for zero Fletch-credit charging; the provider bills your usage.`,
        BUILD_WATCH_NETWORK_DESCRIPTION,
        "Completed builds save a preview. Click Publish live app to host the saved app, then submit a separate directory listing if you want it to appear in Published apps. Approved token listings include the ticker, contract and recorded metadata check.",
        "Watch records matches in your dashboard, with optional Telegram and webhook delivery. Registry data and the public app directory are available as JSON. The developer reference, OpenAPI and agent skill describe their current interfaces.",
      ],
      links: [{ href: "/published", label: "Published apps" }, { href: "/developers", label: "Developer reference" }, { href: "/skill.md", label: "Agent skill" }],
    },
    { title: "Start with an app",
      paragraphs: [
        "Open Build, connect your wallet and describe what the app should do. Attach a longer brief when needed, choose a model connection and submit. Fletch writes the source, checks it with the toolchain and records the result of each deployment or publication step.",
        "Start with the Build quickstart. Watch can follow token events after you close the tab, and the API returns recorded addresses, trust verdicts and market observations for apps that need chain data.",
      ],
      links: [{ href: "/docs/quickstart-build", label: "Quickstart: build an app" }, { href: "/docs/quickstart-watch", label: "Quickstart: watch a token" }, { href: "/docs/quickstart-api", label: "Quickstart: use the API" }],
    },
    { title: "What Fletch handles",
      paragraphs: [
        "The builder comes with Robinhood Chain configuration, a hosted workspace, RPC access and an app subdomain. Its agent resolves token addresses and market facts on demand when the brief needs them.",
        "For contract builds, Foundry compiles the source and runs executable tests, and Slither records its analysis. Deployment records the transaction and contract address. Publication records the hosted URL after an HTTPS check. Open the reports and test the app's required actions on the stated network.",
        "Accepted builds run under an independent worker and save their progress. Reopen the project to reconnect to the same run. Watchers also run on the server, with stored checkpoints and delivery records.",
      ],
      links: [{ href: "/docs/why", label: "How the product works" }, { href: "/docs/build", label: "Build manual" }, { href: "/docs/persistence", label: "Saved progress and alerts" }],
    },
    { title: "Networks and current limits",
      paragraphs: [
        "The hosted builder currently deploys contracts to Robinhood Chain testnet, chain 46630. Registry and Watch follow mainnet, chain 4663. Confirm the network before signing an app transaction.",
        "Current time limits, billing and feature availability are listed together in Limits. Registry & Markets explains each data source and its observation time, including missing or incomplete readings.",
      ],
      links: [{ href: "/docs/limits", label: "Current limits and pricing" }, { href: "/docs/markets", label: "Registry & Markets" }, { href: "/docs/roadmap", label: "Available capabilities and planned work" }],
    },
  ],
};

export const whyDocPage: DocPage = {
  slug: "why", title: "Why it is different", next: "build",
  description: "Four product ideas, with the mechanism and a result you can inspect for each.",
  sections: [
    { title: "Token identity and evidence",
      paragraphs: [
        "A ticker is a claim made by a contract. Fletch keeps the issuer's listing separate from discovered tokens, checks contract metadata against the listing and compares other tokens with those verified identities. Stock Token canonical checks go further: the job reads the beacon storage slot and compares its address with the issuer registry.",
        "Search CASHCAT in Markets to compare their complete addresses. Separate contracts can use the same name; each has its own address and pool observations. Compare the measured depth, available activity and reading times. The lookalike scanner records beacon dependencies, but a matching beacon cannot establish issuer deployment. Official listing or separately verified deployment evidence is required for an issuer-origin claim. The verified badge requires listing and matching contract metadata.",
      ],
      links: [{ href: "/registry/markets?q=cashcat", label: "Compare CASHCAT contracts" }, { href: "/registry/lookalikes", label: "Inspect recorded lookalike checks" }, { href: "/docs/truth-oracle", label: "How the Registry supplies evidence" }],
    },
    { title: "Build checks and their limits",
      paragraphs: [
        "For a contract build, Foundry compiles the source and runs executable tests; Slither records its static-analysis result. The pipeline requires these results before deployment. The console keeps the toolchain verdict visible while the agent's explanation and steps can be folded away.",
        "The Build chapter includes Quiet Garden's Vite result and published frontend. For a contract build, inspect the deployed address and transaction alongside its toolchain reports.",
      ],
      links: [{ href: "/docs/build", label: "Read the pipeline and worked example" }, { href: "/docs/compiler", label: "Understand each toolchain result" }],
    },
    { title: "Managed testnet builds and hosting",
      paragraphs: [
        "A build gets a server workspace, a prepared app foundation and isolated toolchain containers. Fletch manages RPC access and testnet deployment, publishes the front end, checks its HTTPS response and restores the previous publication if confirmation fails.",
        "The public app in the Build example opens at its own apps.fletch.now address. Its owner did not need to configure that hostname or a web server for the build. You still inspect the app's behavior and choose which wallet transactions to sign; hosting does not prove a raffle's draw or a vault's withdrawal works.",
      ],
      links: [{ href: "/docs/infrastructure", label: "What Fletch operates for a build" }, { href: "/dashboard/build", label: "Open the workspace" }],
    },
    { title: "Saved progress and background work",
      paragraphs: [
        "Accepted builds live in the Postgres queue and run under an independent worker. Watch stores block checkpoints and matched events in a delivery outbox. Reopening a browser reads those records; it does not create another model request or replay every matched event.",
        "Watch checks the checkpoint hash, rewinds up to 64 blocks after a mismatch and retracts pending deliveries above the rewind point before rescanning. Unit tests cover the rewind calculation. The released worker tests also cover a process disappearing after a deployment starts: the job is held for reconciliation instead of sending an uncertain transaction again. The worker checks use controlled failure fixtures. Alert acceptance needs its matching transaction and delivery record to establish end-to-end delivery.",
      ],
      links: [{ href: "/docs/persistence", label: "Queue, checkpoints and recovery" }, { href: "/registry/status", label: "Inspect the running jobs" }, { href: "/docs/watch", label: "Follow the Watch loop" }],
    },
  ],
};

export const conceptDocPages: readonly DocPage[] = [
  {
    slug: "truth-oracle", title: "Token identity and evidence", next: "compiler",
    description: "Recorded addresses and observations give the agent a chain it can query.",
    sections: [
      { title: "From a source to a usable fact", diagram: "data",
        paragraphs: [
          "Fletch records the chain configuration and deployment addresses the builder needs in chain facts. The registry imports Robinhood's listings, checks contract metadata and stores observations from the chain. Discovery stores other tokens separately so appearing in a pool never turns a token into an issuer listing.",
          "Jobs write their results and progress to Postgres. Pages, JSON responses, MCP tools and alerts read those records. A block number or timestamp travels with the observation; the interface can show when the value was read and whether the requested history is covered.",
        ],
      },
      { title: "Give the agent the relevant facts",
        paragraphs: [
          "Every build receives chain configuration, contract guidance and short instructions for querying Fletch. A token or market question can fetch the relevant endpoint on demand. This keeps a simple app request from carrying a dump of unrelated pools.",
          "Resolve the complete address, inspect the trust verdict and keep the observation time. For market data, also inspect stateCurrent and coverage. An unread price is a missing input; the agent must leave it empty or explain that its read is still needed.",
        ],
        code: "curl --fail-with-body https://fletch.now/api/v1/status\ncurl --fail-with-body https://fletch.now/api/v1/tokens/0x6bac06600d220ac5ac281ad1f504d2cf0f90f6e6",
      },
      { title: "Identity, price and coverage answer different questions",
        paragraphs: [
          "The verified badge comes from listing and metadata checks. Stock Token beacon observations provide a separate canonical check. A feed answer and a DEX price describe different sources, and each can become stale. Complete rolling activity requires counted logs across the whole window.",
          "A known name can therefore sit beside an unread price or a partial holder ledger. Follow the source and coverage rather than filling the gap with the current price from another pool. The registry reading chapter lists the actual jobs and their intervals.",
        ],
        links: [{ href: "/docs/registry-reading", label: "How the registry reads the chain" }, { href: "/docs/trust", label: "The five current trust verdicts" }],
      },
    ],
  },
  {
    slug: "compiler", title: "Build checks and their limits", next: "infrastructure",
    description: "Read compilation, tests, analysis, deployment and publication as separate results.",
    sections: [
      { title: "The verdict comes from the program that ran",
        paragraphs: [
          "The agent writes code and explains its choices. Foundry compiles it, the test runner executes its tests and Slither analyzes the contracts. The pipeline stores these results and uses them to decide whether deployment may proceed. A model saying the work is finished cannot substitute for a missing report.",
          "Repairs have bounded stages. A compiler error, failed test or blocking security finding can give the agent another pass with the actual error output. Required checks run again against the repaired source before a contract can deploy. The Build manual shows the full order and the per-stage evidence.",
        ],
      },
      { title: "Read the scope of each result",
        table: { headings: ["Result", "What it establishes"], rows: [
          ["Compiled", "The compiler accepted that source with the recorded settings."],
          ["Tests passed", "The executable tests ran and passed. Their assertions define the behavior exercised."],
          ["Slither result", "Static analysis ran and returned the recorded findings. It is a separate check from tests."],
          ["Deployment receipt", "The recorded transaction created the selected contract on the named chain."],
          ["Source verification", "The explorer accepted the verification attempt when a verified result is recorded."],
          ["Published", "The front-end build was published and its served page returned HTTP 200."],
        ] },
      },
      { title: "Check the app's own actions",
        paragraphs: [
          "Open the app on the stated network and exercise its required actions with the appropriate wallets. For a raffle, follow ticket purchase, draw conditions and pot claims.",
          "Keep the exact toolchain result when describing the app to another person or agent. Source verification is attempted after deployment and can fail independently while the deployed contract remains. The console records that distinction.",
        ],
        links: [{ href: "/docs/build", label: "Pipeline, repairs and the verdict line" }, { href: "/docs/limits", label: "Current verification and execution limits" }],
      },
    ],
  },
  {
    slug: "infrastructure", title: "Managed testnet builds and hosting", next: "persistence",
    description: "The hosted build path includes a workspace, toolchain, RPC access and app publication.",
    sections: [
      { title: "The prepared workspace",
        paragraphs: [
          "A build starts with the versioned front-end foundation, loaded fonts, design tokens, chain-data helpers and one wallet component. The agent receives design guidance and chooses a palette suited to the request. Explicit user design choices steer those defaults.",
          "The sandbox keeps generated code away from the host application. Its root filesystem is read-only and Linux capabilities are dropped; the project workspace is writable. Compiler and analyzer containers run without a network. The agent container uses Docker networking for model requests and other network tools.",
        ],
      },
      { title: "Credentials and wallet transactions",
        paragraphs: [
          "The upstream provider key stays behind a credential proxy. The agent uses a scoped temporary credential, and generated user code receives no upstream model key. A saved hosted key is encrypted in storage; operators with the server and encryption material can access it. The connection form explains that custody before you save it.",
          "Generated signing apps use the shared EVM wallet component. It discovers compatible injected providers, including Phantom, while WalletConnect depends on the platform's Reown configuration. Available providers and wallet chain support determine what the user can connect. The user approves their own app transactions in their wallet.",
        ],
        links: [{ href: "/docs/build", label: "Model connections and wallet behavior" }],
      },
      { title: "Deployment and hosting",
        paragraphs: [
          "The hosted builder can deploy its selected contract to Robinhood Chain testnet and record the address and transaction. It then attempts explorer source verification and saves the built frontend as an isolated preview. The owner clicks Publish live app to host the saved bundle at an apps.fletch.now address. Publication changes the served files atomically and records the HTTP check.",
          "A failed edit preserves the previous published version. Files and the build record remain available for inspection. Mainnet availability, custom domains and checkout have separate status on the limits and roadmap pages.",
        ],
        links: [{ href: "/docs/limits", label: "Deployment and payment availability" }, { href: "/docs/roadmap", label: "Planned hosting and deployment options" }],
      },
    ],
  },
  {
    slug: "persistence", title: "Saved progress and background work", next: "agents",
    description: "Server ownership and stored progress let work outlive the browser that requested it.",
    sections: [
      { title: "A build has an owner", paragraphs: [
        "Submitting a build records it in Postgres. An independent worker claims accepted jobs within the shared execution limit shown in the queue, with one build owning a project at a time. The web process reads the job and its progress, so closing the browser or restarting the web application does not stop the worker's execution.",
        "Queued builds show position and allow Cancel or Edit before ownership is claimed. A running build shows saved steps and an activity indicator. Reopening a project reads its saved events; a dropped connection resumes from the last received event. The browser observes the existing run.",
      ] },
      { title: "Stopping and recovering", paragraphs: [
        "Stop records a cancellation request, revokes access to the provider proxy and asks the execution owner to end the build's containers. The console remains Stopping while cleanup is being confirmed. Saved source and an earlier publication remain available.",
        "The worker records source checkpoints and the preparation and outcome of deployment or publication. If it disappears with an uncertain external action, the run is held for reconciliation. An operator checks the recorded transaction or publication identity before resolving that state. A paused run is shown as paused; it does not keep claiming to work.",
        "One agent turn currently has a 45-minute timeout. A build can include several stages and repair turns, but the release has no five-hour continuous-run acceptance. The limits and roadmap pages explain the remaining recovery and steering work.",
      ], links: [{ href: "/docs/build", label: "Queue, Stop and saved progress" }, { href: "/docs/limits", label: "Execution and recovery limits" }] },
      { title: "Watch has a checkpoint and an outbox", paragraphs: [
        "The Watch daemon reads logs from its stored block checkpoint, matches enabled conditions and commits delivery records. Delivery is a separate loop with deduplication and bounded retries. A temporary Telegram or webhook error leaves a recorded status that can be inspected in Alerts.",
        "Watch checks the checkpoint block hash. A replacement hash triggers a rewind of up to 64 blocks and retracts pending deliveries above that point before rescanning. Already delivered messages remain in the recipient's chat. These observations are sequencer-confirmed and can be replaced before finality.",
        "Registry jobs have their own checkpoints and rollback behavior. The holder ledger uses a 300-block delay and logs deeper reorganizations for investigation; it does not share Watch's pending-delivery rollback. Check the job's coverage when using holder balances.",
      ], links: [{ href: "/docs/watch", label: "The Watch loop and delivery states" }, { href: "/docs/registry-reading", label: "Each registry job's mechanism" }] },
    ],
  },
];
