import type { Product } from "@/lib/supabase";

/** Categories carried on products.types. */
export const CATEGORIES = ["FOOD", "SNACK", "BREAKFAST", "DRINK"] as const;
export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_CATEGORY: Category = "FOOD";

/** Categories handled by the snacks (pantry) section: snacks, breakfast and drinks. */
export const PANTRY_CATEGORIES = ["SNACK", "BREAKFAST", "DRINK"] as const;
export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

/** True when a product belongs to the snacks section (snack, breakfast or drink). */
export function isPantryProduct(product: Pick<Product, "types" | "is_snack">): boolean {
  return (PANTRY_CATEGORIES as readonly string[]).includes(productCategory(product));
}

/** The primary category of a product, derived from products.types. */
export function productCategory(product: Pick<Product, "types" | "is_snack">): Category {
  const tags = (product.types ?? []).map((t) => String(t).toUpperCase());
  for (const c of CATEGORIES) {
    if (tags.includes(c)) return c;
  }
  return product.is_snack ? "SNACK" : DEFAULT_CATEGORY;
}

export function categoryLabel(category: string): string {
  const c = category.toUpperCase();
  if (c === "FOOD") return "Lunch";
  if (c === "SNACK") return "Snacks";
  if (c === "BREAKFAST") return "Breakfast";
  if (c === "DRINK") return "Drinks";
  return category;
}

/** Distinct categories present in a set of products, in a stable order. */
export function categoriesOf(products: Pick<Product, "types" | "is_snack">[]): Category[] {
  const found = new Set(products.map(productCategory));
  const list = CATEGORIES.filter((c) => found.has(c));
  return list.length > 0 ? list : [DEFAULT_CATEGORY];
}

export function normalizeCategory(value: string | null | undefined): Category {
  const c = (value ?? "").toUpperCase();
  return (CATEGORIES as readonly string[]).includes(c) ? (c as Category) : DEFAULT_CATEGORY;
}
