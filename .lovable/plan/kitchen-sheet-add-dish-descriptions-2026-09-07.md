# Kitchen sheet: add dish descriptions

## Goal

Show each dish's existing `description` value in the top "Cook today" table on the printable kitchen sheet, in a smaller font beneath the dish name within the same cell, so kitchen workers can read what each dish is without changing anything else.

## Current state

The `public.products` table already has a `description` column. The app currently does not select it, so it is not available in the kitchen sheet.

## Changes

### 1. Fetch the description column

Add `description` to `PRODUCT_COLUMNS` in `src/lib/supabase.ts` and to the `Product` type so it is loaded with the rest of the product data.

### 2. Render descriptions on the kitchen sheet

In `src/routes/_authenticated/kitchen-sheet.tsx`, inside the "Cook today" table:

- Keep the existing columns (Dish, Type, Delivery days, Cook) and formatting.
- In the first column, under each dish name, render `product.description` in a smaller, muted font within the same table cell.
- Leave the description blank/omitted when it is empty or null.

### 3. Keep existing behavior

- No schema changes, no setup SQL changes.
- No changes to suggestion logic, production/allotment, multi-day handling, color-coded delivery cards, or print styling.
- The description only appears in the top production table, not in the per-location delivery cards below.

## Scope

- Files touched:
  - `src/lib/supabase.ts` (column list + type)
  - `src/routes/_authenticated/kitchen-sheet.tsx` (render description under dish name in the same cell)
- No other routes, components, or backend logic change.
