/** Turn an array of rows into CSV text and trigger a browser download.
 *  Used by the Reports module so every report is downloadable (Framework Part 9). */

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [key, header] pairs; rows: objects keyed by those keys. */
export function toCsv(
  columns: [string, string][],
  rows: Record<string, unknown>[]
): string {
  const head = columns.map(([, h]) => esc(h)).join(",");
  const body = rows
    .map(r => columns.map(([k]) => esc(r[k])).join(","))
    .join("\n");
  return head + "\n" + body;
}

export function downloadCsv(
  filename: string,
  columns: [string, string][],
  rows: Record<string, unknown>[]
): void {
  const csv = toCsv(columns, rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${filename}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
