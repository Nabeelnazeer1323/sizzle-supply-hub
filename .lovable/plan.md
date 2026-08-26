# Vegan / vegetarian / meat sales on the dashboard

Add one new analytics section to the main dashboard showing how sales split between vegan, vegetarian and meat-based dishes — in total and per location — for the timeframe already selected with the existing day / week / month / year controls.

## What you get

A new section "Diet mix" placed below the existing "Dish by location" section:

- Three stat tiles: units sold for Vegan, Vegetarian and Meat, each with its share of the period's total.
- A donut/bar overview of the total split across the whole period.
- A stacked bar chart per location (same style as the existing "Units by location and type" chart), with legend and tooltips.
- A list under the chart with each location's vegan / vegetarian / meat units and the vegan+vegetarian share.
- Same empty state ("No sales in this period.") and the same red error alert as the other analytics cards.

Classification comes from the products table: a dish counts as Vegan if it is flagged vegan, Vegetarian if flagged vegetarian but not vegan, otherwise Meat. Numbers come only from the `orders` table (payments only, refunds excluded), same source as the current charts.

## Technical details

- New file `src/components/DietAnalytics.tsx`, exporting `DietAnalytics`.
- Props mirror `OrderAnalytics` / `DishLocationAnalytics`: `period`, `anchorDate`, `fromYear`, `toYear`, `yearToDate`; imports the `AnalyticsPeriod` type from `@/components/OrderAnalytics` (type-only).
- Contains its own private copy of the date-window helper (same logic as `dishAnalyticsRange` in `DishLocationAnalytics.tsx`, using `stockholmLocalToIso` and `shiftDate`) so the window matches the existing charts exactly. No existing file's logic is changed.
- Query key `["diet-analytics", period, start, end]`, selecting
  `id,ordered_at,transaction_type,amount,locations(name),order_items(quantity,products(name,is_vegan,is_vegetarian))`
  with `gte/lt` on `ordered_at`, then filtered client-side to `transaction_type === "PAYMENT"`.
- Chart uses `ChartContainer` + stacked `BarChart` with `chart-2` (vegan), `chart-4` (vegetarian) and `chart-1` (meat) colour tokens, `ChartLegend` and `ChartTooltip`, matching the existing category chart.
- Only edit to an existing file: `src/routes/_authenticated/dashboard.tsx` gets an import plus one `<DietAnalytics ... />` render below `<DishLocationAnalytics />`, passing the state values already held there.
