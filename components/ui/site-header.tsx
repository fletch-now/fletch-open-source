"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { JSX, KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import Link from "@/components/ui/navigation-link";
import { Menu } from "@/components/ui/icons";
import { FletchMark } from "@/components/brand/fletch-mark";
import { WalletButton } from "@/components/wallet-button";
import { CommunityLinks } from "@/components/landing/community-links";

interface NavLink { href: string; label: string }
interface SiteHeaderProps { links: NavLink[]; tone?: "night" | "light" }

function CloseIcon(): JSX.Element {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>;
}

function subscribeScroll(notify: () => void): () => void {
  window.addEventListener("scroll", notify, { passive: true });
  window.addEventListener("resize", notify);
  const hero = document.getElementById("hero-seam")?.parentElement;
  const observer = new ResizeObserver(notify);
  if (hero) observer.observe(hero);
  return function unsubscribe(): void {
    window.removeEventListener("scroll", notify);
    window.removeEventListener("resize", notify);
    observer.disconnect();
  };
}
function pastHeader(): boolean {
  const seam = document.getElementById("hero-seam");
  if (!seam) return window.scrollY > 48;
  const nav = document.querySelector('[aria-label="Main navigation"]')?.getBoundingClientRect();
  const middle = nav ? nav.top + nav.height / 2 : 48;
  return seam.getBoundingClientRect().top <= middle;
}
function atPageTop(): boolean { return false; }

export function SiteHeader({ links, tone = "night" }: SiteHeaderProps): JSX.Element {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const scrolled = useSyncExternalStore(subscribeScroll, pastHeader, atPageTop);
  const dark = tone === "night" && !scrolled;
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigation = links.filter(function secondary(link) { return link.href !== "/registry" && link.href !== "/dashboard/build"; });

  function closeMenu(): void { setMenuOpen(false); }

  function keepMenuFocus(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      .filter(function visible(item) { return item.getClientRects().length > 0; });
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(function mobileDialog() {
    const element = dialog.current;
    if (!menuOpen || !element) return;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    function resize(): void { if (desktop.matches) setMenuOpen(false); }
    desktop.addEventListener("change", resize);
    return function restore(): void {
      desktop.removeEventListener("change", resize);
      document.body.style.overflow = overflow;
      element.close();
    };
  }, [menuOpen]);

  return <header className="fixed inset-x-3 top-3 z-50 sm:inset-x-5 sm:top-4">
    <motion.nav aria-label="Main navigation" initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.25 }}
      data-tone={dark ? "night" : "light"}
      className={`mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-3 rounded-full border px-4 backdrop-blur-xl sm:px-6 motion-safe:transition-colors motion-safe:duration-300 ${dark ? "border-white/15 bg-night text-white shadow-[0_8px_32px_rgba(0,0,0,0.18)]" : "border-line bg-paper/95 text-ink shadow-[0_4px_24px_rgba(0,0,0,0.06)]"}`}>
      <Link href="/" aria-label="Fletch home" className="group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood"
        onClick={function home(event) {
          if (pathname === "/") {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" });
          }
        }}>
        <FletchMark size={19} className={`${dark ? "text-hood" : "text-hood-deep"} motion-safe:transition-transform motion-safe:group-hover:-rotate-6`} />
        <span className="display text-[22px] tracking-[-0.03em]">Fletch</span>
        <span className={`hidden font-mono text-[10px] sm:inline ${dark ? "text-white/65" : "text-ink-faint"}`}>beta</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">
      <div className="hidden items-center gap-1 lg:flex">
        {navigation.map(function item(link) {
          return <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-hood ${dark ? "text-white/80 hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/10" : "text-ink-soft hover:bg-panel hover:text-ink aria-[current=page]:bg-panel aria-[current=page]:text-ink"}`}>{link.label}</Link>;
        })}
      </div>
      <div className="flex items-center gap-2">
        <div aria-label="Community links" className="hidden items-center pr-2 lg:flex"><CommunityLinks compact includeGithub tone={dark ? "night" : "light"} /></div>
        <div className="hidden xl:block"><WalletButton tone={dark ? "night" : "light"} /></div>
        <Link href="/dashboard/build" className="inline-flex min-h-11 items-center justify-center rounded-full bg-hood px-5 text-[13px] font-semibold text-black transition-colors hover:bg-hood-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood-deep">Build</Link>
        <Link href="/registry" className={`hidden min-h-11 items-center rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-hood lg:inline-flex ${dark ? "border-white/30 hover:bg-white/10" : "border-line-strong hover:bg-panel"}`}>Registry</Link>
        <button type="button" onClick={function openMenu() { setMenuOpen(true); }} aria-label="Open menu" aria-haspopup="dialog" aria-controls="site-mobile-menu" aria-expanded={menuOpen}
          className={`grid h-11 w-11 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-hood lg:hidden ${dark ? "text-white hover:bg-white/10" : "text-ink hover:bg-panel"}`}><Menu className="h-5 w-5" /></button>
      </div>
      </div>
    </motion.nav>

    <dialog ref={dialog} id="site-mobile-menu" aria-label="Fletch navigation" onClose={closeMenu} onKeyDown={keepMenuFocus}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-paper p-0 text-ink backdrop:bg-black/30">
      <motion.div initial={false} animate={{ opacity: menuOpen ? 1 : 0, x: menuOpen || reducedMotion ? 0 : 24 }} transition={{ duration: reducedMotion ? 0 : 0.22 }} className="flex min-h-full flex-col px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] sm:px-8">
        <div className="flex h-16 shrink-0 items-center justify-between">
          <Link href="/" onClick={closeMenu} className="inline-flex min-h-11 items-center gap-2" aria-label="Fletch home"><FletchMark size={19} className="text-hood-deep" /><span className="display text-[22px]">Fletch</span></Link>
          <button type="button" onClick={closeMenu} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-full border border-line focus-visible:outline-2 focus-visible:outline-hood"><CloseIcon /></button>
        </div>
        <nav aria-label="Mobile navigation" className="my-auto grid gap-2 py-8">
          {navigation.map(function item(link) {
            return <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={pathname === link.href ? "page" : undefined}
              className="display flex min-h-12 items-center rounded-xl px-2 py-2 text-[clamp(1.75rem,7vw,2.5rem)] transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-hood">{link.label}</Link>;
          })}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-4">
          <div className="flex items-center" aria-label="Community links"><CommunityLinks compact includeGithub tone="light" /></div>
        </div>
        <div className="flex shrink-0 gap-3">
          <Link href="/dashboard/build" onClick={closeMenu} className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-hood px-4 text-[15px] font-semibold text-black focus-visible:outline-2 focus-visible:outline-hood-deep">Build</Link>
          <Link href="/registry" onClick={closeMenu} className="flex min-h-12 flex-1 items-center justify-center rounded-full border border-line-strong px-4 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-hood">Registry</Link>
        </div>
      </motion.div>
    </dialog>
  </header>;
}
