# Snacks dashboard overview banner

Add a compact, at-a-glance section at the top of `/snacks` that highlights products running low or expiring soon across all locations. It should make it obvious what needs attention before the user scrolls into the full inventory list.

## What the section shows

- A single card/banner directly under the page header, only rendered when there is at least one item that is not "ok".
- It lists every location/product line whose `StockStatus` is `expired`, `out`, `expiring`, or `low`, grouped and ordered by severity:
  1. Expired / sold out (destructive tone)
  2. Expiring soon (amber tone)
  3. Running low (amber/muted tone)
- Each row shows:
  - product name,
  - location name,
  - current on-hand quantity,
  - a short status label (e.g. "3 left · expires 12 Sep" / "none left" / "~2 days cover"),
  - a one-tap action that either opens the product sheet or, when applicable, goes straight to restock for that location.

## UI direction

- Keep it scannable: small cards or a dense list, two columns on desktop, single column on mobile, using the same color coding already present in the inventory list (`TONE_CLASS`, `StatusBadge`).
- If nothing needs attention, show a small reassuring line like "All snacks look fine" instead of an empty card.
- Clicking a row sets the location filter and/or opens the existing product sheet (`openKey`) so the user can act immediately.

## Data and scope

- Reuse the existing `lines` returned by `useSnackInventory()`; no new tables or queries are needed.
- Derive the "attention" list in a `useMemo` by filtering `lines` where `status !== "ok"` and sorting with the existing `STATUS_ORDER`.
- "Expiring soon" uses the same 7-day window as the rest of the page (`expiringWithinDays`).

## Files to change

- `src/routes/_authenticated/snacks.tsx`: add the overview component and render it above the location selector / filter grid. Extract a small local component or inline it; do not create a new page or route.
- No changes to `src/lib/snacks.ts`, `src/lib/snacks-data.ts`, or the restock/report pages.
