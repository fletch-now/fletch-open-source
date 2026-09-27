import type { DocPage } from "./content";

export const buildDocPage: DocPage = {
  slug: "build",
  title: "Build",
  description: "Describe an app, follow its compiler and test results, and open its recorded publication.",
  next: "watch",
  sections: [
    {
      title: "The build pipeline",
      diagram: "build",
      paragraphs: [
        "Fletch runs your selected coding model in a prepared workspace, checks its output and publishes the frontend. Apps that need their own contract also go through Foundry tests, Slither and deployment to Robinhood Chain testnet, chain 46630.",
        "A frontend-only app takes the frontend build and publication branch. An app that needs its own contract also follows the contract checks and deployment stages below.",
      ],
      steps: [
        "Accept and queue. Fletch validates your prompt and attachments, records the selected provider, model and credential version, and reserves the applicable Fletch credit. An accepted build waits for a shared execution slot; your account can have one queued or running build at a time.",
        "Decide what the app needs. The planner reads your prompt and complete text attachments to decide whether the app needs a contract and wallet connection. An existing contract preserves those requirements, while an app that only reads public data can run without a wallet control.",
        "Prepare the workspace and write the app. The coding agent receives your brief, supported image references, Robinhood Chain facts and the prepared toolchain. It writes or edits project files and records tool activity; an existing project's available source and compatible session provide the context for a follow-up.",
        "Check required output. Fletch checks for the required frontend, contract and shared wallet integration, and for code that contradicts the planning verdict. One repair turn can address those failures; a required component still missing afterwards stops the build with its source retained.",
        "Compile with Foundry. The platform runs solc 0.8.28 through Foundry and records compiler diagnostics, contract identities, ABI and bytecode size against the 24,576-byte runtime limit. A compiler failure can receive one repair turn, followed by fresh compilation so older artifacts cannot satisfy the final check.",
        "Run contract tests. Foundry executes the generated test suites and records each case's result and available gas measurement. Missing or empty tests, failed cases and an abnormal test-process exit trigger one repair turn; compilation and tests run again before a contract app can continue.",
        "Run Slither. Static analysis reports findings by impact and sends High findings back for one security repair. After that repair, Fletch recompiles and reruns tests and analysis; an unavailable analysis or remaining High finding blocks deployment.",
        "Check the final contract evidence. Fletch checks the latest compiler, test and analysis reports together with the required app output. The code view receives the generated files, and a failure at this point keeps the app from being deployed or published.",
        "Deploy the chosen contract. The host signs the selected entrypoint's testnet deployment and waits for a transaction receipt containing its contract address. An unchanged entrypoint can retain its previous address; an uncertain sent transaction pauses the attempt until its outcome can be checked.",
        "Request source verification. Fletch submits the compiler's saved standard JSON input and constructor settings to the chain explorer. The explorer's answer determines the verified label, and a verification failure remains visible as a note even if the app proceeds to publication.",
        "Save the frontend preview. Vite builds the page with its public chain configuration and deployed address, when applicable. The resulting bundle becomes an isolated preview. Click Publish live app to request hosting. Publication checks its HTTPS URL before reporting it live and uses no additional model call or build credit.",
        "Record the outcome. Fletch saves the final transcript and result, saves the project's new preview on success, and records any applicable failed-build refund. Your source remains available, and a failed update retains the previously confirmed publication when cleanup can establish that outcome.",
      ],
    },
    {
      title: "Read the result of each stage",
      table: {
        headings: ["Stage", "Recorded output", "What it establishes"],
        rows: [
          ["Planning", "Contract/wallet verdict, reason and source", "Which requirements the build will check."],
          ["Generation", "File changes and tool activity", "What the agent wrote or attempted."],
          ["Compilation", "Compiler version, diagnostics, ABI and runtime bytecode size", "Whether the compiled source passed the compiler."],
          ["Tests", "Named cases, pass/fail counts, reasons and available gas", "The outcome of the tests that executed."],
          ["Static analysis", "Slither findings and impact levels", "The detector results for the analysed source."],
          ["Deployment", "Transaction hash, address and constructor owner when supplied", "The recorded testnet deployment outcome."],
          ["Source verification", "The explorer's answer or a failure note", "Whether the explorer accepted the submitted source."],
          ["Frontend build", "Build result, file count and output size", "Whether the prepared frontend toolchain produced a page."],
          ["Publication", "Hosted URL and successful HTTPS check", "That the published URL answered during verification."],
        ],
      },
      paragraphs: [
        "A new compilation clears earlier test and security results until the updated source has been checked. The verdict line comes from these tool reports. Generated tests cover their implemented cases, and publication records a successful HTTPS fetch. Check the app's wallet actions and permission-sensitive flows against your brief before relying on it.",
      ],
    },
    {
      title: "Give the agent a usable brief",
      paragraphs: [
        "Describe who uses the app, the actions they can take and the information each screen needs. State which actions change on-chain state and which only read it. Include ownership rules, failure cases and styles to preserve.",
        "The composer accepts 24,000 characters. You can attach five MD, TXT, CSV, JSON or YAML files, each up to 64 KiB and 128 KiB combined. A large paste becomes a recoverable brief file; open its chip to check the complete text. Valid attached text reaches needs analysis in full and is saved in the project workspace.",
        "Paste, pick or drop PNG/JPEG references with a model connection that supports images. Limits are three images, 2 MiB each, 4 MiB combined, 4096 pixels per edge and 16 megapixels. Fletch validates and preserves the original bytes. Wait for the attachment preview before submitting; an unsupported connection rejects image input before charging a Fletch credit.",
        "Enhance revises the draft for your review and blocks submission while pending. Enter or Cmd/Ctrl+Enter sends, Shift+Enter adds a line, and Cmd/Ctrl+K focuses the composer. A rejected submission keeps the draft so you can correct it.",
      ],
    },
    {
      title: "Work in your project's conversation",
      paragraphs: [
        "Choose an existing project or create a new app. Each submitted prompt becomes a build in that conversation. Switching projects changes the displayed files, steps and preview while accepted background work continues.",
        "Preview shows the saved draft or current live app. Code groups its files and available report or ABI artifacts. While this tab is visible, the file count and contents refresh every five seconds during a build or when viewing Code. New files animate into the list. Chat gives the conversation more reading space. On desktop, drag the divider to widen the conversation up to half the workspace.",
        "Build details contains that reply's recorded steps and available tool output. It opens during execution and collapses on completion. Working and Reconnecting describe execution or stream state; elapsed time alone does not indicate that the model has produced another update.",
      ],
    },
    {
      title: "Estimate the time and return to a saved version",
      paragraphs: [
        "The composer shows an estimated duration once you begin a prompt. It uses recent successful builds from the selected provider and model; after planning it also matches contract requirements. At least five matching completed builds are needed. Queue waiting is separate. During execution, the reply shows elapsed time from the saved start, including after a page refresh. An estimate is a historical range, and scope, repairs and provider speed can change it.",
        "Open History beside the workspace modes to browse previous builds, inspect saved files and read their recorded toolchain reports. Choose Restore a copy to create a separate app from a verified source snapshot. The original project, conversation and published app remain available. Copying source uses zero build credits and does not run a model or publish a new page. Submit a change in the copied project to build and publish it under the normal price review.",
        "A restored copy retains the earlier brief and source files. Its next build uses that context without later edits or the original agent session. On-chain transactions and contract state remain as they are. Versions whose source snapshot is unavailable show that limitation before you restore.",
      ],
    },
    {
      title: "Choose a model and who pays for it",
      paragraphs: [
        "The platform connection currently uses Kimi K3 and reserves one Fletch credit per accepted build. To use your own API account, save an OpenAI, Anthropic or Kimi connection in Settings, then select it in the composer. Own-key builds cost zero Fletch credits, and the provider charges your API account for usage. A chat subscription does not include API access.",
        "Settings checks whether your key can read the selected model's metadata and reports rejected keys, missing models and temporary provider limits. Use in Build opens the builder with that connection selected. The access check generates no tokens and does not guarantee inference quota. Starting still requires your explicit Ship action.",
        "The submitted build keeps its provider, model and credential version. Changing the model menu affects a future submission. Replacing or revoking a selected key can stop active requests. Supported image input depends on the particular model, and custom model IDs can remain text-only.",
        "A follow-up uses the same project's saved files. A compatible Kimi connection can also reuse its saved conversation session. Other providers begin a fresh model conversation over those files, so state important requirements in your follow-up instead of relying on an earlier model's unseen conversation.",
      ],
      links: [{ href: "/dashboard/settings", label: "Manage model connections" }],
    },
    {
      title: "How your key is used",
      paragraphs: [
        "Hosted provider keys are encrypted at rest with AES-256-GCM and decrypted by Fletch's server to make provider requests. The coding container receives a temporary token for the host's credential proxy, scoped to its selected model. The provider key and testnet deployer private key stay outside that container.",
        "Server operators who control the host and its encryption material can access hosted keys. Revoke or replace a connection in Settings when you need to end its access. Revocation reaches active worker requests, and cleanup releases temporary proxy tokens and removes their configuration from the agent's home directory.",
      ],
    },
    {
      title: "The prepared environment",
      paragraphs: [
        "Fletch supplies the server, Docker image, compiler, test libraries and frontend dependencies. The coding container has a read-only root and only the project workspace mounted for editing. Current production ceilings are 2 GiB of memory, 2 CPUs and 256 processes per container, with Linux capabilities removed and privilege escalation disabled.",
        "Compiler, test, Slither and frontend-build containers run without network access. The coding agent keeps network access for its model connection and can read public data over HTTP or RPC. Its prompt includes chain IDs, public RPC endpoints and relevant address guidance; apps can read mainnet data through a separate client while deploying their own contract on testnet.",
        "Compare a contract deadline with the same clock in your frontend. Solidity block.number and the RPC height differ on Robinhood Chain. Template 2.0.2 provides useSolidityBlockNumber() for Solidity block.number deadlines and useChainBlockNumber() for RPC height or ArbSys arbBlockNumber() deadlines. Wait for a successful query and disable deadline actions on read errors, including when cached data exists. Use timestamps for deadlines expressed in seconds.",
        "Design guidance asks for a purpose-specific palette, readable data and responsive layouts. Your requested style takes priority, including an image reference the selected model receives. The prepared wallet component can be restyled while retaining its connection behavior.",
      ],
    },
    {
      title: "Wallets and the contract entrypoint",
      paragraphs: [
        "Apps that sign transactions use one shared WalletProvider and WalletControl. The component supports compatible injected EVM wallets, including Phantom EVM and EIP-6963 discovery. WalletConnect requires the configured project ID; current pairing availability is listed on Limits. A read-only app can display public data without asking you to connect.",
        "The builder checks the shared component's structural integration. Discovery, network switching and transaction signing also depend on the visitor's installed wallet and browser. Open the hosted app for a wallet check if the embedded preview limits discovery, and inspect the requested network and transaction before signing.",
        "Automatic deployment selects one top-level application contract. The agent records its source and name in fletch.deploy.json; ambiguous deployable candidates stop with an error. Supported constructors take no arguments or one address, which receives the build account's first stored wallet. The prompt instructs the agent to assign that wallet ownership and leave the gas-paying deployer without a role.",
        "Review the resulting ownership code and ABI. Several Solidity files can compile, and a factory can create child contracts through its own logic. General deployment graphs with several independent top-level contracts or arbitrary constructor arguments require capabilities beyond the current automatic flow. Ordinary Build deployment targets testnet 46630.",
      ],
      links: [{ href: "/docs/limits", label: "Deployment and wallet availability" }],
    },
    {
      title: "Repair limits and current costs",
      paragraphs: [
        "Repairs are bounded by stage. There is one combined required-output repair, one compiler repair, one test repair and one High-impact security repair. A follow-up that removes an existing contract without being asked can also receive a restoration turn.",
        "Each coding-agent turn currently has a 45-minute timeout. A repair starts another turn, so 45 minutes is not an overall build deadline. Individual model requests are capped at 570 seconds, and compiler/tool and frontend-build invocations have three-minute limits. The workspace is checked against 64 MiB between agent stages; the hosted frontend must fit within 10 MiB.",
        "A failed charged build receives its reserved Fletch credit through a separate refund entry tied to that run. Your provider may still charge for requests already made, including work stopped after a timeout. Restore draft puts the selected failed build's prompt and attachments back in the composer. Review them and submit another build under the current charging rules.",
        "Review the current grant and payment availability on Limits. Future budget choices and longer execution belong on the roadmap; the current composer does not provide an approved maximum provider-spend budget.",
      ],
      links: [
        { href: "/docs/limits", label: "Current limits and pricing" },
        { href: "/docs/roadmap", label: "Build work on the roadmap" },
      ],
    },
    {
      title: "Leave the tab and return",
      paragraphs: [
        "New builds run in a background worker independent of the website. Closing the tab or restarting the website leaves that worker running. Reopen the project to load its saved steps and reconnect at the recorded position in the stream.",
        "A queued build groups your place in line and the current build capacity. Waiting to start means your request is first and capacity is available; the worker still has to claim it. Cancel queue removes it and refunds any reserved Fletch credit; Edit prompt also restores the saved draft and attachments for revision. Editing gives up that queue position. When the worker claims the build, the console leaves the queue view before the first tool log arrives.",
        "During a planned builder update, running builds continue while accepted queued builds wait. The queue shows Builder update and keeps Cancel queue and Edit prompt available. Queued work starts after the update finishes and capacity becomes available. If submission is briefly unavailable, your prompt and attachments remain in the open composer for another attempt; keep the page open until you submit successfully. An unexpected interruption may still require recovery review.",
        "The queue distinguishes running builds from slots reserved for recovery. Before a new attempt plans an existing project, it restores the original objective, latest prior request and referenced text briefs from saved submissions. The current request takes precedence. A missing referenced brief stops planning and asks you to restore or attach it.",
        "When a completed model response exceeds its output limit during a tool request, the worker rejects that incomplete request, records its reported usage, closes the agent and saves a source checkpoint. It can continue once in a fresh turn with the saved brief and instructions to write smaller files. This continuation stays in the same build and obeys its remaining allowance. A repeated failure shows its cause and retains your source.",
        "An uncertain model response requires cleanup before an explicit new attempt. An uncertain tool, deployment or publication can keep the project reserved until its outcome is checked. Restore draft lets you review and resubmit a failed request after recovery finishes.",
      ],
    },
    {
      title: "Stop and keep the saved work",
      paragraphs: [
        "Stop asks the server to end the build. Stopping remains visible while model and tool processes shut down and already-sent transactions are recorded. Keep the conversation open or return later for the terminal result; a Stop acknowledgement alone does not mean cleanup has finished.",
        "A sent transaction can still be mined after you press Stop. Its confirmed address stays in the build record. An unclear transaction or publication outcome can keep the attempt paused until the operator checks it, while the previous confirmed release is retained when its state can be established.",
        "Source checkpoints are saved between stages when the sandbox has stopped writing. The original editable source and session files also remain in the project workspace. Checkpoints exclude credentials, generated caches and agent-session storage. Recovery limits are listed on the roadmap.",
      ],
    },
    {
      title: "Delete a project",
      paragraphs: [
        "Choose Delete beside the project in Projects, then confirm. Deletion removes the project workspace and hosted site. Build records, source checkpoints and credit history are retained.",
        "Cancel queued work or stop a running build before deleting. A build with an unresolved recovery outcome must finish recovery first.",
        "If the request is interrupted, retry Delete to check and finish it. The recorded deletion request prevents a new build from entering a partly removed workspace.",
      ],
    },
    {
      title: "Inspect the published app",
      paragraphs: [
        "Use the preview toolbar's recorded URL, Refresh and Open app controls. Fit is the default; the settings gear contains device widths and zoom. Code provides file previews and copy controls, with ABI and reports when the build produced them.",
        "Open the app, connect your wallet and walk through the actions in your brief. Check the wrong-network message, owner-only controls and transaction results as part of that walkthrough.",
        "Audit for mainnet places a review instruction in the composer. Submitting it starts a follow-up through the same build pipeline and charging rules. Review the resulting source and findings; mainnet availability remains on Limits.",
      ],
    },
    {
      title: "Try a contract app",
      paragraphs: [
        "Start with a small testnet-only app and a brief that specifies roles, state changes and failure cases. Follow the compiler, test, analysis and deployment evidence from your own build.",
        "Check the recorded owner and deployed address on your configured explorer. Exercise user and owner actions with separate disposable test wallets. Keep private keys and wallet activity out of shared examples.",
        "A successful example demonstrates its tested workflow; it does not establish that every generated contract is safe for real funds.",
      ],
      links: [{ href: "/docs/quickstart-build", label: "Start your first build" }],
    },
    {
      title: "Try a frontend-only app",
      paragraphs: [
        "Ask for a personal planner, a CSV explorer or a dashboard over a public API. State that no contract or wallet is needed. Supply synthetic example data and clear acceptance criteria.",
        "Inspect the saved preview, loading and error states, accessibility and browser behavior before requesting publication. The static publisher serves frontend assets; shared accounts, scheduled jobs and databases need a separately provisioned backend.",
      ],
      links: [{ href: "/docs/quickstart-build", label: "Start your first build" }],
    },
  ],
};
