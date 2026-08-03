// Single, correct CSV writer for the whole app. Every field is quoted and
// internal quotes escaped -- a value containing a comma (a team name, a rep
// name with a title) must never silently shift every column after it, which
// an unescaped `row.join(",")` would do.

export type CsvValue = string | number;

const UTF8_BOM = "﻿";

export function toCsv(rows: CsvValue[][]): string {
  // Leading BOM so Excel opens the file as UTF-8 instead of guessing (and
  // mangling) Hebrew text.
  return UTF8_BOM + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function downloadCsv(filename: string, rows: CsvValue[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
