import { injected } from 'wagmi/connectors';
import type { Connector, CreateConnectorFn } from 'wagmi';

// Phantom keeps this namespace even when another extension owns window.ethereum.
// EIP-6963 remains enabled for every other announcing EVM wallet.
export function phantomConnector(): CreateConnectorFn {
  return function createPhantom(config) {
    const connector = injected({ target: {
      id: 'phantom', name: 'Phantom',
      provider(window) {
        return window?.phantom?.ethereum ?? config.providers.find(function phantom(detail) { return detail.info.rdns === 'app.phantom'; })?.provider;
      },
    } })(config);
    // Wagmi merges announcements for this wallet instead of showing the legacy
    // provider and its EIP-6963 announcement as two Phantom choices in AppKit.
    return { ...connector, rdns: 'app.phantom' };
  };
}

export async function detectedInjectedWallets(connectors: readonly Connector[]): Promise<Connector[]> {
  const candidates = connectors.filter(function injectedOnly(connector) { return connector.type === 'injected'; });
  // Prefer a wallet's announced name over the generic window.ethereum alias.
  candidates.sort(function namedFirst(a, b) { return Number(a.id === 'injected') - Number(b.id === 'injected'); });
  const detected = await Promise.all(candidates.map(async function detect(connector) {
    const provider = await connector.getProvider().catch(() => undefined);
    return { connector, provider };
  }));
  const providers = new Set<unknown>();
  return detected.filter(function unique(row) {
    if (!row.provider || typeof (row.provider as { request?: unknown }).request !== 'function' || providers.has(row.provider)) return false;
    providers.add(row.provider);
    return true;
  }).map(function connector(row) { return row.connector; });
}
