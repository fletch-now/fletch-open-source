import type { ReactNode } from "react";

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
}

export interface TableProps {
  columns: TableColumn[];
  rows: ReactNode[][];
  caption?: string;
  dense?: boolean;
  // Inside a Panel, which already draws the border: no second frame.
  flush?: boolean;
}

interface TableRowActionsProps {
  children: ReactNode;
}

function alignClass(align: TableColumn["align"]): string {
  if (align === "right") {
    return "text-right tabular-nums";
  }
  if (align === "center") {
    return "text-center";
  }
  return "text-left";
}

// Row actions stay invisible at rest and reveal on hover or keyboard focus, so
// a scanned table shows data rather than an icon rail on every row (Pencil &
// Paper, Enterprise Data Tables). `(hover: none)` is touch: there is no hover
// to reveal them with, so they stay visible — never hover-only (WCAG 2.2).
export function TableRowActions({ children }: TableRowActionsProps): ReactNode {
  return (
    <span className="inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      {children}
    </span>
  );
}

// Two renderings of the same rows: a real `<table>` from `sm` up (still inside
// its own overflow-x-auto as a safety net for many columns), and a card list
// below `sm` where each row collapses with the column label inline next to its
// value, in the same leftmost-to-rightmost priority order as the desktop
// columns (responsive data-table pattern). No fixed row density — `dense`
// swaps between the two heights a caller chooses; there is no default that
// crams every table to fit more rows on screen.
export function Table({ columns, rows, caption, dense, flush }: TableProps): ReactNode {
  const cellPad = dense ? "px-3 py-2" : "px-3 py-3";
  const firstPad = dense ? "px-5 py-2" : "px-5 py-3";
  const cardPad = dense ? "px-4 py-2.5" : "px-4 py-3.5";

  return (
    <div className={flush ? "" : "rounded-card border border-line bg-raised"}>
      {caption ? <p className="mono-label border-b border-line px-5 py-2.5">{caption}</p> : null}

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line">
              {columns.map(function renderHead(column, index) {
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={`mono-label font-normal ${index === 0 ? "px-5" : "px-3"} py-2.5 ${alignClass(column.align)}`}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(function renderRow(row, rowIndex) {
              return (
                <tr key={rowIndex} className="group">
                  {row.map(function renderCell(cell, cellIndex) {
                    const column = columns[cellIndex];
                    return (
                      <td
                        key={column?.key ?? cellIndex}
                        className={`${cellIndex === 0 ? firstPad : cellPad} text-ink ${alignClass(column?.align)}`}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line sm:hidden">
        {rows.map(function renderCard(row, rowIndex) {
          return (
            <li key={rowIndex} className={`group ${cardPad}`}>
              <div className="text-[13.5px] font-medium text-ink">{row[0]}</div>
              <dl className="mt-1.5 flex flex-col gap-1">
                {row.slice(1).map(function renderField(cell, index) {
                  const column = columns[index + 1];
                  if (cell === null || cell === undefined) {
                    return null;
                  }
                  return (
                    <div key={column?.key ?? index} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                      <dt className="shrink-0 text-ink-faint">{column?.label}</dt>
                      <dd className={`min-w-0 text-ink ${alignClass(column?.align)}`}>{cell}</dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
