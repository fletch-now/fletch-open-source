import type { ReactElement, ReactNode } from "react";
import { SiteHeader } from "@/components/ui/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { SITE_NAV_LINKS } from "@/components/landing/nav-links";

export function DirectoryShell({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-paper">
      <SiteHeader links={SITE_NAV_LINKS} tone="light" />
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pb-20 pt-28 sm:px-8">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
