import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import type { AppKitNetwork } from '@reown/appkit/networks';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createConfig, http, useAccount, useConnect, useDisconnect, useSwitchChain, WagmiProvider, type Config, type Connector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Chain } from 'viem';
import './wallet.css';
import { DataProvider } from './data-provider';
import { appChain, rpcUrl } from './network';
import { detectedInjectedWallets, phantomConnector } from './wallet-connectors';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? '';
const networks: [AppKitNetwork] = [appChain];
const chains: [Chain] = [appChain];
let modal: ReturnType<typeof createAppKit> | null = null;

function walletConfig(): Config {
  if (!projectId) {
    return createConfig({
      chains,
      connectors: [phantomConnector(), injected()],
      multiInjectedProviderDiscovery: true,
      transports: { [appChain.id]: http(rpcUrl) },
    });
  }
  const adapter = new WagmiAdapter({ projectId, networks, connectors: [phantomConnector()], multiInjectedProviderDiscovery: true, transports: { [appChain.id]: http(rpcUrl) } });
  modal = createAppKit({
    projectId, adapters: [adapter], networks, defaultNetwork: appChain,
    enableNetworkSwitch: false, allowUnsupportedChain: true,
    enableInjected: true, enableEIP6963: true,
    metadata: { name: document.title, description: document.title, url: window.location.origin, icons: [] },
    features: { analytics: false, email: false, socials: [], onramp: false, swaps: false },
  });
  return adapter.wagmiConfig as Config;
}
const config = walletConfig();
interface ProviderProps { children: ReactNode; }

export function WalletProvider({ children }: ProviderProps): ReactElement {
  return (
    <WagmiProvider config={config}>
      <DataProvider>{children}</DataProvider>
    </WagmiProvider>
  );
}

interface WalletReady { ready: boolean; reason: string | null; }

export function useWalletReady(): WalletReady {
  const { isConnected, chainId } = useAccount();
  if (!isConnected) return { ready: false, reason: 'Connect your wallet before signing.' };
  if (chainId !== appChain.id) return { ready: false, reason: `Switch to ${appChain.name} before signing.` };
  return { ready: true, reason: null };
}

interface ControlProps { className?: string; }

export function WalletControl({ className = '' }: ControlProps): ReactElement {
  const { address, isConnected, chainId } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { connectors, connectAsync } = useConnect();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [injectedWallets, setInjectedWallets] = useState<Connector[]>([]);
  const connectButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const embedded = window.self !== window.top;

  useEffect(function detectWallets() {
    if (modal) return;
    let active = true;
    void detectedInjectedWallets(connectors).then(function show(wallets) { if (active) setInjectedWallets(wallets); });
    return function cancel() { active = false; };
  }, [connectors, choosing]);

  useEffect(function observePicker() {
    const panel = picker.current;
    if (!panel) return;
    function toggled(event: Event): void { setChoosing((event as ToggleEvent).newState === 'open'); }
    panel.addEventListener('toggle', toggled);
    return () => panel.removeEventListener('toggle', toggled);
  }, []);

  useEffect(function positionPicker() {
    if (!choosing) return;
    function place(): void {
      const panel = picker.current;
      const anchor = connectButton.current?.getBoundingClientRect();
      if (!panel || !anchor) return;
      const width = Math.min(320, window.innerWidth - 24);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - panel.offsetHeight - 12))}px`;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [choosing, injectedWallets.length]);

  function closePicker(): void { picker.current?.hidePopover(); connectButton.current?.focus(); }

  async function connectInjected(connector: Connector): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await connectAsync({ connector });
      closePicker();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your wallet did not complete the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function act(action: 'connect' | 'switch' | 'disconnect'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (action === 'connect') {
        if (modal) await modal.open({ view: 'Connect', namespace: 'eip155' });
        else picker.current?.togglePopover();
      }
      if (action === 'switch') await switchChainAsync({ chainId: appChain.id });
      if (action === 'disconnect') await disconnectAsync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your wallet did not complete the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  let controls: ReactNode = (
    <button className="fletch-wallet-trigger" ref={connectButton} type="button" disabled={busy} aria-expanded={modal ? undefined : choosing} onClick={function connect() { void act('connect'); }}>
      {busy ? 'Opening wallet…' : 'Connect wallet'} <span aria-hidden="true">⌄</span>
    </button>
  );
  if (isConnected && address) {
    controls = (
      <div className="fletch-row">
        <span className="fletch-wallet-address" title={address} aria-label={`Connected wallet ${address}`}>
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        {chainId !== appChain.id && (
          <button type="button" disabled={busy} onClick={function switchNetwork() { void act('switch'); }}>
            Switch to {appChain.name}
          </button>
        )}
        <button type="button" disabled={busy} onClick={function disconnect() { void act('disconnect'); }}>Disconnect</button>
      </div>
    );
  }
  return (
    <div className={`fletch-wallet ${className}`} onKeyDown={function dismiss(event) {
      if (event.key === 'Escape' && choosing) closePicker();
    }}>
      {controls}
      {!modal && (
        <div ref={picker} {...{ popover: 'auto' }} className="fletch-wallet-picker" role="dialog" aria-label="Choose a wallet">
          <div className="fletch-wallet-picker-head"><strong>Connect a wallet</strong><button type="button" onClick={closePicker} aria-label="Close wallet choices">×</button></div>
          <p className="fletch-wallet-picker-caption">Choose an installed EVM wallet.</p>
          <div className="fletch-wallet-options" role="group" aria-label="Detected browser wallets">
            {injectedWallets.map(function option(connector) {
              return <button key={connector.uid} type="button" disabled={busy} onClick={function connect() { void connectInjected(connector); }}>
                <span className="fletch-wallet-letter" aria-hidden="true">{connector.name.slice(0, 1)}</span>
                <span>{connector.name === 'Injected' ? 'Browser wallet' : connector.name}</span><span className="fletch-wallet-option-arrow" aria-hidden="true">→</span>
              </button>;
            })}
          </div>
          {injectedWallets.length === 0 && <p className="fletch-wallet-picker-caption">No compatible browser wallet was detected. Open this app in your wallet browser or install an EVM wallet.</p>}
          <p className="fletch-wallet-picker-caption">WalletConnect is unavailable for this app. Detected browser wallets can still connect.</p>
          {error && <p className="fletch-wallet-error" role="alert">{error}</p>}
        </div>
      )}
      {!isConnected && embedded && <p className="fletch-caption">Some wallets, including Phantom, are unavailable inside previews. <a href={window.location.href} target="_blank" rel="noopener noreferrer">Open this app in a new tab</a> to connect a browser wallet.</p>}
      {isConnected && chainId !== appChain.id && <span className="fletch-caption" role="status">Switch networks before signing.</span>}
      {error && !choosing && <p className="fletch-wallet-error" role="alert">{error}</p>}
    </div>
  );
}
