# Snacks section covers snacks, breakfast and drinks

Today the snacks area only picks up products whose category is SNACK. Everything in that section — inventory, restock list, report, and snack analytics — will be widened to also include BREAKFAST and DRINK products, with no other behaviour changes.

## What changes

- Inventory (/snacks): stock lines, alerts and totals include breakfast and drink items.
- Restock (/snacks/restock): the full list shows every snack, breakfast and drink product, with the same steppers, cost/best-before prefill and due-date failsafe.
- Report (/snacks/report) and the snack performance charts on the dashboard: sales, waste and stock value cover all three categories.
- Each row/list gets a small category label (Snacks / Breakfast / Drinks) so items are still easy to tell apart, and the restock list is grouped by category within the existing in-stock / out-of-stock grouping.

## Technical notes

- Add `PANTRY_CATEGORIES = ["SNACK", "BREAKFAST", "DRINK"]` plus an `isPantryProduct(product)` helper to `src/lib/category.ts`.
- Replace `productCategory(p) === "SNACK"` with `isPantryProduct(p)` in `src/lib/snacks-data.ts` (`useSnackProducts`) and `src/components/SnackAnalytics.tsx` (products query used for the id/name maps).
- Sales aggregation already keys off the product id set, so it automatically follows the widened set; no query or schema change is needed.
- Use `categoryLabel(productCategory(p))` for the new category labels in the restock list and report rows.
