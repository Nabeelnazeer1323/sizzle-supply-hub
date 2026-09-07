# Kitchen sheet: add dish descriptions

## Goal

Show each dish's description in the top "Cook today" table on the printable kitchen sheet, in a smaller font beneath the dish name, so kitchen workers can read what each dish is without changing anything else.

## Changes

### 1. Add a description column to products

Add a nullable `description` text column to the `public.products` table and include it in the app's product queries and type.

- SQL: `alter table public.products add column if not exists description text;`
- Add `description` to `PRODUCT_COLUMNS` in `src/lib/supabase.ts` and to the `Product` type.

### 2. Render descriptions on the kitchen sheet

In `src/routes/_authenticated/kitchen-sheet.tsx`, inside the "Cook today" table:

- Keep the existing columns (Dish, Type, Delivery days, Cook) and formatting.
- Under each dish name in the first column, render `product.description` in a smaller, muted font (e.g. `text-[10px] text-muted-foreground`).
- Leave the description blank/omitted when it is empty or null.

### 3. Keep existing behavior

- No changes to suggestion logic, production/allotment, multi-day handling, color-coded delivery cards, or print styling.
- The description only appears in the top production table, not in the per-location delivery cards below.

## Scope

- Files touched:
  - `src/routes/setup.tsx` (add the `description` column to the setup SQL block)
  - `src/lib/supabase.ts` (column list + type)
  - `src/routes/_authenticated/kitchen-sheet.tsx` (render description under dish name)
- No other routes, components, or backend logic change.
