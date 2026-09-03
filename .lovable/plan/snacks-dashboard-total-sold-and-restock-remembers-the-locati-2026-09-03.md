# Snacks dashboard: total sold, and restock remembers the location

Two small fixes on the snacks pages.

## 1. "Sold in 7 days" becomes total sold

On `/snacks`, the summary line under the status tiles currently shows "X sold in 7 days" and each row shows "X sold/7d". Both switch to the **total sold across the batches shown** for that location/filter (the same `sold` number the item sheet already displays):

- Summary line: "X sold" instead of "X sold in 7 days".
- Each row: "X sold" instead of "X sold/7d".

The sales-rate logic (`soldLast7`) stays in place because the "Running low" status still needs it; only the displayed labels change.

## 2. Restock defaults to the location you were viewing

The Restock button on `/snacks` will carry the currently selected location to the restock page (`/snacks/restock?location=<id>`). The restock page reads that parameter first and preselects it; when the dashboard was on "All locations" it falls back to the remembered/first location as today. Saving still remembers the location for next time.

## Technical notes

- `src/routes/_authenticated/snacks.tsx`: summary and row label use `line.sold` / `totals.sold`; the Restock `Link` gets `search={{ location: locationId }}`.
- `src/routes/_authenticated/snacks_.restock.tsx`: add `validateSearch` for an optional `location` string; initial `locationId` prefers the search param when it matches a known location, otherwise the existing localStorage/first-location behaviour. The existing `sizzle:last-snack-location` storage key is unchanged.
- No data or logic changes; sales computation is untouched.
