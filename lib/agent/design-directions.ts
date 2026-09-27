import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { needsAnalysisContext, type NeedsBrief } from "./needs-context";
import { isImageAttachment } from "@/lib/build/attachments";
import { openSourceFile } from "@/lib/source-file";

type Purpose = "finance" | "game" | "community" | "tool";
interface DesignDirection {
  id: string;
  purpose: Purpose;
  title: string;
  theme: "light" | "dark";
  colors: DesignColors;
  workflow?: string;
  layout: string;
  type: string;
  motion: string;
}

interface DesignColors {
  bg: string;
  surface: string;
  text: string;
  accent: string;
  muted: string;
  positive: string;
  negative: string;
  onAccent: string;
}

function palette(theme: "light" | "dark", bg: string, surface: string, text: string, accent: string): DesignColors {
  if (theme === "dark") {
    return { bg, surface, text, accent, muted: "#b0bcb7", positive: "#83d7a5", negative: "#ffaaa3", onAccent: "#142019" };
  }
  return { bg, surface, text, accent, muted: "#536057", positive: "#226139", negative: "#a32e3b", onAccent: "#ffffff" };
}

// These are original coordinated briefs, not imported brand templates. Only the
// selected brief enters the model context. Explicit user styling overrides it.
export const DESIGN_DIRECTIONS: readonly DesignDirection[] = [
  { id: "ledger", purpose: "finance", title: "Ruled ledger", theme: "light", colors: palette("light", "#f8f6f0", "#ffffff", "#20251f", "#28553b"), layout: "Full-width aligned rows with section totals and a slim contextual panel. Dense data, generous section gaps, square panels and 4px controls.", type: "Instrument Sans; display/heading/body/caption 32/20/16/12px. Medium labels and IBM Plex Mono amounts.", motion: "Highlight a changed row once after confirmation." },
  { id: "exchange", purpose: "finance", title: "Midnight contrast", theme: "dark", colors: palette("dark", "#141919", "#1e2727", "#eaf0e9", "#c8da85"), layout: "A broad primary workspace and narrow contextual column. Compact rows, distinct active selection, 4px panels and controls.", type: "Instrument Sans; 36/22/16/12px. Strong headings, compact labels and tabular IBM Plex Mono.", motion: "Highlight only the item whose recorded state changed." },
  { id: "treasury", purpose: "finance", title: "Editorial statement", theme: "light", colors: palette("light", "#f5f2ed", "#ffffff", "#27211f", "#923c32"), layout: "A large left-aligned introduction beside the primary task, followed by dated rows. Airy spacing, ruled sections and 2px panels.", type: "Local Georgia/system serif for display; Instrument Sans body and IBM Plex Mono amounts. Scale 48/28/17/13px.", motion: "Use a short detail disclosure; preserve the primary action position." },
  { id: "field", purpose: "game", title: "Paper field", theme: "light", colors: palette("light", "#f3f0df", "#fffdf4", "#262d21", "#4b6330"), layout: "Let the primary interactive surface dominate; put contextual information along one edge. Spacious margins, thin rules and 4px panels.", type: "Instrument Sans; 44/24/16/12px. Bold display, regular body and mono state labels.", motion: "Move only the element affected by a confirmed change." },
  { id: "arcade", purpose: "game", title: "High-contrast stage", theme: "dark", colors: palette("dark", "#161622", "#232333", "#f4edf4", "#eaae65"), layout: "One dominant action surface with a compact vertical status strip. Strong rectangular divisions, tight status rows and 6px controls.", type: "Instrument Sans; 52/26/16/12px. Heavy display, short labels and IBM Plex Mono state values.", motion: "A brief outcome transition follows an actual result." },
  { id: "tabletop", purpose: "game", title: "Warm tabletop", theme: "light", colors: palette("light", "#f4f1eb", "#ffffff", "#282420", "#89422c"), layout: "Frame the primary task with contextual details and a clear sequence below. Comfortable spacing, 20px surfaces and 10px controls.", type: "Local Georgia/system serif headings with Instrument Sans body and IBM Plex Mono values. Scale 40/26/17/13px.", motion: "Move the current-step marker while keeping controls stable." },
  { id: "poster", purpose: "community", title: "Editorial poster", theme: "light", colors: palette("light", "#f5f1df", "#fffdf5", "#24231b", "#8c3a32"), layout: "Use an asymmetric title band beside the primary task and a chronological secondary list. Large gaps, flat ruled sections and 2px controls.", type: "Instrument Sans; 56/28/16/12px. Heavy short display, regular body and mono numeric labels.", motion: "Add newly confirmed items to the list once." },
  { id: "club", purpose: "community", title: "Evening club", theme: "dark", colors: palette("dark", "#182021", "#243033", "#eff3ea", "#aad77f"), layout: "Lead with one selected item and its requested action. Place alternatives in a slim side list; use roomy 20px surfaces and 10px controls.", type: "Instrument Sans; 44/26/17/13px. Medium wide headings, open body leading and mono figures.", motion: "Reveal selected details without shifting action controls." },
  { id: "auction", purpose: "community", title: "Comparison board", theme: "light", colors: palette("light", "#f3f5f3", "#ffffff", "#202829", "#315c65"), layout: "A ranked or comparable list leads into a contextual detail panel. Align comparisons, use compact rows, rules and 4px controls.", type: "Instrument Sans; 34/22/16/12px. Medium headings, precise labels and tabular IBM Plex Mono.", motion: "Connect selected rows to their detail panel with a short transition." },
  { id: "workbench", purpose: "tool", title: "Task workbench", theme: "light", colors: palette("light", "#f5f6f3", "#ffffff", "#202720", "#3b6044"), layout: "A narrow navigation rail and a broad task area, with filters above rows. Moderate density, 6px panels and controls.", type: "Instrument Sans; 32/22/16/12px. Strong labels, regular body and mono identifiers.", motion: "Use short panel transitions and one progress indicator." },
  { id: "observatory", purpose: "tool", title: "Observation stage", theme: "dark", colors: palette("dark", "#151c24", "#202c37", "#edf2f2", "#84c7bd"), layout: "Lead with the requested result or interactive surface, then supporting comparisons. Open margins, compact annotations and 8px panels.", type: "Instrument Sans; 46/26/16/12px. Open headings, readable labels and tabular IBM Plex Mono.", motion: "Transition between results only after they load." },
  { id: "notebook", purpose: "tool", title: "Research notebook", theme: "light", colors: palette("light", "#f7f3eb", "#ffffff", "#28251f", "#725b2b"), layout: "An annotated task or reading area beside a compact result index. Comfortable reading width, generous line spacing and ruled square sections.", type: "Local Georgia/system serif headings; Instrument Sans body and IBM Plex Mono references. Scale 42/26/18/13px.", motion: "Small disclosures preserve the reader position." },
];

interface Workflow {
  id: string;
  purpose: Purpose;
  pattern: RegExp;
  guidance: string;
}

// Specific workflows precede broad categories; a ticket alone is not a game.
const WORKFLOWS: readonly Workflow[] = [
  { id: "support", purpose: "tool", pattern: /\b(support tickets?|help[ -]?desk|issue track(?:er|ing))\b/i, guidance: "Lead with support tickets, their status and selected-ticket details. Include only the creation or update actions requested in the brief." },
  { id: "payroll", purpose: "finance", pattern: /\b(payroll|salary|salaries|streaming payments?)\b/i, guidance: "Lead with recipients, accrued payments and their payment schedule. Keep the requested funding or payment action beside this ledger." },
  { id: "raffle", purpose: "game", pattern: /\b(raffle|lottery|lotteries|ticket pool|prize draw)\b/i, guidance: "Lead with the current round, entry terms and ticket participation. Show the requested entry, draw and claim steps with their actual state." },
  { id: "launchpad", purpose: "community", pattern: /\b(launchpad|token launch(?:er)?|memecoins?|bonding curve)\b/i, guidance: "Lead with the requested token launch or discovery task. Keep launch terms, token identity and any requested participation action together." },
  { id: "swap", purpose: "finance", pattern: /\b(swaps?|exchange|dex|trading|limit orders?)\b/i, guidance: "Lead with the requested swap task: token pair, amounts, quote or recorded activity. Include a trade form only when the brief requests trading." },
  { id: "finance", purpose: "finance", pattern: /\b(vault|yield|treasury|portfolio|lending|borrow|funding|staking|vesting|donations?)\b/i, guidance: "Lead with the brief's financial task, relevant balances and positions. Put the requested action beside its inputs and recorded outcomes." },
  { id: "game", purpose: "game", pattern: /\b(game|territor(?:y|ies)|chess|tic.tac.toe)\b/i, guidance: "Lead with the actual game interaction and current state. Choose a board only for a board-based game; place its requested move or action nearby." },
  { id: "community", purpose: "community", pattern: /\b(auction|community|proposals?|voting|governance)\b/i, guidance: "Lead with the active item, its terms and the requested participation task. Keep alternatives and past activity secondary." },
  { id: "tool", purpose: "tool", pattern: /[\s\S]/, guidance: "Lead with the main task described in the brief, its input and result. Choose controls and content from that workflow; preserve its read-only or signing requirements." },
];
const FILE_NAME = ".fletch-design.json";
export const PRESERVE_DESIGN_CONTEXT = "Project design: preserve the existing app's typography, palette and layout. Read the current source and DESIGN.md if present; they record the actual chosen design. Follow any explicit redesign request. Do not restore an earlier preset or select a new default during an edit or repair.";

export function chooseDesignDirection(brief: NeedsBrief, slug: string): DesignDirection {
  // Validate the complete upload; a filename is not part of the requested workflow.
  needsAnalysisContext(brief);
  const context = [...(brief.projectRequests ?? []), brief.prompt, ...(brief.attachments ?? []).flatMap((file) => isImageAttachment(file) ? [] : [file.content])].join("\n\n");
  const workflow = WORKFLOWS.find((item) => item.pattern.test(context)) ?? WORKFLOWS[WORKFLOWS.length - 1];
  const choices = DESIGN_DIRECTIONS.filter((direction) => direction.purpose === workflow.purpose);
  const seed = createHash("sha256").update(`fletch-design-v1:${slug}`).digest().readUInt32BE(0);
  return { ...choices[seed % choices.length], workflow: workflow.id };
}

export function designDirectionContext(direction: DesignDirection): string {
  const colors = direction.colors;
  const workflow = WORKFLOWS.find((item) => item.id === direction.workflow);
  const task = workflow?.guidance ?? "Derive the first screen and requested actions from the complete brief.";
  return `Project design direction: ${direction.title} (${direction.id}, v1).
Workflow: ${task}
Visual treatment adapts this workflow without adding features.
CSS defaults: color-scheme: ${direction.theme}; --bg ${colors.bg}; --surface ${colors.surface}; --text ${colors.text}; --muted ${colors.muted}; --accent ${colors.accent}; --positive ${colors.positive}; --negative ${colors.negative}; --on-accent ${colors.onAccent}. Apply --on-accent to accent-filled button text; keep focus rings visible against the surrounding surface.
Composition: ${direction.layout}
Typography (display/heading/body/caption): ${direction.type} Use installed fonts or system fallbacks; no font downloads.
Motion: ${direction.motion} Disable transitions and animations for prefers-reduced-motion.
Explicit user aesthetics override these defaults. Record actual choices in DESIGN.md; preserve them through edits and repairs.`;
}

async function savedDirection(workspace: string): Promise<string | null> {
  let handle;
  try {
    handle = await openSourceFile(join(workspace, FILE_NAME));
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_024) return PRESERVE_DESIGN_CONTEXT;
    const bytes = Buffer.alloc(1_025);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 1_024) return PRESERVE_DESIGN_CONTEXT;
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    const direction = value?.version === 1 && DESIGN_DIRECTIONS.find((item) => item.id === value.direction);
    if (!direction) return PRESERVE_DESIGN_CONTEXT;
    if (value.workflow !== undefined && !WORKFLOWS.some((item) => item.id === value.workflow && item.purpose === direction.purpose)) return PRESERVE_DESIGN_CONTEXT;
    return designDirectionContext({ ...direction, workflow: value.workflow });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return PRESERVE_DESIGN_CONTEXT;
  } finally {
    await handle?.close();
  }
}

export async function prepareDesignContext(workspace: string, brief: NeedsBrief, slug: string, followUp: boolean): Promise<string> {
  if (followUp) return PRESERVE_DESIGN_CONTEXT;
  const saved = await savedDirection(workspace);
  if (saved !== null) return saved;
  const direction = chooseDesignDirection(brief, slug);
  let handle;
  try {
    handle = await open(join(workspace, FILE_NAME), "wx", 0o600);
    await handle.writeFile(JSON.stringify({ version: 1, direction: direction.id, workflow: direction.workflow }) + "\n");
    await handle.sync();
    return designDirectionContext(direction);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return await savedDirection(workspace) ?? PRESERVE_DESIGN_CONTEXT;
    throw error;
  } finally {
    await handle?.close();
  }
}
