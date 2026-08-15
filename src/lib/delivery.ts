import type { Location, Product } from "@/lib/supabase";

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Weekday name of a yyyy-mm-dd date. */
export function weekdayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return DAY_NAMES[d.getUTCDay()]!;
}

/** Does this location get a delivery on the given weekday? */
export function deliversOn(
  location: Pick<Location, "delivery_days">,
  weekday: string,
): boolean {
  return (location.delivery_days ?? []).some(
    (d) => String(d).toLowerCase() === weekday.toLowerCase(),
  );
}

/** Storytel is the daily location with its own next-day pickup rhythm. */
export function isStorytel(location: Pick<Location, "name">): boolean {
  return location.name.toLowerCase().includes("storytel");
}

/** Previous weekday (Monday looks back to Friday). */
export function previousWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Monday–Friday of the week before the one containing `iso`. */
export function previousWeekRange(iso: string): { start: string; end: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7; // Monday = 1
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (dayNum - 1) - 7);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { start: monday.toISOString().slice(0, 10), end: friday.toISOString().slice(0, 10) };
}

/** Is this dish part of Storytel's run on the given weekday? */
export function storytelDeliversOn(
  product: Pick<Product, "storytel_delivery_days">,
  weekday: string,
): boolean {
  const days = product.storytel_delivery_days;
  if (!days || days.length === 0) return true;
  return days.some((d) => String(d).toLowerCase() === weekday.toLowerCase());
}

/**
 * Which deliveries are up for pickup on `iso`.
 *
 * Storytel is collected the next delivery day (Monday collects Friday).
 * Every other location is a weekly run: the whole previous week comes back at
 * once. Both windows reach further back so anything never logged stays visible
 * instead of getting stranded.
 */
export function returnsWindow(
  location: Pick<Location, "name"> | undefined,
  iso: string,
): {
  /** Wide query range — everything that could still be outstanding. */
  start: string;
  end: string;
  /** The run that is actually due today. */
  strictStart: string;
  strictEnd: string;
  mode: "storytel" | "weekly";
} {
  const back = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };

  const lastDelivery = previousWeekday(iso);

  if (location && isStorytel(location)) {
    return {
      start: back(lastDelivery, 30),
      end: lastDelivery,
      strictStart: lastDelivery,
      strictEnd: lastDelivery,
      mode: "storytel",
    };
  }

  const { start, end } = previousWeekRange(iso);
  return {
    start: back(start, 28),
    // Never ask for food that has not been delivered yet.
    end: lastDelivery > end ? lastDelivery : end,
    strictStart: start,
    strictEnd: end,
    mode: "weekly",
  };
}
