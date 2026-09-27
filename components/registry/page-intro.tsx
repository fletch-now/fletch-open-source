import type { ReactElement, ReactNode } from "react";

interface RegistryPageIntroProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function RegistryPageIntro({ title, children, actions }: RegistryPageIntroProps): ReactElement {
  return <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
    <div className="min-w-0"><h1 className="display text-[28px] leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1><p className="mt-1 max-w-3xl text-[14px] leading-5 text-ink-soft">{children}</p></div>
    {actions ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] [&>a]:underline [&>a]:underline-offset-4">{actions}</div> : null}
  </header>;
}
