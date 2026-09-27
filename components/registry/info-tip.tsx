"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";

interface InfoTipProps {
  text: string;
  label?: string;
  align?: "start" | "end";
  triggerText?: string;
}

const EDGE = 12;
const GAP = 8;

export function InfoTip({ text, label = "What this means", align = "start", triggerText }: InfoTipProps): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: EDGE, top: EDGE });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide(): void {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function show(): void {
    cancelHide();
    setOpen(true);
  }

  function close(): void {
    cancelHide();
    pinned.current = false;
    setOpen(false);
  }

  function leave(): void {
    cancelHide();
    const focused = document.activeElement;
    if (!pinned.current && focused !== trigger.current && !panel.current?.contains(focused)) {
      hideTimer.current = setTimeout(close, 150);
    }
  }

  function blur(event: FocusEvent<HTMLElement>): void {
    if (event.relatedTarget instanceof Node
      && (trigger.current?.contains(event.relatedTarget) || panel.current?.contains(event.relatedTarget))) return;
    close();
  }

  useEffect(function clearTimerOnUnmount() {
    return function cleanup() {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useLayoutEffect(function positionExplanation() {
    if (!open) return;
    function measure(): void {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = panel.current.getBoundingClientRect();
      const desiredLeft = align === "end" ? anchor.right - box.width : anchor.left;
      const left = Math.max(EDGE, Math.min(desiredLeft, window.innerWidth - box.width - EDGE));
      const below = anchor.bottom + GAP;
      const desiredTop = below + box.height <= window.innerHeight - EDGE ? below : anchor.top - box.height - GAP;
      const top = Math.max(EDGE, Math.min(desiredTop, window.innerHeight - box.height - EDGE));
      // Portal placement depends on the rendered text and the scroll container.
      setPosition(function update(previous) {
        return previous.left === left && previous.top === top ? previous : { left, top };
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (panel.current) observer.observe(panel.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return function cleanup() {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, align]);

  useEffect(function dismissExplanation() {
    if (!open) return;
    function dismiss(event: PointerEvent | KeyboardEvent): void {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof PointerEvent && event.target instanceof Node
        && (trigger.current?.contains(event.target) || panel.current?.contains(event.target))) return;
      if (event instanceof KeyboardEvent && panel.current?.contains(document.activeElement)) trigger.current?.focus();
      pinned.current = false;
      setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return function cleanup() {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  return (
    <span className={`inline-flex align-middle ${triggerText ? "min-w-0 max-w-full" : "shrink-0"}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={function hover(event) { if (event.pointerType === "mouse") show(); }}
        onPointerLeave={leave}
        onFocus={show}
        onBlur={blur}
        onKeyDown={function focusExplanation(event) {
          if (event.key === "ArrowDown" && open) {
            event.preventDefault();
            panel.current?.focus();
          }
        }}
        onClick={function toggle() {
          if (pinned.current) close();
          else { pinned.current = true; show(); }
        }}
        className={`inline-flex min-h-7 items-center rounded-md text-ink-soft transition-colors hover:bg-panel hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hood ${triggerText ? "min-w-0 max-w-full justify-end gap-1.5 px-1 text-right" : "w-7 shrink-0 justify-center"}`}
      >
        {triggerText ? <span className="registry-metric-source-label">{triggerText}</span> : null}
        <svg aria-hidden="true" className="shrink-0" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v5" strokeLinecap="round" />
          <circle cx="10" cy="6" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open ? createPortal(
        <span
          ref={panel}
          id={id}
          role="tooltip"
          tabIndex={-1}
          onPointerDown={function focusPanel() { panel.current?.focus({ preventScroll: true }); }}
          onBlur={blur}
          onPointerEnter={cancelHide}
          onPointerLeave={leave}
          className="fixed z-[100] block w-80 max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain whitespace-pre-line rounded-xl border border-line bg-raised p-4 text-left text-[14px] font-normal normal-case leading-6 tracking-normal text-ink shadow-lg [overflow-wrap:anywhere]"
          style={{ ...position, maxHeight: "calc(100dvh - 24px)" }}
        >
          {text}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
