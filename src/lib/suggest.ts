import { largestRemainder } from "@/lib/allotment";
import { plantSharePct, servesOn, veganShareOfPlantPct } from "@/lib/serving";
import type { Location, Product } from "@/lib/supabase";

export type SuggestProduct = Pick<
  Product,
  "id" | "delivery_day" | "storytel_delivery_days" | "is_vegan" | "is_vegetarian"
>;

export type SuggestLocation = Pick<Location, "id" | "name" | "delivery_days" | "vegan_target"> & {
  /** Lunches required at this location on the day. */
  required: number;
};

export type Suggestion = {
  /** cells[productId][locationId] */
  cells: Record<string, Record<string, number>>;
  /** Total to produce per dish for the day. */
  perProduct: Record<string, number>;
  total: number;
};

/**
 * Turn the registered requirements into a proposed production + allotment for
 * one weekday.
 *
 * Each location's requirement is split by its stored vegan_target into a
 * plant-based share (vegan + vegetarian) and a regular share. The plant-based
 * share is then split between vegan and vegetarian dishes: 50/50 for Storytel,
 * 40/60 everywhere else. Empty pools hand their portion to the closest
 * available pool (vegan <-> vegetarian first, then regular).
 */
export function suggestForDay({
  products,
  locations,
  weekday,
}: {
  products: SuggestProduct[];
  locations: SuggestLocation[];
  weekday: string;
}): Suggestion {
  const cells: Record<string, Record<string, number>> = {};
  const perProduct: Record<string, number> = {};
  for (const p of products) {
    cells[p.id] = {};
    perProduct[p.id] = 0;
  }

  for (const loc of locations) {
    const required = Math.max(0, loc.required || 0);
    if (required <= 0) continue;
    const dishes = products.filter((p) => servesOn(p, loc, weekday));
    if (dishes.length === 0) continue;

    const vegan = dishes.filter((p) => p.is_vegan);
    const vegetarian = dishes.filter((p) => !p.is_vegan && p.is_vegetarian);
    const regular = dishes.filter((p) => !p.is_vegan && !p.is_vegetarian);

    const plantNeedTotal = Math.round((required * plantSharePct(loc)) / 100);
    let regularNeed = required - plantNeedTotal;
    let veganNeed = Math.round((plantNeedTotal * veganShareOfPlantPct(loc)) / 100);
    let vegetarianNeed = plantNeedTotal - veganNeed;

    // Fallback: vegan <-> vegetarian first, then whatever is left to regular.
    if (vegan.length === 0) {
      if (vegetarian.length > 0) vegetarianNeed += veganNeed;
      else regularNeed += veganNeed;
      veganNeed = 0;
    }
    if (vegetarian.length === 0) {
      if (vegan.length > 0) veganNeed += vegetarianNeed;
      else regularNeed += vegetarianNeed;
      vegetarianNeed = 0;
    }
    if (regular.length === 0 && regularNeed > 0) {
      if (vegan.length > 0 && vegetarian.length > 0) {
        const toVegan = Math.round((regularNeed * veganShareOfPlantPct(loc)) / 100);
        veganNeed += toVegan;
        vegetarianNeed += regularNeed - toVegan;
      } else if (vegan.length > 0) {
        veganNeed += regularNeed;
      } else {
        vegetarianNeed += regularNeed;
      }
      regularNeed = 0;
    }

    assign(vegan, veganNeed);
    assign(vegetarian, vegetarianNeed);
    assign(regular, regularNeed);

    function assign(pool: SuggestProduct[], amount: number) {
      if (pool.length === 0 || amount <= 0) return;
      const parts = largestRemainder(amount, new Array(pool.length).fill(1));
      pool.forEach((p, i) => {
        const qty = parts[i] ?? 0;
        cells[p.id]![loc.id] = (cells[p.id]![loc.id] ?? 0) + qty;
        perProduct[p.id] = (perProduct[p.id] ?? 0) + qty;
      });
    }
  }

  const total = Object.values(perProduct).reduce((a, b) => a + b, 0);
  return { cells, perProduct, total };
}
