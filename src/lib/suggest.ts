import { largestRemainder } from "@/lib/allotment";
import { isPlantBased, plantSharePct, servesOn } from "@/lib/serving";
import type { Location, Product } from "@/lib/supabase";

export type SuggestProduct = Pick<
  Product,
  "id" | "delivery_day" | "storytel_delivery_days" | "is_vegan" | "is_vegetarian"
>;

export type SuggestLocation = Pick<Location, "id" | "name" | "delivery_days"> & {
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
 * one weekday: each location's requirement is split into a plant-based pool
 * (vegan or vegetarian dishes) and a regular pool, then shared evenly across
 * that location's dishes for the day.
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

    const plant = dishes.filter(isPlantBased);
    const regular = dishes.filter((p) => !isPlantBased(p));

    const share = plantSharePct(loc);
    let plantNeed = Math.round((required * share) / 100);
    let regularNeed = required - plantNeed;

    // If one pool has no dishes, its portion goes to the other.
    if (plant.length === 0) {
      regularNeed += plantNeed;
      plantNeed = 0;
    }
    if (regular.length === 0) {
      plantNeed += regularNeed;
      regularNeed = 0;
    }

    assign(plant, plantNeed);
    assign(regular, regularNeed);

    function assign(pool: SuggestProduct[], amount: number) {
      if (pool.length === 0 || amount <= 0) return;
      const parts = largestRemainder(amount, new Array(pool.length).fill(1));
      pool.forEach((p, i) => {
        const qty = parts[i] ?? 0;
        cells[p.id]![loc.id] = qty;
        perProduct[p.id] = (perProduct[p.id] ?? 0) + qty;
      });
    }
  }

  const total = Object.values(perProduct).reduce((a, b) => a + b, 0);
  return { cells, perProduct, total };
}
