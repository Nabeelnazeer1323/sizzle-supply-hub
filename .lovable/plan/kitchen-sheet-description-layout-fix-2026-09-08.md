# Kitchen sheet description layout fix

## Goal

Make the dish description in the printable kitchen sheet's "Cook today" table use the full width of the first column so it wraps less and keeps the A4 sheet compact.

## Current state

The description is rendered under the dish name with `max-w-[14rem]` and `text-[10px]`, which constrains it to a narrow box and forces premature wrapping, increasing row height.

## Changes

### 1. Widen the description block

In `src/routes/_authenticated/kitchen-sheet.tsx`, inside the "Cook today" table's first cell, remove the `max-w-[14rem]` tailwind class from the description wrapper so the text can fill the column width.

### 2. Keep it compact

Keep the description font small (`text-[10px]` or similar) and maintain the same muted color. Keep it hidden when the description is null/empty.

### 3. Preserve existing behavior

- No changes to column list or product type (`description` is already in `PRODUCT_COLUMNS` and `Product`).
- No changes to the A4 print setup, margins, page-break rules, or the rest of the kitchen sheet layout.
- No changes to suggestion/allotment/production logic.

## Scope

Files touched:
- `src/routes/_authenticated/kitchen-sheet.tsx` (one class removal / layout tweak in the Dish cell)

No other routes, components, or backend logic change.
