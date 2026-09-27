import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { DataProvider } from '../fletch/data-provider';
import { useChainBlockNumber } from '../fletch/reads';
import { appChain } from '../fletch/network';
import { Panel, Row, Skeleton, Stack, Stat } from '../fletch/ui';
import '../fletch/tokens.css';
import './app.css';

function App(): ReactElement {
  const block = useChainBlockNumber();
  let value: ReactElement | string = <Skeleton />;
  if (block.isError) value = 'Unavailable';
  else if (block.data !== undefined) value = block.data.toLocaleString();
  return <main className="example-shell"><Stack><header><p className="fletch-caption">Chain Field Notes</p><h1>A clear view of the chain.</h1><p>Read the latest chain block from {appChain.name}.</p></header><div className="example-grid"><Panel><Stat label="Chain block" value={value} detail="Updates every 30 seconds"/></Panel><Panel><Stack><h2>Observation log</h2><p>No notes yet. Add your first observation when a block catches your attention.</p><Row><a href={appChain.blockExplorers.default.url}>Open the explorer</a></Row></Stack></Panel></div>{block.isError && <p role="alert">The chain could not be reached. Check your connection and try again.</p>}</Stack></main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('The page is missing its root element.');
createRoot(root).render(<DataProvider><App/></DataProvider>);
