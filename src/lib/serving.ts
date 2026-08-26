import type { Location, Product } from "@/lib/supabase";
import { deliversOn, isStorytel } from "@/lib/delivery";

/** Plant-based = vegan OR vegetarian. Both count towards the green share. */
export function isPlantBased(product: Pick<Product, "is_vegan" | "is_vegetarian">): boolean {
  return Boolean(product.is_vegan || product.is_vegetarian);
}

function sameDay(a: string | null | undefined, b: string): boolean {
  return String(a ?? "").toLowerCase() === b.toLowerCase();
}

/** Share of a location's lunches that should be plant-based. */
export function plantSharePct(location: Pick<Location, "name">): number {
  return isStorytel(location) ? 50 : 40;
}

/**
 * Does this dish go to this location on this weekday?
 *
 * Storytel runs daily and a dish can span several days
 * (products.storytel_delivery_days, e.g. Monday + Tuesday). Every other
 * location gets the dish only on its own delivery_day.
 */
export function servesOn(
  product: Pick<Product, "delivery_day" | "storytel_delivery_days">,
  location: Pick<Location, "name" | "delivery_days">,
  weekday: string,
): boolean {
  if (!deliversOn(location, weekday)) return false;
  if (isStorytel(location)) {
    const days = product.storytel_delivery_days ?? [];
    if (days.length > 0) return days.some((d) => sameDay(String(d), weekday));
  }
  return sameDay(product.delivery_day, weekday);
}

/** Every dish that reaches at least one of these locations on this weekday. */
export function productsForDay<P extends Pick<Product, "delivery_day" | "storytel_delivery_days">>(
  products: P[],
  locations: Pick<Location, "name" | "delivery_days">[],
  weekday: string,
): P[] {
  return products.filter((p) => locations.some((l) => servesOn(p, l, weekday)));
}

/** All weekdays this dish is delivered on, across every location. */
export function deliveryDaysOf(
  product: Pick<Product, "delivery_day" | "storytel_delivery_days">,
  locations: Pick<Location, "name" | "delivery_days">[],
  weekdays: readonly string[],
): string[] {
  return weekdays.filter((d) => locations.some((l) => servesOn(product, l, d)));
}
