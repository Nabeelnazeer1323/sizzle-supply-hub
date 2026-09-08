# Daily revenue bar chart on the dashboard

Add one new analytics card to the dashboard: total revenue for each of the 10 days ending on the currently selected date, as a bar chart with one bar per day. Nothing existing changes.

## What you get

A new card titled "Revenue — last 10 days":

- One bar per day for the 10 days ending on the date selected with the existing day/week picker (so you can page back to earlier weeks and see that period's revenue).
- Each bar shows that day's net revenue in SEK: paid orders minus refunds.
- A total for the whole 10-day window shown above the chart.
- Days with no orders show as zero, so the chart always has exactly 10 bars.
- Same chart styling as the existing dashboard charts, same red error alert if the data can't load.

All numbers come only from the `orders` table — the same source the current charts use.

## Technical details

- New file `src/components/RevenueLast10Days.tsx`, exporting `RevenueLast10Days`.
- Prop: `anchorDate` (the currently selected date). The 10-day window is `shiftDate(anchorDate, -9)` through `anchorDate`, converted with the existing `stockholmLocalToIso` helper from `@/lib/analytics` / `@/lib/order-import`.
- React Query key `["revenue-10-days", start, end]`, selecting `id,ordered_at,transaction_type,amount` from `orders` with `gte/lt` on `ordered_at`.
- Client-side: `PAYMENT` adds `amount`, refunds subtract `amount`; bucketed per calendar day (Stockholm date derived from `ordered_at`), then mapped to a 10-element array with zero fill.
- Chart uses `ChartContainer` + `BarChart` with a `chart-1` colour token, `ChartTooltip` showing the SEK value; totals formatted with the existing `sv-SE` SEK formatter.
- Only edit to an existing file: `src/routes/_authenticated/dashboard.tsx` gets an import plus one `<RevenueLast10Days anchorDate={date} />` render, placed below `<NonSizzleSales />`. No existing logic, query, or component is modified.
