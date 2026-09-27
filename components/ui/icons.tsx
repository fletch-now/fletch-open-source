// Hand-drawn icon set that replaces lucide-react everywhere in this app.
//
// One hand, one rule set: 24x24, square caps, mitred joins, no rounding — a drafting
// pen rather than lucide's rounded marker. A 45-degree fletching tick shows up on a
// handful of icons (Bot's antenna, Coins, Send, Sparkles, Triangle) as a quiet nod to
// the brand mark without turning every glyph into an arrow. Curves are used only where
// the metaphor is a circle or an arc (dials, radar sweep, wifi, refresh) — everything
// else is straight segments, because that is what reads as "technical" at 16px.
//
// Each export is a thin body wrapped by IconBase, which owns the svg boilerplate
// (viewBox, stroke, cap/join, sizing) so every glyph below is just its strokes.

import type { JSX, ReactNode } from "react";

export interface IconProps {
  className?: string;
  strokeWidth?: number;
  size?: number;
}

export type IconComponent = (props: IconProps) => JSX.Element;

interface IconBaseProps extends IconProps {
  children: ReactNode;
}

function IconBase({ className, strokeWidth = 1.6, size, children }: IconBaseProps): JSX.Element {
  return (
    <svg
      width={size ?? 24}
      height={size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="4" y1="12" x2="18" y2="12" />
      <polyline points="12 6 18 12 12 18" />
    </IconBase>
  );
}

export function ArrowUpRight(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="6" y1="18" x2="18" y2="6" />
      <polyline points="9 6 18 6 18 15" />
    </IconBase>
  );
}

export function Bell(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M7 16V10C7 6.5 9 4.5 12 4.5C15 4.5 17 6.5 17 10V16" />
      <line x1="5" y1="16" x2="19" y2="16" />
      <line x1="11" y1="19" x2="13" y2="19" />
    </IconBase>
  );
}

export function Blocks(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="10" height="10" />
      <rect x="11" y="11" width="9" height="9" />
    </IconBase>
  );
}

export function Bot(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="6" y="8" width="12" height="10" />
      <line x1="12" y1="8" x2="12" y2="4" />
      {/* fletching tick on the antenna */}
      <line x1="10.5" y1="4.5" x2="13.5" y2="3.5" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function Check(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="4 12 9 17 20 6" />
    </IconBase>
  );
}

export function CheckCircle2(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <polyline points="8 12 11 15 16 9" />
    </IconBase>
  );
}

export function ChevronLeft(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="15 5 8 12 15 19" />
    </IconBase>
  );
}

export function ChevronRight(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="9 5 16 12 9 19" />
    </IconBase>
  );
}

export function CircleAlert(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function Clock3(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="12" x2="16" y2="12" />
      <line x1="12" y1="12" x2="12" y2="7" />
    </IconBase>
  );
}

export function Coins(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="10" cy="9" r="6" />
      <circle cx="15" cy="15" r="6" />
      {/* fletching tick standing in for a mint mark */}
      <line x1="8.5" y1="7.5" x2="11.5" y2="10.5" />
    </IconBase>
  );
}

export function Copy(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="11" height="11" />
      <rect x="9" y="9" width="11" height="11" />
    </IconBase>
  );
}

export function Cpu(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="7" y="7" width="10" height="10" />
      <line x1="12" y1="3" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="3" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="21" y2="12" />
    </IconBase>
  );
}

export function ExternalLink(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="9 4 4 4 4 20 20 20 20 15" />
      <line x1="13" y1="11" x2="20" y2="4" />
      <polyline points="14 4 20 4 20 10" />
    </IconBase>
  );
}

export function FileCode2(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M6 3H13L18 8V21H6Z" />
      <path d="M13 3V8H18" />
      <polyline points="9.5 13 7.5 15 9.5 17" />
      <polyline points="14.5 13 16.5 15 14.5 17" />
    </IconBase>
  );
}

export function FileCog(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M6 3H13L18 8V21H6Z" />
      <path d="M13 3V8H18" />
      <circle cx="12" cy="14.5" r="2.2" />
      <path d="M12 11.3V10.3M12 18.7V17.7M15.2 14.5H16.2M8.8 14.5H7.8" />
    </IconBase>
  );
}

export function FileJson(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M6 3H13L18 8V21H6Z" />
      <path d="M13 3V8H18" />
      <polyline points="10 12 8 12 8 18 10 18" />
      <polyline points="14 12 16 12 16 18 14 18" />
    </IconBase>
  );
}

export function FileQuestion(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M6 3H13L18 8V21H6Z" />
      <path d="M13 3V8H18" />
      <polyline points="10 12 10 11 14 11 14 13 12 13 12 15" />
      <circle cx="12" cy="17.5" r="0.8" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function FlaskConical(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="9" y1="3" x2="15" y2="3" />
      <path d="M10 3V8L5 19C4.6 20 5 21 6 21H18C19 21 19.4 20 19 19L14 8V3" />
      <line x1="8" y1="15" x2="16" y2="15" />
    </IconBase>
  );
}

export function Footprints(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <ellipse cx="8" cy="15" rx="2.4" ry="4" />
      <polyline points="6.5 10.3 7 9.3 7.5 10.3 8 9.3 8.5 10.3" />
      <ellipse cx="15.5" cy="9" rx="2.4" ry="4" />
      <polyline points="14 4.3 14.5 3.3 15 4.3 15.5 3.3 16 4.3" />
    </IconBase>
  );
}

export function Globe(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8" />
      <ellipse cx="12" cy="12" rx="3.2" ry="8" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </IconBase>
  );
}

export function Hammer(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="12" y="5" width="8" height="5" transform="rotate(45 16 7.5)" />
      <line x1="6" y1="21" x2="14" y2="13" />
    </IconBase>
  );
}

export function LayoutDashboard(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="8" height="16" />
      <rect x="14" y="4" width="6" height="7" />
      <rect x="14" y="13" width="6" height="7" />
    </IconBase>
  );
}

export function LayoutGrid(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </IconBase>
  );
}

export function LineChart(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="4 4 4 20 20 20" />
      <polyline points="7 15 11 11 14 14 19 6" />
    </IconBase>
  );
}

export function LogOut(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M13 4H7C6.4 4 6 4.4 6 5V19C6 19.6 6.4 20 7 20H13" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <polyline points="16 8 20 12 16 16" />
    </IconBase>
  );
}

export function Menu(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="15" y2="16" />
    </IconBase>
  );
}

export function MessagesSquare(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="13" height="9" />
      <polyline points="6 13 6 16 9 13" />
      <rect x="8" y="9" width="13" height="8" />
    </IconBase>
  );
}

export function PanelLeft(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </IconBase>
  );
}

export function Paperclip(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M8 12V7C8 5 9.5 4 11.5 4C13.5 4 15 5 15 7V15C15 16.5 13.8 17.5 12.5 17.5C11.2 17.5 10 16.5 10 15V8C10 7.4 10.4 7 11 7C11.6 7 12 7.4 12 8V14" />
    </IconBase>
  );
}

export function PenLine(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="18" y1="2" x2="7" y2="13" />
      <polyline points="7 13 5 17 9 15" />
      <line x1="3" y1="21" x2="13" y2="21" />
    </IconBase>
  );
}

export function Radar(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M12 6A6 6 0 0 1 18 12" />
      <path d="M12 3A9 9 0 0 1 21 12" />
      <line x1="12" y1="12" x2="18" y2="8" />
      <circle cx="17" cy="6" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function Radio(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="3" y="9" width="18" height="11" />
      <line x1="8" y1="9" x2="5" y2="3" />
      <circle cx="8" cy="15" r="2.5" />
      <line x1="14" y1="13" x2="18" y2="13" />
      <line x1="14" y1="17" x2="18" y2="17" />
    </IconBase>
  );
}

export function RotateCcw(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 11A8 8 0 1 1 6.6 16.8" />
      <polyline points="4 5 4 11 10 11" />
    </IconBase>
  );
}

export function Send(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="4" y1="20" x2="20" y2="4" />
      <polyline points="14 4 20 4 20 10" />
      {/* fletching at the tail */}
      <line x1="6" y1="17" x2="3" y2="15" />
      <line x1="8" y1="19" x2="5" y2="21" />
    </IconBase>
  );
}

export function Server(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="7" />
      <rect x="4" y="13" width="16" height="7" />
      <circle cx="7" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="7" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function Sparkles(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M12 3L13.5 10.5L21 12L13.5 13.5L12 21L10.5 13.5L3 12L10.5 10.5Z" />
      {/* small tick sparkle */}
      <line x1="18" y1="4" x2="18" y2="7" />
      <line x1="16.5" y1="5.5" x2="19.5" y2="5.5" />
    </IconBase>
  );
}

export function Triangle(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      {/* base carries a small notch, echoing the fletch mark's arrowhead */}
      <path d="M12 3L21 20H14L12 16L10 20H3Z" />
    </IconBase>
  );
}

export function Wifi(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M9 16a4 4 0 0 1 6 0" />
      <path d="M6 13a8 8 0 0 1 12 0" />
      <path d="M3 10a12 12 0 0 1 18 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// A phone, for the narrow preview: a tall frame with a short base line.
export function Phone(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="7" y="3" width="10" height="18" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </IconBase>
  );
}

// A monitor, for the wide preview: a frame on a stand.
export function Monitor(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="12" />
      <line x1="12" y1="16" x2="12" y2="20" />
      <line x1="8" y1="20" x2="16" y2="20" />
    </IconBase>
  );
}

// Three sliders, for the developer view: rails with a tick on each.
export function Sliders(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <line x1="9" y1="5" x2="9" y2="9" />
      <line x1="15" y1="10" x2="15" y2="14" />
      <line x1="7" y1="15" x2="7" y2="19" />
    </IconBase>
  );
}

// An eye, for the simple view: a lens between two straight lids.
export function Eye(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <polyline points="2 12 7 7 17 7 22 12 17 17 7 17 2 12" />
      <circle cx="12" cy="12" r="2.5" />
    </IconBase>
  );
}

// A branch, for source links: two commits on a line with a branch leaving it.
export function GitBranch(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="8" r="2" />
      <line x1="6" y1="7" x2="6" y2="17" />
      <path d="M18 10c0 4-4 4-8 4" />
    </IconBase>
  );
}
