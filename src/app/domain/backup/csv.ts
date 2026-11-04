/**
 * Per-store CSV export (IMPLEMENTATION_PLAN section 14, task 3).
 *
 * Export only, deliberately: CSV cannot carry the envelope, the nested
 * snapshots or the photo blobs, so a file written here could never be read
 * back without losing something. The JSON backup is the format that round
 * trips; this one exists because people want their sets in a spreadsheet, and
 * a local-first app that will not let you do that is not really yours.
 */

/** Excel reads a file as the system codepage unless it finds this first. */
const BOM = '﻿';

/**
 * Characters that make a spreadsheet treat a cell as a formula.
 *
 * A note someone typed as "=PR attempt" becomes a live formula in Excel, and
 * one beginning "=HYPERLINK(..." or "=cmd|..." is a known attack on whoever
 * opens the file. Prefixing with a tab keeps the text readable and stops the
 * parse; the alternative, a leading apostrophe, shows up in some readers as
 * part of the value.
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * CRLF, because that is what the RFC says and what Excel expects.
 * A lone LF is read as part of the field by some Windows importers.
 */
const ROW_SEPARATOR = '\r\n';

/**
 * Renders one value as a cell.
 *
 * Objects and arrays become JSON rather than "[object Object]": a set log's
 * `custom` map and a workout's `planSnapshot` have no flat representation, and
 * a cell that says what it holds beats a cell that says nothing.
 */
export function toCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Quotes a cell if it needs it, and defuses anything a spreadsheet would run. */
export function escapeCell(raw: string): string {
  const defused = FORMULA_LEADERS.some((lead) => raw.startsWith(lead)) ? `\t${raw}` : raw;
  return /[",\r\n\t]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

/**
 * Every key any row uses, in first-seen order.
 *
 * Union rather than the first row's keys: records are sparse — an optional
 * measurement is absent, not null — so taking one row as the header would
 * silently drop whole columns from the file.
 */
export function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/**
 * One store as a CSV document.
 *
 * Returns the header alone for an empty store rather than an empty string:
 * a file with column names says "nothing here yet", and a zero-byte file says
 * "the export is broken".
 */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[] = columnsOf(rows),
): string {
  const lines = [columns.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(toCell(row[column]))).join(','));
  }
  return BOM + lines.join(ROW_SEPARATOR) + ROW_SEPARATOR;
}

/** `replog-setLogs-2026-11-04.csv`, sortable in a folder of exports. */
export function csvFileName(store: string, exportedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  return `replog-${store}-${day}.csv`;
}
