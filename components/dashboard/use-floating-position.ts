"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_KEY = "fletch.build-card.position.v1";
const MARGIN = 12;
type Point = { x: number; y: number };
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export function useFloatingPosition() {
  const cardRef = useRef<HTMLElement>(null);
  const position = useRef<Point | null>(null);
  const drag = useRef<{ pointer: number; start: Point; origin: Point } | null>(null);

  const bounds = useCallback(function bounds() {
    const viewport = window.visualViewport;
    const card = cardRef.current;
    return {
      left: (viewport?.offsetLeft ?? 0) + MARGIN,
      top: (viewport?.offsetTop ?? 0) + MARGIN,
      x: Math.max(0, (viewport?.width ?? window.innerWidth) - (card?.offsetWidth ?? 312) - MARGIN * 2),
      y: Math.max(0, (viewport?.height ?? window.innerHeight) - (card?.offsetHeight ?? 160) - MARGIN * 2),
    };
  }, []);

  const place = useCallback(function place(next: Point | null): void {
    const card = cardRef.current;
    if (!card) return;
    const area = bounds();
    card.style.left = `${area.left + (next ? clamp(next.x, 1) * area.x : area.x)}px`;
    card.style.top = `${area.top + (next ? clamp(next.y, 1) * area.y : Math.min(100, area.y))}px`;
    card.style.right = "auto";
  }, [bounds]);

  function moveTo(x: number, y: number): void {
    const area = bounds();
    position.current = { x: area.x ? clamp(x - area.left, area.x) / area.x : 0, y: area.y ? clamp(y - area.top, area.y) / area.y : 0 };
    place(position.current);
  }

  function save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position.current)); } catch { /* Dragging also works without browser storage. */ }
  }

  function reset(): void { position.current = null; place(null); save(); }

  useEffect(function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Point | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position.current = saved;
    } catch { /* Ignore an unavailable or invalid saved position. */ }
    function resize(): void { place(position.current); }
    resize();
    const observer = new ResizeObserver(resize);
    if (cardRef.current) observer.observe(cardRef.current);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return function cleanup() {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [place]);

  const handleProps = {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0 || !event.isPrimary || !cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      drag.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top } };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.pointer !== event.pointerId) return;
      moveTo(current.origin.x + event.clientX - current.start.x, current.origin.y + event.clientY - current.start.y);
    },
    onLostPointerCapture() { drag.current = null; save(); },
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key === "Home") { event.preventDefault(); reset(); return; }
      const offsets: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      const offset = offsets[event.key];
      const rect = cardRef.current?.getBoundingClientRect();
      if (!offset || !rect) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      moveTo(rect.left + offset.x * step, rect.top + offset.y * step);
      save();
    },
  };
  return { cardRef, handleProps, reset };
}
