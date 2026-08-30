# Non-Sizzle stocked sales tile on dashboard

## Goal

Show, on the main dashboard, the total sales for the selected period of all products where `stocked_by_sizzle` is FALSE or NULL, sourced from the `orders` table. Placed directly under the day/week/month/year period toggles, labeled "Non Sizzle stocked". No charts, no breakdown — just the totals.

## What exists today

- `src/routes/_authenticated/dashboard.tsx` renders the period toggles card, then `OrderAnalytics`, `DishLocationAnalytics`, `DietAnalytics`.
- `src/components/DietAnalytics.tsx` already has the exact pattern to reuse: it queries `orders` with `order_items(quantity,products(...))` for a date range derived from the selected period, filters `transaction_type === "PAYMENT"`, and has a `dietAnalyticsRange()` helper that converts period/anchor/from-to-year into an ISO date range.
- Orders store `amount` at the order level only — there is no per-item price, so item-level revenue cannot be computed. "Sales" for this tile will be **units sold**, plus the percentage share of all units in the period.

## Changes

### 1. `src/components/NonSizzleSales.tsx` (new)

- Props: same analytics props as the other sections (`period`, `anchorDate`, `fromYear`, `toYear`, `yearToDate`).
- Export the date-range helper from `DietAnalytics.tsx` (rename use only, no logic change) and reuse it so the range matches every other dashboard section.
- Query `orders` in range with `order_items(quantity,products(name,stocked_by_sizzle))`, filter to `PAYMENT` orders.
- Sum `quantity` for items whose joined product has `stocked_by_sizzle` equal to `false` or `null` (product missing → treated as non-Sizzle, since NULL counts).
- Render a single compact card titled "Non Sizzle stocked" with:
  - a big number: units sold of non-Sizzle-stocked products,
  - a sub-line: "X of Y units · Z% of all sales this period".

### 2. `src/routes/_authenticated/dashboard.tsx`

- Import and render `<NonSizzleSales ... />` immediately after the period-toggle `Card` (and before `WeekBar`/`OrderAnalytics`), passing the same analytics state.

## Notes

- No existing component or logic is modified beyond exporting the range helper; all other dashboard sections stay untouched.
- If you later want a revenue figure, we'd need a per-item price column on `order_items` — flag it and I can propose that separately.

## Verification

- Typecheck/build clean.
- Load dashboard, switch day/week/month/year, confirm the tile updates and matches a manual check against the orders data.
