import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

type LayoutProps = HTMLAttributes<HTMLDivElement>;

export function Stack({ className = '', ...props }: LayoutProps): ReactElement {
  return <div className={`fletch-stack ${className}`} {...props} />;
}

export function Row({ className = '', ...props }: LayoutProps): ReactElement {
  return <div className={`fletch-row ${className}`} {...props} />;
}

export function Panel({ className = '', ...props }: LayoutProps): ReactElement {
  return <div className={`fletch-panel ${className}`} {...props} />;
}

interface StatProps { label: string; value: ReactNode; detail?: string; }

export function Stat({ label, value, detail }: StatProps): ReactElement {
  return <div className="fletch-stat"><span className="fletch-caption">{label}</span><span className="fletch-number">{value}</span>{detail && <span className="fletch-caption">{detail}</span>}</div>;
}

export function Skeleton(): ReactElement {
  return <span className="fletch-skeleton" role="status" aria-label="Loading" />;
}
