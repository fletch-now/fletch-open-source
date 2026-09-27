import type { ReactElement, ReactNode } from "react";

interface TableShellProps {
  children: ReactNode;
  className?: string;
  label?: string;
}

export function TableShell({ children, className = "", label = "Registry table" }: TableShellProps): ReactElement {
  return (
    <div className={`registry-table-scroll ${className}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function RegistryTableScope({ children }: { children: ReactNode }): ReactElement {
  return <div className="registry-table-scope">{children}</div>;
}
