"use client";

import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { LoadingNotice } from "./loading-notice";

interface Props {
  pending: boolean;
}

function PendingNavigation(): ReactElement {
  const pathname = usePathname();
  return createPortal(
    <div data-navigation-loading className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-4">
      <LoadingNotice registry={pathname === "/registry" || pathname.startsWith("/registry/")} />
    </div>,
    document.body,
  );
}

export function NavigationLoading({ pending }: Props): ReactElement | null {
  return pending ? <PendingNavigation /> : null;
}
