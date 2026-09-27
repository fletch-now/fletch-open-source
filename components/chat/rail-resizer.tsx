"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const WIDTH_KEY = "fletch.build.chatWidth";
const RESIZE_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

interface RailResizerProps {
  workspaceRef: RefObject<HTMLDivElement | null>;
  conversationId: string;
  disabled: boolean;
}

export function RailResizer({ workspaceRef, conversationId, disabled }: RailResizerProps): React.ReactElement {
  const separatorRef = useRef<HTMLDivElement>(null);
  const preferredWidth = useRef<number | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, min: MIN_WIDTH, max: DEFAULT_WIDTH });
  const [dragging, setDragging] = useState(false);

  useEffect(function enableResizing() {
    const workspace = workspaceRef.current;
    const separator = separatorRef.current;
    if (!workspace || !separator || disabled) return;
    if (preferredWidth.current === null) {
      let saved = DEFAULT_WIDTH;
      try {
        const stored = Number(window.localStorage.getItem(WIDTH_KEY));
        if (Number.isFinite(stored) && stored >= MIN_WIDTH) saved = stored;
      } catch { /* Keep the preference in memory when storage is blocked. */ }
      preferredWidth.current = saved;
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    let width = DEFAULT_WIDTH;
    let min = MIN_WIDTH;
    let max = DEFAULT_WIDTH;
    let measuredWidth = 0;
    let frame: number | null = null;
    let nextWidth = width;
    let keyboardStart: number | null = null;
    let drag: { pointerId: number; origin: number; startWidth: number; startX: number; lastX: number } | null = null;

    function clamp(value: number): number {
      return Math.min(max, Math.max(min, Math.round(value)));
    }
    function apply(value: number): void {
      width = clamp(value);
      workspace!.style.setProperty("--rail-width", `${width}px`);
      setSize({ width, min, max });
    }
    function flush(): void {
      if (frame === null) return;
      cancelAnimationFrame(frame);
      frame = null;
      apply(nextWidth);
    }
    function schedule(value: number): void {
      nextWidth = value;
      if (frame !== null) return;
      frame = requestAnimationFrame(function paint() { frame = null; apply(nextWidth); });
    }
    function save(): void {
      preferredWidth.current = width;
      try { window.localStorage.setItem(WIDTH_KEY, String(width)); }
      catch { /* Resizing remains available without persistent storage. */ }
    }
    function finishDrag(commit: boolean): void {
      if (!drag) return;
      const previous = drag;
      drag = null;
      flush();
      if (commit) save();
      else apply(previous.origin);
      workspace!.removeAttribute("data-rail-dragging");
      setDragging(false);
      if (separator!.hasPointerCapture(previous.pointerId)) separator!.releasePointerCapture(previous.pointerId);
    }
    function finishKeyboard(commit: boolean): void {
      if (keyboardStart === null) return;
      flush();
      if (commit) save();
      else apply(keyboardStart);
      keyboardStart = null;
    }
    function measure(): void {
      if (!desktop.matches) { finishDrag(false); finishKeyboard(false); return; }
      const available = workspace!.getBoundingClientRect().width;
      if (available === measuredWidth) return;
      measuredWidth = available;
      max = Math.floor(available / 2);
      min = Math.min(MIN_WIDTH, max);
      flush();
      apply(drag || keyboardStart !== null ? width : preferredWidth.current ?? DEFAULT_WIDTH);
      if (drag) { drag.startWidth = width; drag.startX = drag.lastX; }
    }
    function pointerDown(event: PointerEvent): void {
      if (!desktop.matches || event.button !== 0 || drag) return;
      event.preventDefault();
      finishKeyboard(true);
      measure();
      separator!.focus();
      separator!.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, origin: width, startWidth: width, startX: event.clientX, lastX: event.clientX };
      workspace!.setAttribute("data-rail-dragging", "");
      setDragging(true);
    }
    function pointerMove(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.lastX = event.clientX;
      schedule(drag.startWidth + event.clientX - drag.startX);
    }
    function pointerUp(event: PointerEvent): void {
      if (!drag || event.pointerId !== drag.pointerId) return;
      schedule(drag.startWidth + event.clientX - drag.startX);
      finishDrag(true);
    }
    function cancelPointer(event: PointerEvent): void {
      if (drag?.pointerId === event.pointerId) finishDrag(false);
    }
    function keyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (drag || keyboardStart !== null) event.preventDefault();
        finishDrag(false); finishKeyboard(false);
        return;
      }
      if (!desktop.matches || !RESIZE_KEYS.has(event.key) || drag) return;
      event.preventDefault();
      keyboardStart ??= width;
      const step = event.shiftKey ? 50 : 10;
      let next = frame === null ? width : nextWidth;
      if (event.key === "Home") next = min;
      if (event.key === "End") next = max;
      if (event.key === "ArrowLeft") next -= step;
      if (event.key === "ArrowRight") next += step;
      schedule(clamp(next));
    }
    function keyUp(event: KeyboardEvent): void {
      if (RESIZE_KEYS.has(event.key)) finishKeyboard(true);
    }
    function blur(): void { finishDrag(false); finishKeyboard(true); }

    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    const firstMeasure = requestAnimationFrame(measure);
    desktop.addEventListener("change", measure);
    separator.addEventListener("pointerdown", pointerDown);
    separator.addEventListener("pointermove", pointerMove);
    separator.addEventListener("pointerup", pointerUp);
    separator.addEventListener("pointercancel", cancelPointer);
    separator.addEventListener("lostpointercapture", cancelPointer);
    separator.addEventListener("keydown", keyDown);
    separator.addEventListener("keyup", keyUp);
    separator.addEventListener("blur", blur);
    window.addEventListener("blur", blur);
    return function stop() {
      finishDrag(false); finishKeyboard(false);
      cancelAnimationFrame(firstMeasure);
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      desktop.removeEventListener("change", measure);
      separator.removeEventListener("pointerdown", pointerDown);
      separator.removeEventListener("pointermove", pointerMove);
      separator.removeEventListener("pointerup", pointerUp);
      separator.removeEventListener("pointercancel", cancelPointer);
      separator.removeEventListener("lostpointercapture", cancelPointer);
      separator.removeEventListener("keydown", keyDown);
      separator.removeEventListener("keyup", keyUp);
      separator.removeEventListener("blur", blur);
      window.removeEventListener("blur", blur);
    };
  }, [workspaceRef, disabled]);

  return <>
    <div ref={separatorRef} role="separator" aria-label="Resize conversation" aria-orientation="vertical"
      aria-controls={conversationId} aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={size.width} aria-valuetext={`${size.width} pixels`}
      tabIndex={disabled ? -1 : 0}
      className={`${disabled ? "hidden" : "hidden lg:flex"} absolute inset-y-0 z-20 w-2 touch-none cursor-col-resize items-center justify-center hover:bg-hood-wash focus-visible:bg-hood-wash focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hood`}
      style={{ left: "calc(var(--rail-width) - 4px)" }}>
      <span aria-hidden="true" className="h-8 w-0.5 rounded-full bg-line" />
    </div>
    {dragging && !disabled ? <div aria-hidden="true" className="fixed inset-0 z-50 hidden cursor-col-resize select-none lg:block" /> : null}
  </>;
}
