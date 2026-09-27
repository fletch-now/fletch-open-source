"use client";

import Link from "@/components/ui/navigation-link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Blocks,
  Cpu,
  FileJson,
  Coins,
  Globe,
  Hammer,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessagesSquare,
  PanelLeft,
  Radar,
  Send,
  Server,
  type IconComponent,
} from "@/components/ui/icons";
import { FletchMark } from "@/components/brand/fletch-mark";
import { authClient } from "@/lib/auth-client";
import { useHydratedSession } from "@/lib/auth/use-hydrated-session";
import { SystemStatus } from "@/components/dashboard/system-status";

export type NavKind = "dashboard" | "admin";

interface NavItem {
  href: string;
  label: string;
  // One short line under the label: what the page is for.
  hint: string;
  icon: IconComponent;
  exact?: boolean;
}

interface NavGroup {
  title: string | null;
  items: NavItem[];
}

// Grouped by what a person is doing: making an app, keeping an alert running,
// looking something up, managing the account. Each item carries a hint, so the
// rail explains the product on first sight.
const DASHBOARD_NAV: NavGroup[] = [
  {
    title: null,
    items: [{ href: "/dashboard", label: "Overview", hint: "Credits, apps, watchers, alerts", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "Make",
    items: [
      { href: "/dashboard/build", label: "Build", hint: "Describe an app, get the code", icon: MessagesSquare },
      { href: "/dashboard/projects", label: "Projects", hint: "Every app you have built", icon: Blocks },
      { href: "/published", label: "Published apps", hint: "Explore the public app directory", icon: Globe },
    ],
  },
  {
    title: "Keep running",
    items: [
      { href: "/dashboard/watch", label: "Watch", hint: "Transfers, token changes and pools", icon: Radar },
      { href: "/dashboard/alerts", label: "Alerts", hint: "Recorded matches and notifications", icon: Bell },
    ],
  },
  {
    title: "Look up",
    items: [
      { href: "/dashboard/registry", label: "Registry", hint: "Verified tokens on chain 4663", icon: Globe },
      { href: "/docs", label: "Docs", hint: "Build, Watch, Markets and the API", icon: FileJson },
    ],
  },
  {
    title: "Account",
    items: [{ href: "/dashboard/settings", label: "Settings", hint: "Telegram, wallet, API keys", icon: Cpu }],
  },
];

// The operator's view of the same platform.
const ADMIN_NAV: NavGroup[] = [
  {
    title: null,
    items: [{ href: "/trafalgar", label: "Overview", hint: "Health, usage, latest activity", icon: LayoutDashboard, exact: true }],
  },
  {
    title: "People and work",
    items: [
      { href: "/trafalgar/users", label: "Users", hint: "Accounts, credits, bans", icon: LayoutGrid },
      { href: "/trafalgar/pricing", label: "Build pricing", hint: "Reviewed packages and policy history", icon: Coins },
      { href: "/trafalgar/builds", label: "Builds", hint: "Every run and its log", icon: Hammer },
      { href: "/trafalgar/apps", label: "App directory", hint: "Review, feature or hide app listings", icon: Blocks },
    ],
  },
  {
    title: "Watch",
    items: [
      { href: "/trafalgar/watchers", label: "Watchers", hint: "All watchers, pause or resume", icon: Radar },
      { href: "/trafalgar/deliveries", label: "Deliveries", hint: "The outbox, retry failures", icon: Send },
      { href: "/trafalgar/registry", label: "Registry", hint: "Sync state, verified rows", icon: Globe },
      { href: "/trafalgar/tokens", label: "Tokens", hint: "What discovery found, spam floor", icon: Coins },
    ],
  },
  {
    title: "Machine",
    items: [
      { href: "/trafalgar/audit", label: "Audit", hint: "Who changed what", icon: FileJson },
      { href: "/trafalgar/system", label: "System", hint: "Daemon, sandbox, ceilings, env", icon: Server },
    ],
  },
];

interface SidebarProps {
  nav: NavKind;
  // Only the server knows this (ADMIN_WALLETS is read there), so the layout
  // passes it down; the admin link is never inferred client-side.
  isAdmin: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}

function NavLink({ item, active, collapsed, onNavigate }: NavLinkProps): React.ReactNode {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? `${item.label}: ${item.hint}` : undefined}
      className={`flex items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors ${collapsed ? "h-11" : "py-2"} ${
        active ? "bg-hood-wash text-hood-deep" : "text-ink-soft hover:bg-panel hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="block whitespace-nowrap text-[13.5px] font-medium leading-5">{item.label}</span>
          <span className={`block truncate text-[11.5px] leading-4 ${active ? "text-hood-deep/80" : "text-ink-faint"}`}>{item.hint}</span>
        </span>
      )}
    </Link>
  );
}

// The one link that crosses between the two consoles.
function crossLinkFor(nav: NavKind, isAdmin: boolean): NavItem | null {
  if (nav === "admin") {
    return { href: "/dashboard", label: "Back to dashboard", hint: "Your own account", icon: LayoutDashboard };
  }
  if (isAdmin) {
    return { href: "/trafalgar", label: "Admin", hint: "Operator console", icon: Server };
  }
  return null;
}

function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) {
    return pathname === item.href;
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Presentational: the shell owns the collapsed state so the main column can react
// to it. Labels are hidden by width, not unmounted, so the transition stays smooth.
export function Sidebar({ nav, isAdmin, collapsed, onToggle, onNavigate }: SidebarProps): React.ReactNode {
  const pathname = usePathname();
  // Another island can populate the auth cache before this sidebar hydrates.
  // Its first browser render must still match the server's signed-out markup.
  const session = useHydratedSession();
  const groups = nav === "admin" ? ADMIN_NAV : DASHBOARD_NAV;
  const crossLink = crossLinkFor(nav, isAdmin);

  async function signOut(): Promise<void> {
    await authClient.signOut();
    // Full reload on purpose: router.push keeps the stale client-side session
    // and wagmi state, so the header would render the wrong identity.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  return (
    <div className="flex h-full flex-col bg-raised">
      <div className="flex h-16 shrink-0 items-center gap-2.5 overflow-hidden border-b border-line px-4">
        <Link href="/" onClick={onNavigate} aria-label="Fletch home" className="flex min-w-0 items-center gap-2.5">
          <FletchMark size={18} className="shrink-0 text-hood" />
          {collapsed ? null : (
            <span className="display whitespace-nowrap text-[18px] text-ink">Fletch</span>
          )}
        </Link>
        {collapsed ? null : (
          <>
            {nav === "admin" ? (
              <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-paper">admin</span>
            ) : null}
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse sidebar"
              title="Collapse navigation"
              className="ml-auto hidden min-h-9 items-center gap-1.5 rounded-md px-2 text-[11px] text-ink-faint transition-colors hover:bg-panel hover:text-ink sm:flex"
            >
              <PanelLeft className="h-4 w-4" strokeWidth={1.8} />
              <span>Collapse</span>
            </button>
          </>
        )}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Open navigation"
            className="mb-1 flex h-11 items-center justify-center gap-1.5 rounded-lg text-ink-faint transition-colors hover:bg-panel hover:text-ink"
          >
            <PanelLeft className="h-4 w-4" strokeWidth={1.8} />
            <span className="sr-only">Open navigation</span>
          </button>
        ) : null}

        {groups.map(function renderGroup(group, index) {
          return (
            <div key={group.title ?? index} className={index > 0 ? "mt-2" : ""}>
              {group.title && !collapsed ? <p className="mono-label !text-[10px] px-3 pb-1 pt-1">{group.title}</p> : null}
              {group.title && collapsed ? <div className="mx-3 my-1 h-px bg-line" aria-hidden="true" /> : null}
              <div className="flex flex-col gap-0.5">
                {group.items.map(function renderItem(item) {
                  return <NavLink key={item.href} item={item} active={isActive(item, pathname)} collapsed={collapsed} onNavigate={onNavigate} />;
                })}
              </div>
            </div>
          );
        })}

        {crossLink ? (
          <div className="mt-auto border-t border-line pt-2">
            <NavLink item={crossLink} active={false} collapsed={collapsed} onNavigate={onNavigate} />
          </div>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-line pt-2">
        {nav === "dashboard" ? <SystemStatus collapsed={collapsed} signedIn={Boolean(session)} /> : null}
        {/* No guest wallet button here: it lives at the top right of the main
            column now (app-shell), where a first-time visitor actually looks. */}
        {session ? (
          <button
            type="button"
            onClick={signOut}
            title={collapsed ? "Sign out" : undefined}
            className="mx-2 mb-2 flex h-11 items-center gap-3 overflow-hidden rounded-lg px-3 text-ink-soft transition-colors hover:bg-panel hover:text-ink"
          >
            <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {collapsed ? null : <span className="whitespace-nowrap text-[13.5px] font-medium">Sign out</span>}
          </button>
        ) : null}
      </div>
    </div>
  );
}
