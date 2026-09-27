"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ControlPopoverProps {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
  title?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  role?: "menu" | "dialog";
}

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>("[data-popover-item]:not(:disabled):not([aria-disabled='true'])") ?? []);
}

export function ControlPopover({ label, trigger, children, disabled = false, className = "", panelClassName = "", title, align = "start", side = "bottom", role = "menu" }: ControlPopoverProps): React.ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  function close(restore = true): void {
    setRestoreFocus(restore);
    setOpen(false);
  }

  useLayoutEffect(function restoreTriggerFocus() {
    if (!open && restoreFocus) triggerRef.current?.focus();
  }, [open, restoreFocus]);

  useLayoutEffect(function positionAndFocus() {
    if (!open) return;
    function positionPanel(): void {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const width = Math.min(320, viewportWidth - 16);
      const above = Math.max(0, anchor.top - viewportTop - 16);
      const below = Math.max(0, viewportBottom - anchor.bottom - 16);
      const height = Math.min(panel.scrollHeight, 384, Math.max(above, below));
      let useTop = side === "top";
      if (useTop && above < height && below > above) useTop = false;
      if (!useTop && below < height && above > below) useTop = true;
      const left = align === "end" ? anchor.right - width : anchor.left;
      setPosition({ position: "fixed", width, left: Math.max(viewportLeft + 8, Math.min(left, viewportLeft + viewportWidth - width - 8)), top: useTop ? Math.max(viewportTop + 8, anchor.top - height - 6) : anchor.bottom + 6, maxHeight: height, visibility: "visible" });
    }
    positionPanel();
    const focusFrame = requestAnimationFrame(function focusMenu() {
      const items = menuItems(panelRef.current);
      const initial = focusLast.current ? items.at(-1) : items[0];
      (initial ?? panelRef.current)?.focus();
    });
    function outside(event: PointerEvent): void {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.visualViewport?.addEventListener("resize", positionPanel);
    window.visualViewport?.addEventListener("scroll", positionPanel);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return function cleanup() {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", outside);
      window.visualViewport?.removeEventListener("resize", positionPanel);
      window.visualViewport?.removeEventListener("scroll", positionPanel);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, align, side]);

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex]"))
        .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !panelRef.current?.contains(element));
      const index = candidates.indexOf(triggerRef.current!);
      const next = candidates[index + (event.shiftKey ? -1 : 1)];
      close(false);
      (next ?? triggerRef.current)?.focus();
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const items = menuItems(panelRef.current);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  }

  return <>
    <button ref={triggerRef} type="button" aria-label={label} aria-haspopup={role} aria-expanded={open} aria-controls={open ? id : undefined} title={title} disabled={disabled}
      className={`inline-flex h-11 sm:h-9 min-w-0 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-xs text-ink transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:opacity-50 ${className}`}
      onClick={function toggle() { focusLast.current = false; setRestoreFocus(false); setOpen(!open); }}
      onKeyDown={function openWithArrow(event) {
        if (event.key === "Escape" && open) { event.preventDefault(); close(); return; }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        setRestoreFocus(false);
        focusLast.current = event.key === "ArrowUp";
        setOpen(true);
      }}>
      {trigger}
    </button>
    {open ? createPortal(<div ref={panelRef} id={id} role={role} aria-label={label} tabIndex={-1} style={position} onKeyDown={onPanelKey}
      className={`z-[100] overflow-y-auto overscroll-contain rounded-lg border border-line bg-raised p-1 text-ink outline-none ${panelClassName}`}>
      {children(close)}
    </div>, document.body) : null}
  </>;
}

export function PopoverChevron(): React.ReactElement {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export const POPOVER_ITEM_CLASS = "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-ink hover:bg-panel focus-visible:bg-panel focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hood disabled:opacity-50";
