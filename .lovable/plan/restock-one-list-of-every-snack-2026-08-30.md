# Restock: one list of every snack

Right now the restock page starts with an empty line and you pick a snack per line. Replace that with a single list of every snack product at the chosen location, so you walk the shelf top to bottom and type numbers.

## The page

- Location + delivery date stay at the top exactly as they are (location still remembered from last use).
- Below: every SNACK product, one compact row each, sorted with **in stock** first and **out of stock** grouped under an "Out of stock" heading so the empty shelves are obvious. A small search box filters the list by name when it gets long.
- Each row shows: snack name, current on-hand at that location ("12 left" / "none left" in red), a quantity stepper defaulting to 0, and — only once the quantity goes above 0 — the cost per item and best-before fields, prefilled from that snack's last batch.
- Best-before failsafe: if the field is left blank, the saved batch uses the product's `due_date` from the `products` table instead, so no batch is ever saved without an expiry.
- Rows with a quantity above 0 get a highlighted border and show "12 → 36" so you can see the resulting stock while typing.
- The sticky save bar keeps counting lines, units and total cost, and saves only the rows with a quantity above 0 — same insert into `snack_batches` as today.

Nothing else changes: no new tables, no change to how stock is computed, and the inventory and report pages are untouched.

## Technical notes

- Rewrite `src/routes/_authenticated/snacks_.restock.tsx` only. Line state becomes a `Record<productId, { quantity, unit_cost, best_before }>` keyed by product, reset when the location changes.
- On-hand per product comes from the existing `useSnackInventory()` `lines` via `stockKey(locationId, productId)`; prefill defaults from the newest batch of that product (existing `lastBatchOf` logic).
- Add `due_date` to `PRODUCT_COLUMNS` in `src/lib/supabase.ts` and to the `Product` type, so the restock page can read it.
- Save maps the non-zero entries to the same `snack_batches` insert payload as today, but `best_before` falls back to the product's `due_date` when the field is blank (`line.best_before || product.due_date || null`).
