"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/ui/navigation-link";
import { Menu } from "@/components/ui/icons";
import { Sidebar, type NavKind } from "@/components/dashboard/sidebar";
import { Wordmark } from "@/components/brand/fletch-mark";
import { WalletButton } from "@/components/wallet-button";

interface AppShellProps {
  nav: NavKind;
  isAdmin: boolean;
  children: ReactNode;
}

// The rail sits in normal flow (not fixed), so the main column resizes with it
// instead of sitting under a fixed overlay. On mobile it becomes a drawer.
export function AppShell({ nav, isAdmin, children }: AppShellProps): React.ReactNode {
  const pathname = usePathname();
  // Build starts with a compact rail. A manual choice lasts until navigation.
  const onStudio = pathname.startsWith("/dashboard/build");
  const [manual, setManual] = useState<boolean | null>(null);
  const [manualFor, setManualFor] = useState(pathname);
  if (manualFor !== pathname) {
    setManualFor(pathname);
    setManual(null);
  }
  const collapsed = manual ?? onStudio;
  const shellRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggle(): void {
    setManual(!collapsed);
  }

  function closeDrawer(): void {
    setDrawerOpen(false);
  }

  useEffect(function fitKeyboardViewport() {
    if (!onStudio) return;
    const viewport = window.visualViewport;
    const shell = shellRef.current;
    function resize(): void {
      if (viewport && viewport.scale === 1 && window.innerWidth < 640) {
        shell?.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      } else {
        shell?.style.removeProperty("--app-viewport-height");
      }
    }
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return function cleanup() {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      shell?.style.removeProperty("--app-viewport-height");
    };
  }, [onStudio]);

  useEffect(function modalDrawer() {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    const panel = drawerRef.current;
    panel?.querySelector<HTMLElement>("button, a[href]")?.focus();
    function keyboard(event: KeyboardEvent): void {
      if (event.key === "Escape") { setDrawerOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = Array.from(panel?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), [tabindex='0']") ?? []).filter(function visible(item) { return item.getClientRects().length > 0; });
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    function closeOnDesktop(): void {
      if (window.innerWidth >= 640) setDrawerOpen(false);
    }
    window.addEventListener("resize", closeOnDesktop);
    document.addEventListener("keydown", keyboard);
    return function cleanup() {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", closeOnDesktop);
      document.removeEventListener("keydown", keyboard);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [drawerOpen]);

  return (
    <div ref={shellRef} className={`flex w-full ${onStudio ? "h-[var(--app-viewport-height,100dvh)] min-h-0" : "min-h-dvh"}`} style={{ "--app-viewport-height": "100dvh" } as CSSProperties}>
      <aside
        className={`hidden shrink-0 border-r border-line transition-[width] duration-300 ease-out sm:block ${
          collapsed ? "w-[60px]" : "w-[248px]"
        }`}
      >
        <div className="sticky top-0 h-dvh">
          <Sidebar nav={nav} isAdmin={isAdmin} collapsed={collapsed} onToggle={toggle} />
        </div>
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeDrawer}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
          />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Dashboard menu" className="absolute left-0 top-0 h-full w-[248px] overflow-y-auto border-r border-line shadow-xl">
            <Sidebar nav={nav} isAdmin={isAdmin} collapsed={false} onToggle={closeDrawer} onNavigate={closeDrawer} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={drawerOpen}>
        {/* On a phone the rail is a drawer, so this bar carries the menu, the
            wordmark and the wallet. On a desktop each page's own header carries
            the wallet instead, which is why there is no bar above it. */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:hidden">
          <button
            type="button"
            onClick={function openDrawer() {
              setDrawerOpen(true);
            }}
            aria-label="Open menu"
            className="rounded-md p-3 text-ink-soft transition-colors hover:bg-panel hover:text-ink"
          >
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <Link href="/" aria-label="Fletch home">
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <WalletButton tone="light" />
          </div>
        </header>
        <main className="min-h-0 min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
