"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactElement } from "react";
import { NavigationLoading } from "./navigation-loading";

type Props = ComponentProps<typeof Link>;

function PendingNavigation(): ReactElement {
  const { pending } = useLinkStatus();
  return <NavigationLoading pending={pending} />;
}

// Keep Next's own pending lifecycle, including superseded and cancelled links.
export default function NavigationLink({ children, ...props }: Props): ReactElement {
  return <Link {...props}>{children}<PendingNavigation /></Link>;
}
