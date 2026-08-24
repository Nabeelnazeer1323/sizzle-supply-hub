# Dish-by-location analytics on the dashboard

Add one new analytics section to the dashboard: pick a dish, see how it sold in each location over the selected timeframe (day / week / month / year). Nothing existing changes — a new self-contained component is added and rendered below the current charts.

## What you get

A new card group titled "Dish by location":

- A dropdown listing only the dishes that actually have sales in the currently selected timeframe (day, week, month, or year range chosen with the existing buttons above). It defaults to the best-selling dish of that period and resets when the period changes.
- Two small stat tiles for the chosen dish: units sold, sales value.
- A bar chart of units sold per location, styled exactly like the existing "Sales by location" chart.
- A list under the chart with each location's units and sales value for that dish, matching the current list style.
- Same empty state ("No sales in this period.") and same red error alert style when the data can't load.

All numbers come only from the `orders` table (payments only, refunds excluded), joined to their order items, products and locations — the same source the current charts use.

## Technical details

- New file `src/components/DishLocationAnalytics.tsx`, exporting `DishLocationAnalytics`.
- Props mirror the existing `OrderAnalytics` props: `period`, `anchorDate`, `fromYear`, `toYear`, `yearToDate`. It imports the `AnalyticsPeriod` type from `@/components/OrderAnalytics` (type-only, no logic touched).
- The date-window helper `analyticsRange` in `OrderAnalytics.tsx` is not exported; rather than change that file, the new component contains its own private copy of the same start/end computation (using `stockholmLocalToIso` and `shiftDate`), so behaviour matches the existing charts exactly.
- Own React Query key `["dish-location-analytics", period, start, end]`, selecting
`id,ordered_at,transaction_type,amount,locations(name),order_items(quantity,products(id,name))`
filtered with `gte/lt` on `ordered_at`, then filtered client-side to `transaction_type === "PAYMENT"`.
- Per-order amount is attributed to the selected dish proportionally by its share of that order's units, so location sales values stay consistent with order totals.
- Dropdown uses the existing shadcn `Select` component; chart uses `ChartContainer` + `BarChart` with a `chart-3` colour token so it reads as a distinct series.
- Only edit to an existing file: `src/routes/_authenticated/dashboard.tsx` gets an import plus one `<DishLocationAnalytics ... />` render below `<OrderAnalytics />`, passing the same state values already held there. No existing logic, query, or component is modified.