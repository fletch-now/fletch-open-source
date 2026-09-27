import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { walletFoundationViolations } from "./wallet-foundation";

const WALLET = 'import { WalletProvider, WalletControl } from "../fletch/wallet"; export function App(){return <WalletProvider><WalletControl className="user-neon" /></WalletProvider>}';

test("required wallet guard checks actual shared integration and preserves cosmetic freedom", async function foundation(t) {
  const workspace = await mkdtemp(join(tmpdir(), "fletch-wallet-guard-"));
  const original = await readFile("docker/webapp-template/foundation/wallet.tsx", "utf8");
  const connectors = await readFile("docker/webapp-template/foundation/wallet-connectors.ts", "utf8");
  async function reset(source = WALLET, wallet = original): Promise<void> {
    await rm(join(workspace, "index.html"), { force: true });
    await rm(join(workspace, "src"), { recursive: true, force: true });
    await rm(join(workspace, "fletch"), { recursive: true, force: true });
    await mkdir(join(workspace, "src"));
    await mkdir(join(workspace, "fletch"));
    await writeFile(join(workspace, "src/main.tsx"), 'import { App } from "./App"; export default App;');
    await writeFile(join(workspace, "src/App.tsx"), source);
    await writeFile(join(workspace, "fletch/wallet.tsx"), wallet);
    await writeFile(join(workspace, "fletch/wallet-connectors.ts"), connectors);
  }
  try {
    await t.test("WalletConnect-only output fails even when correct unused foundation files exist", async function only() {
      await reset('import { walletConnect } from "wagmi/connectors"; const connectors=[walletConnect({projectId:"supplied"})]; export function App(){return <button>WalletConnect</button>}');
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("render WalletProvider")));
    });
    await t.test("unreachable wallet demos cannot satisfy a WalletConnect-only active app", async function orphan() {
      await reset('export function App(){return <button>WalletConnect only</button>}');
      await writeFile(join(workspace, "src/WalletDemo.tsx"), WALLET);
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("render WalletProvider")));
    });
    await t.test("properly rendered foundation and user restyling pass", async function proper() {
      await reset(WALLET, original.replace("className = ''", "className = 'user-requested-glass-gradient'"));
      assert.deepEqual(await walletFoundationViolations(workspace), []);
    });
    await t.test("comments, strings and unused imports cannot masquerade as rendered controls", async function inert() {
      await reset('import { WalletProvider, WalletControl } from "../fletch/wallet"; // <WalletProvider><WalletControl/></WalletProvider>\nconst text="<WalletProvider><WalletControl/></WalletProvider>"; export function App(){return <button>{text}</button>}');
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("render WalletProvider")));
    });
    await t.test("aliases, split files, direct and local re-exports pass", async function aliases() {
      await reset('import { Container } from "./wallet"; import Connect from "./connect"; export function App(){return <Container><Connect/></Container>}');
      await writeFile(join(workspace, "src/wallet.ts"), 'export { WalletProvider as Container } from "../fletch/wallet";');
      await writeFile(join(workspace, "src/connect.ts"), 'import { WalletControl as Local } from "../fletch/wallet"; export default Local;');
      assert.deepEqual(await walletFoundationViolations(workspace), []);
    });
    await t.test("namespace imports and export-star barrels pass", async function namespace() {
      await reset('import * as Shared from "./barrel"; export function App(){return <Shared.WalletProvider><Shared.WalletControl/></Shared.WalletProvider>}');
      await writeFile(join(workspace, "src/barrel.ts"), 'export * from "../fletch/wallet";');
      assert.deepEqual(await walletFoundationViolations(workspace), []);
    });
    await t.test("reachable local wrappers outside src and aliased React factories pass", async function wrappers() {
      await reset('import { Shell } from "../fletch/shell"; export function App(){return <Shell/>}');
      await writeFile(join(workspace, "fletch/shell.tsx"), 'import {createElement as h} from "react"; import {WalletProvider as P,WalletControl as C} from "./wallet"; export function Shell(){return h(P,null,h(C))}');
      assert.deepEqual(await walletFoundationViolations(workspace), []);
    });
    await t.test("a null exported control cannot hide behind an unused copy of the foundation", async function removedControl() {
      await reset(WALLET, original.replace('export function WalletControl(', 'function UnusedWalletControl(') + '\nexport function WalletControl(){return null}');
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("preserve detected Phantom")));
    });
    await t.test("the actual HTML entry can use index.tsx and an unused main cannot satisfy it", async function htmlEntry() {
      await reset();
      await writeFile(join(workspace, "index.html"), '<!-- <script type="module" src="/src/missing.tsx"></script> --><div id="root"></div><script src="/src/index.tsx" type="module"></script>');
      await writeFile(join(workspace, "src/index.tsx"), WALLET);
      await writeFile(join(workspace, "src/main.tsx"), 'export const unused = true;');
      assert.deepEqual(await walletFoundationViolations(workspace), []);
      await writeFile(join(workspace, "src/main.tsx"), WALLET);
      await writeFile(join(workspace, "src/index.tsx"), 'export function App(){return <button>WalletConnect only</button>}');
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("render WalletProvider")));
    });
    await t.test("losing injected options in either configuration branch fails even with inert marker comments", async function capability() {
      for (const wallet of [
        original.replace('connectors: [phantomConnector(), injected()]', 'connectors: [] /* phantomConnector(), injected() */'),
        original.replace('multiInjectedProviderDiscovery: true', 'multiInjectedProviderDiscovery: false'),
        original.replace('connectors: [phantomConnector(), injected()]', 'connectors: [injected()]'),
        original.replace('enableEIP6963: true', 'enableEIP6963: false'),
      ]) {
        await reset(WALLET, wallet);
        assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("preserve detected Phantom")));
      }
    });
    await t.test("removing Phantom's explicit EVM namespace fails without inspecting a wallet or network", async function phantom() {
      await reset();
      await writeFile(join(workspace, "fletch/wallet-connectors.ts"), connectors.replace('window?.phantom?.ethereum', 'window?.ethereum'));
      assert.ok((await walletFoundationViolations(workspace)).some((text) => text.includes("preserve detected Phantom")));
    });
    await t.test("oversized sources and links outside the workspace fail explicitly without silent omission", async function bounds() {
      await reset();
      await writeFile(join(workspace, "src/large.tsx"), " ".repeat(200_001));
      assert.match((await walletFoundationViolations(workspace)).join(" "), /inspection limit/);
      await reset();
      await symlink(join(process.cwd(), "docker/webapp-template/foundation/wallet.tsx"), join(workspace, "src/linked.tsx"));
      assert.match((await walletFoundationViolations(workspace)).join(" "), /symbolic link/);
    });
  } finally { await rm(workspace, { recursive: true, force: true }); }
});
