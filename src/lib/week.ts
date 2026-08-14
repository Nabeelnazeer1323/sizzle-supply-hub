export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** ISO week number for a date. */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** Date (yyyy-mm-dd) of a given ISO weekday within an ISO week. */
export function isoWeekDate(year: number, week: number, weekday: Weekday): string {
  const dayIndex = WEEKDAYS.indexOf(weekday) + 1; // Monday = 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(mondayWeek1);
  target.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7 + (dayIndex - 1));
  return target.toISOString().slice(0, 10);
}

export function weeksInYear(year: number): number {
  const dec28 = new Date(Date.UTC(year, 11, 28));
  return isoWeek(dec28).week;
}

export function previousWeek(year: number, week: number): { year: number; week: number } {
  if (week > 1) return { year, week: week - 1 };
  const prevYear = year - 1;
  return { year: prevYear, week: weeksInYear(prevYear) };
}

export function currentWeek() {
  return isoWeek(new Date());
}

export function formatWeek(year: number, week: number) {
  return `Week ${week}, ${year}`;
}

export function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Default search params for week-scoped routes. */
export function defaultWeekSearch(): { year: number; week: number; day: string } {
  const { year, week } = currentWeek();
  return { year, week, day: "Monday" };
}
