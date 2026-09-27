import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const MAX_FILES = 200;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 2_000_000;
const FOUNDATION = "fletch/wallet.tsx";
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const MISSING = "required shared wallet integration missing";
type Sources = Map<string, ts.SourceFile>;

async function readSources(workspace: string): Promise<Sources> {
  const root = await realpath(workspace);
  const sources: Sources = new Map();
  let bytes = 0;
  let entries = 0;
  async function walk(path: string): Promise<void> {
    if (++entries > 2000) throw new Error("wallet source tree exceeds the inspection limit");
    const info = await lstat(path).catch(() => null);
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error("wallet source contains a symbolic link");
    const actual = await realpath(path);
    if (!actual.startsWith(`${root}${sep}`)) throw new Error("wallet source leaves the workspace");
    if (info.isDirectory()) {
      for await (const entry of await opendir(path)) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") await walk(join(path, entry.name));
      }
      return;
    }
    if (!SOURCE_EXTENSIONS.includes(extname(path)) && path !== join(root, "index.html")) return;
    if (!info.isFile() || info.size > MAX_FILE_BYTES || sources.size >= MAX_FILES) throw new Error("wallet source exceeds the inspection limit");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES) throw new Error("wallet source exceeds the inspection limit");
      bytes += bytesRead;
      if (bytes > MAX_TOTAL_BYTES) throw new Error("wallet sources exceed the combined inspection limit");
      const name = relative(root, path).split(sep).join("/");
      sources.set(name, ts.createSourceFile(name, buffer.subarray(0, bytesRead).toString("utf8"), ts.ScriptTarget.Latest, true, extname(path) === ".ts" ? ts.ScriptKind.TS : ts.ScriptKind.TSX));
    } finally { await file.close(); }
  }
  await walk(join(root, "src"));
  await walk(join(root, "fletch"));
  await walk(join(root, "index.html"));
  return sources;
}

function localModule(sources: Sources, from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const path = resolve("/", dirname(from), specifier).slice(1);
  const stem = path.replace(/\.[jt]sx?$/, "");
  for (const candidate of [path, ...SOURCE_EXTENSIONS.map((extension) => stem + extension), ...SOURCE_EXTENSIONS.map((extension) => `${path}/index${extension}`)]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function exportedComponent(sources: Sources, file: string, name: string, seen = new Set<string>()): string | null {
  if (file === FOUNDATION && ["WalletProvider", "WalletControl"].includes(name)) return name;
  const key = `${file}:${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  for (const statement of sources.get(file)?.statements ?? []) {
    if (ts.isExportAssignment(statement) && name === "default" && ts.isIdentifier(statement.expression)) {
      return importedComponents(sources, file, seen).get(statement.expression.text) ?? null;
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
    if (!statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const item = statement.exportClause.elements.find((entry) => entry.name.text === name && !entry.isTypeOnly);
      if (item) return importedComponents(sources, file, seen).get(item.propertyName?.text ?? item.name.text) ?? null;
    }
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = localModule(sources, file, statement.moduleSpecifier.text);
    if (!target) continue;
    if (!statement.exportClause) {
      const resolved = exportedComponent(sources, target, name, seen);
      if (resolved) return resolved;
    } else if (ts.isNamedExports(statement.exportClause)) {
      const item = statement.exportClause.elements.find((entry) => entry.name.text === name && !entry.isTypeOnly);
      if (item) return exportedComponent(sources, target, item.propertyName?.text ?? item.name.text, seen);
    }
  }
  return null;
}

function importedComponents(sources: Sources, file: string, seen = new Set<string>()): Map<string, string> {
  const result = new Map<string, string>();
  for (const statement of sources.get(file)?.statements ?? []) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const target = localModule(sources, file, statement.moduleSpecifier.text);
    if (!target) continue;
    const clause = statement.importClause;
    if (clause.name) {
      const value = exportedComponent(sources, target, "default", seen);
      if (value) result.set(clause.name.text, value);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        if (binding.isTypeOnly) continue;
        const value = exportedComponent(sources, target, binding.propertyName?.text ?? binding.name.text, new Set(seen));
        if (value) result.set(binding.name.text, value);
      }
    } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      for (const component of ["WalletProvider", "WalletControl"]) {
        const value = exportedComponent(sources, target, component, new Set(seen));
        if (value) result.set(`${clause.namedBindings.name.text}.${component}`, value);
      }
    }
  }
  return result;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function componentBody(source: ts.SourceFile, name: string): ts.Node | null {
  for (const statement of source.statements) {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body ?? null;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer
          && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) return declaration.initializer.body;
      }
    }
  }
  return null;
}

function isObviouslyEmpty(body: ts.Node | null): boolean {
  if (!body) return false;
  let value: ts.Node | undefined = body;
  if (ts.isBlock(body)) {
    if (body.statements.length === 0) return true;
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return false;
    value = body.statements[0].expression;
  }
  return !value || value.kind === ts.SyntaxKind.NullKeyword || value.kind === ts.SyntaxKind.FalseKeyword
    || (ts.isIdentifier(value) && value.text === "undefined");
}

function elementFactories(source: ts.SourceFile): Set<string> {
  const names = new Set(["React.createElement"]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "react") continue;
    const clause = statement.importClause;
    if (clause?.name) names.add(`${clause.name.text}.createElement`);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(`${clause.namedBindings.name.text}.createElement`);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        if ((binding.propertyName?.text ?? binding.name.text) === "createElement") names.add(binding.name.text);
      }
    }
  }
  return names;
}

// These are the foundation's supported configuration calls. Styles are free to
// change; arbitrary replacements of this connector contract need their own review.
function connectorContract(source: ts.SourceFile | undefined, helper: ts.SourceFile | undefined): boolean {
  if (!source || !helper || isObviouslyEmpty(componentBody(source, "WalletProvider")) || isObviouslyEmpty(componentBody(source, "WalletControl"))) return false;
  const bindings = new Map<string, string>();
  const allowed: Record<string, string[]> = {
    "wagmi": ["createConfig"], "wagmi/connectors": ["injected"],
    "@reown/appkit/react": ["createAppKit"], "@reown/appkit-adapter-wagmi": ["WagmiAdapter"],
    "./wallet-connectors": ["phantomConnector", "detectedInjectedWallets"],
  };
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names = allowed[statement.moduleSpecifier.text.replace(/\.[jt]sx?$/, "")];
    const imports = statement.importClause?.namedBindings;
    if (!names || !imports || !ts.isNamedImports(imports)) continue;
    for (const binding of imports.elements) {
      const name = binding.propertyName?.text ?? binding.name.text;
      if (names.includes(name)) bindings.set(binding.name.text, name);
    }
  }
  const found = new Set<string>();
  let valid = true;
  visit(source, function inspect(node) {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return;
    const name = ts.isIdentifier(node.expression) ? bindings.get(node.expression.text) : undefined;
    if (!name) return;
    found.add(name);
    if (!["createConfig", "WagmiAdapter", "createAppKit"].includes(name)) return;
    const options = node.arguments?.[0];
    if (!options || !ts.isObjectLiteralExpression(options)) { valid = false; return; }
    const properties = new Map<string, ts.Expression>();
    for (const property of options.properties) {
      if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) properties.set(property.name.text, property.initializer);
    }
    if (name === "createAppKit") {
      valid &&= ["enableInjected", "enableEIP6963"].every((key) => properties.get(key)?.kind === ts.SyntaxKind.TrueKeyword);
      return;
    }
    valid &&= properties.get("multiInjectedProviderDiscovery")?.kind === ts.SyntaxKind.TrueKeyword;
    const connectors = properties.get("connectors");
    const calls = new Set<string>();
    if (connectors && ts.isArrayLiteralExpression(connectors)) {
      for (const item of connectors.elements) {
        if (ts.isCallExpression(item) && ts.isIdentifier(item.expression)) {
          const connector = bindings.get(item.expression.text);
          if (connector) calls.add(connector);
        }
      }
    }
    valid &&= calls.has("phantomConnector") && (name !== "createConfig" || calls.has("injected"));
  });
  let phantomProvider = false;
  visit(helper, function inspect(node) {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "ethereum" && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "phantom") phantomProvider = true;
  });
  return valid && phantomProvider && ["createConfig", "WagmiAdapter", "createAppKit", "detectedInjectedWallets"].every((name) => found.has(name));
}

function sourceEntrypoints(sources: Sources): string[] {
  const html = sources.get("index.html");
  if (!html) {
    const defaults = SOURCE_EXTENSIONS.map((extension) => `src/main${extension}`).filter((file) => sources.has(file));
    if (defaults.length !== 1) throw new Error("expected one local module entry in index.html or src/main.tsx, main.ts, main.jsx or main.js");
    return defaults;
  }
  const entries: string[] = [];
  const text = html.text.replace(/<!--[\s\S]*?-->/g, "");
  for (const script of text.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of script[1].matchAll(/\b(type|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4]);
    }
    if (attributes.get("type")?.toLowerCase() !== "module") continue;
    const path = attributes.get("src")?.split(/[?#]/)[0];
    if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) continue;
    const entry = resolve("/", path).slice(1);
    if (!SOURCE_EXTENSIONS.includes(extname(entry)) || !sources.has(entry)) throw new Error("the local HTML module entry is missing or outside the inspected source paths");
    entries.push(entry);
  }
  if (!entries.length) throw new Error("index.html has no inspectable local module entry");
  return entries;
}

function reachableSources(sources: Sources): Set<string> {
  const entrypoints = sourceEntrypoints(sources);
  const reachable = new Set<string>();
  const pending = [...entrypoints];
  while (pending.length) {
    const file = pending.pop()!;
    if (reachable.has(file)) continue;
    reachable.add(file);
    const source = sources.get(file)!;
    visit(source, function dependency(node) {
      let specifier: string | undefined;
      if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) || (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      const target = specifier ? localModule(sources, file, specifier) : null;
      if (target && !reachable.has(target)) pending.push(target);
    });
  }
  return reachable;
}

// Structural integration only: actual wallet discovery, chain support and
// signing still depend on the visitor's wallet/browser and are not proved here.
// Module reachability is checked, not arbitrary control flow inside each module.
// HTML module entries select the graph; absent HTML uses the template main entry.
export async function walletFoundationViolations(workspace: string): Promise<string[]> {
  let sources: Sources;
  let reachable: Set<string>;
  try { sources = await readSources(workspace); reachable = reachableSources(sources); }
  catch (error) { return [`${MISSING}: ${error instanceof Error ? error.message : "sources could not be inspected"}`]; }
  const rendered = new Set<string>();
  for (const [file, source] of sources) {
    if (!reachable.has(file)) continue;
    const factories = elementFactories(source);
    const imported = importedComponents(sources, file);
    visit(source, function component(node) {
      let name: string | undefined;
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) name = node.tagName.getText(source);
      if (ts.isCallExpression(node) && factories.has(node.expression.getText(source))) name = node.arguments[0]?.getText(source);
      const value = name ? imported.get(name) : undefined;
      if (value) rendered.add(value);
    });
  }
  const violations: string[] = [];
  if (!rendered.has("WalletProvider") || !rendered.has("WalletControl")) {
    violations.push(`${MISSING}: render WalletProvider and WalletControl imported from fletch/wallet.tsx, keeping one shared wallet control`);
  }
  if (!connectorContract(sources.get(FOUNDATION), sources.get("fletch/wallet-connectors.ts"))) {
    violations.push(`${MISSING}: preserve detected Phantom EVM, injected wallet and EIP-6963 discovery in the shared wallet component`);
  }
  return violations;
}

export const WALLET_FOUNDATION_REPAIR = "Use WalletProvider and one WalletControl from fletch/wallet.tsx. Read /opt/webapp/foundation/wallet.tsx and wallet-connectors.ts for current connector logic if the project has an older foundation. Preserve detected Phantom EVM and other compatible injected/EIP-6963 options alongside WalletConnect when its supplied project ID exists. Preserve the app's requested styles and existing behavior; restyle the shared control instead of replacing it with another wallet stack. Never invent a project ID or claim that static inspection proves actual wallet signing.";
