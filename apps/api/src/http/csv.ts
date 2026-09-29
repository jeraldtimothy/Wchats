const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would treat as a formula
 * (= + - @, tab, CR) is prefixed with an apostrophe; plain numbers are left alone.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value !== 'number' && !NUMERIC.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
