export interface DiagramNode {
  label: string;
  detail: string;
}

export interface DiagramPath {
  label: string;
  nodes: readonly DiagramNode[];
}

interface DocDiagramModel {
  title: string;
  summary: string;
  paths: Readonly<Record<string, DiagramPath>>;
  note: string;
}

export const docDiagrams = {
  build: {
    title: "From brief to published app",
    summary: "The builder writes the project, checks its outputs, then publishes the frontend. Apps with a contract pass through additional checks and a testnet deployment.",
    paths: {
      start: {
        label: "Every build starts here",
        nodes: [
          { label: "Plan", detail: "Read the brief, files and project context." },
          { label: "Sandbox agent", detail: "Write or update the project files." },
          { label: "Compile", detail: "Check the generated contract sources, when present." },
        ],
      },
      contract: {
        label: "App with a contract",
        nodes: [
          { label: "Contract tests", detail: "Require passing, nonempty tests." },
          { label: "Slither", detail: "Require completed analysis with no High findings." },
          { label: "Deploy receipt", detail: "Confirm the selected contract on testnet." },
          { label: "Explorer attempt", detail: "Submit source for verification; report the result." },
        ],
      },
      frontendOnly: {
        label: "Frontend-only app",
        nodes: [
          { label: "Continue to frontend", detail: "Skip contract tests, Slither and deployment." },
        ],
      },
      finish: {
        label: "Both paths finish here",
        nodes: [
          { label: "Frontend build", detail: "Produce the static app with Vite." },
          { label: "Atomic publish", detail: "Switch the hosted release and require HTTP 200." },
        ],
      },
    },
    note: "Repairs are bounded: one repair round per supported gate. An unresolved required check stops publication. Explorer verification failure is reported and can still allow publication.",
  },
  watch: {
    title: "From chain logs to an alert",
    summary: "Each poll checks its saved block hash, reads new logs and matches the watch rules. Pending alerts and the new scan checkpoint commit together; delivery runs separately.",
    paths: {
      poll: {
        label: "Poll the chain",
        nodes: [
          { label: "Check saved hash", detail: "Compare the checkpoint with the chain." },
          { label: "Read head + logs", detail: "Fetch the next bounded range of Transfer logs." },
          { label: "Match rules", detail: "Apply the wallet, direction and amount filters." },
        ],
      },
      commit: {
        label: "One Postgres transaction",
        nodes: [
          { label: "Pending outbox", detail: "Save matching alerts with a unique event key." },
          { label: "Scan checkpoint", detail: "Save the scanned block number and hash." },
        ],
      },
      delivery: {
        label: "Independent delivery loop",
        nodes: [
          { label: "Deliver", detail: "Claim a pending alert and attempt delivery." },
          { label: "Success or backoff", detail: "Record delivery or schedule a bounded retry." },
        ],
      },
      reorg: {
        label: "If the saved hash differs",
        nodes: [
          { label: "Rewind up to 64 blocks", detail: "Move the checkpoint back, stopping at genesis." },
          { label: "Retract pending alerts", detail: "Retract pending rows above that block, then rescan." },
        ],
      },
    },
    note: "A scan checkpoint does not mean an alert was delivered. Already delivered messages remain after a reorg; they cannot be recalled.",
  },
  data: {
    title: "Where the data comes from",
    summary: "Scheduled jobs read chain and issuer sources into shared Postgres tables. Product pages, JSON responses, MCP tools and alert formatting use those stored records.",
    paths: {
      sources: {
        label: "Inputs",
        nodes: [
          { label: "Chain", detail: "RPC calls, event logs and explorer responses." },
          { label: "Issuer", detail: "Published asset lists and tracked documents." },
        ],
      },
      storage: {
        label: "Read and store",
        nodes: [
          { label: "Scheduled jobs", detail: "Sync, probe, index and record changes." },
          { label: "Postgres", detail: "Keep records, source details and read times." },
        ],
      },
      readers: {
        label: "Shared readers",
        nodes: [
          { label: "Pages", detail: "Markets, tokens and registry views." },
          { label: "JSON", detail: "Documented API responses." },
          { label: "MCP", detail: "Tools that read the same records." },
          { label: "Alerts", detail: "Registry and trust context for messages." },
        ],
      },
    },
    note: "Each job has its own cadence and coverage. A stored read time describes that record; it does not guarantee the current chain state.",
  },
  trust: {
    title: "How a token gets its trust label",
    summary: "Start with the token address and Robinhood’s asset list. Listed addresses are checked against their contracts. Other addresses are checked for a collision with a verified asset, then for readable metadata.",
    paths: {
      listed: {
        label: "Address is in Robinhood’s list",
        nodes: [
          { label: "verified", detail: "Contract confirmed; symbol and decimals match the listing." },
          { label: "listed", detail: "Listing exists; contract confirmation is incomplete." },
        ],
      },
      unlisted: {
        label: "Address is absent from the list",
        nodes: [
          { label: "lookalike", detail: "A folded name or symbol, or the scanner, matches a verified asset." },
          { label: "community", detail: "No collision; bytecode and name, symbol and decimals are readable." },
          { label: "unknown", detail: "No collision; the required contract metadata is incomplete." },
        ],
      },
    },
    note: "Pages, JSON and Watch use this shared decision. A trust label describes the recorded identity checks; it does not establish investment safety.",
  },
} as const satisfies Record<string, DocDiagramModel>;

export type DocDiagramId = keyof typeof docDiagrams;

export function diagramText(id: DocDiagramId): string {
  const diagram = docDiagrams[id];
  const paths = Object.values(diagram.paths).map(function describePath(path: DiagramPath) {
    const nodes = path.nodes.map(function describeNode(node) {
      return `${node.label}: ${node.detail}`;
    });
    return `${path.label}: ${nodes.join(" ")}`;
  });
  return [diagram.title, diagram.summary, ...paths, diagram.note].join("\n\n");
}
