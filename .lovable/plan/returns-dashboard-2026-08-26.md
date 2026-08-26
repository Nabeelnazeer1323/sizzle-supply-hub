# Returns dashboard

A new page, "Returns dashboard", that measures dish and location performance from what was actually delivered and returned (the allocations records), instead of from orders. Nothing on the existing dashboard changes.

## What you get

New nav entry "Returns" analytics at `/returns-dashboard`, with the same look as the current analytics (period buttons, stat tiles, bar charts, ranked lists).

- **Timeframe picker** — day / week / month / year, identical to the existing analytics controls (including the year-range and year-to-date options).
- **Headline tiles** — delivered, returned, sold (delivered − returned), waste %, and how many delivery rows are still not logged for the period.
- **Sell-through by dish** — bar chart of sold units per dish plus a ranked list showing delivered, returned and waste % per dish. Sortable by best sellers or worst waste.
- **Sell-through by location** — same pair (bar chart + list) grouped by location.
- **Dish × location detail** — a dropdown of the dishes with deliveries in the period; picking one shows its delivered/returned/waste split per location as a bar chart plus list, mirroring the existing "Dish by location" card.
- Empty state ("No deliveries in this period.") and the same red error alert style as today.

Only rows the driver has actually logged (with a returns timestamp) count towards returned and waste figures; deliveries not yet logged are excluded from waste and surfaced in the "not logged" tile so the numbers are never diluted by missing pickups.

## Technical details

- New route `src/routes/_authenticated/returns-dashboard.tsx` with its own `head()` metadata, plus a new component `src/components/ReturnsAnalytics.tsx`. No existing component or logic is modified except two additive touches: a nav item in `src/components/AppShell.tsx` and, if needed, a type-only import of `AnalyticsPeriod` from `@/components/OrderAnalytics`.
- The route holds period state locally (same pattern as `dashboard.tsx`) and reuses the same private range computation used by `DishLocationAnalytics` (`stockholmLocalToIso` + `shiftDate`), so windows line up with existing charts.
- Single query, key `["returns-analytics", period, start, end]`:
  `allocations` selecting `location_id,product_id,delivery_date,quantity_allocated,quantity_returned,returned_at,locations(name),products(id,name,is_vegan,is_vegetarian)` filtered with `gte`/`lt` on `delivery_date` (plain dates, no timezone conversion needed for this table).
- Aggregation happens client-side into per-dish, per-location, and per-dish-per-location maps: delivered = sum of `quantity_allocated`; returned = sum of `quantity_returned` where `returned_at` is set; sold = delivered − returned; waste % = returned / delivered.
- Charts use `ChartContainer` + `BarChart` from the existing chart UI with existing colour tokens; lists and tiles reuse the current markup patterns.
