import { randomBytes } from "node:crypto";
import { APPS_DOMAIN, RH_TESTNET_ID } from "@/lib/config";
import { robinhoodTestnet } from "@/lib/chains";
import type { BuildEvent, BuildInput, Builder } from "@/lib/build/types";

function delay(ms: number): Promise<void> {
  return new Promise(function schedule(resolve) {
    setTimeout(resolve, ms);
  });
}

function fakeAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function testnetExplorer(address: string): string {
  const base = robinhoodTestnet.blockExplorers?.default.url ?? "";
  return `${base}/address/${address}`;
}

const FILES: BuildEvent[] = [
  {
    phase: "scaffolding",
    text: "contracts/Token.sol",
    artifact: {
      path: "contracts/Token.sol",
      kind: "contract",
      lines: 84,
      preview:
        "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ncontract Token {\n    string public name;\n    mapping(address => uint256) public balanceOf;\n}",
    },
  },
  {
    phase: "scaffolding",
    text: "src/App.tsx",
    artifact: {
      path: "src/App.tsx",
      kind: "app",
      lines: 132,
      preview:
        'import { useAccount } from "wagmi";\n\nexport default function App() {\n  const { address } = useAccount();\n  return <main>…</main>;\n}',
    },
  },
  {
    phase: "scaffolding",
    text: "src/chain.ts",
    artifact: {
      path: "src/chain.ts",
      kind: "config",
      lines: 21,
      preview: `import { robinhoodTestnet } from "viem/chains";\n\nexport const chain = robinhoodTestnet; // ${RH_TESTNET_ID}`,
    },
  },
];

// Emits a realistic build so the whole pipeline runs end-to-end before the real
// E2B/claude-code/Blockscout/hosting integrations exist. Swap for a real Builder
// (env-selected in lib/build/index.ts) without touching any route.
export class StubBuilder implements Builder {
  async *run(input: BuildInput): AsyncIterable<BuildEvent> {
    const address = fakeAddress();
    const previewUrl = `https://${input.slug}.${APPS_DOMAIN}`;

    yield { phase: "planning", text: "Demo mode — no model key configured; this build is simulated" };
    await delay(400);
    yield { phase: "planning", text: `Planning a Robinhood Chain dapp for: "${input.prompt}"` };
    await delay(800);

    yield { phase: "scaffolding", text: "Scaffolding Vite + wagmi + viem, Foundry contract" };
    for (const file of FILES) {
      await delay(700);
      yield file;
    }

    await delay(700);
    yield { phase: "compiling", text: "forge build — compiling contracts" };
    await delay(900);
    yield { phase: "testing", text: `14 tests passing against a fork of ${RH_TESTNET_ID}` };
    await delay(900);
    yield { phase: "deploying", text: `Deploying to testnet ${RH_TESTNET_ID}` };
    await delay(1100);
    yield {
      phase: "deploying",
      text: "Verified on the chain explorer",
      contractAddress: address,
      explorerUrl: testnetExplorer(address),
    };
    await delay(800);
    yield { phase: "hosting", text: `Publishing to ${previewUrl}` };
    await delay(900);
    yield {
      phase: "done",
      text: "Demo build complete — simulated output, nothing was deployed.",
      contractAddress: address,
      explorerUrl: testnetExplorer(address),
      previewUrl,
    };
  }
}
