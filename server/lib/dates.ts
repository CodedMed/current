const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC. All demo data is generated and compared in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** Monday-based start of the week for `d`. */
export function startOfWeek(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day + 6) % 7;
  return addDays(d, -diff);
}

export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let cursor = from; cursor.getTime() <= to.getTime(); cursor = addDays(cursor, 1)) out.push(cursor);
  return out;
}

export function clampDayOfMonth(year: number, monthIndex: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)));
}

export function formatShortDate(iso: string): string {
  const d = parseIsoDate(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
