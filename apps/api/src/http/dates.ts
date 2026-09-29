import { HttpError } from './errors.js';

const DAY = 86_400_000;
const MAX_DAYS = 366;

export interface DateRange {
  /** Inclusive start (UTC midnight). */
  start: Date;
  /** Exclusive end (UTC midnight after `to`). */
  end: Date;
  from: string;
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive YYYY-MM-DD range in UTC; defaults to the last 30 days. */
export function dateRange(q: { from?: string; to?: string }, now = new Date()): DateRange {
  const to = q.to ?? iso(now);
  const from = q.from ?? iso(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY));
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new HttpError(400, 'validation', 'Invalid date.');
  if (start >= end) throw new HttpError(400, 'validation', '"From" must be on or before "to".');
  if ((end.getTime() - start.getTime()) / DAY > MAX_DAYS) {
    throw new HttpError(400, 'validation', `Pick a range of at most ${MAX_DAYS} days.`);
  }
  return { start, end, from, to };
}
