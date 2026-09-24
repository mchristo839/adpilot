/** Convert a major-unit decimal (e.g. 15.00) to integer minor units (1500). */
export function toCents(major: number | string): number {
  const n = typeof major === "string" ? Number.parseFloat(major) : major;
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${major}`);
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Fraction of the local day elapsed for a timezone, 0..1 */
export function dayFractionElapsed(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h * 60 + m) / 1440;
}

/** YYYY-MM-DD in the given timezone */
export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
