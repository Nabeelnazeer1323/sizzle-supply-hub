# Kitchen sheet: color-coded delivery-day cards

## Goal

Make each delivery day visually distinct on the kitchen sheet so kitchen workers can instantly tell which day a location card belongs to, without relying only on the small day abbreviation in the corner.

## Approach

On the per-location cards in `src/routes/_authenticated/kitchen-sheet.tsx`:

- Add a full-width colored header bar across the top of each card showing the day name in bold (e.g. "MONDAY", "TUESDAY"), instead of the current small day abbreviation in the corner.
- Assign each weekday a fixed, print-safe color so the same day always looks the same across weeks:
  - Monday, Tuesday, Wednesday, Thursday, Friday each get a distinct solid background tint (e.g. a muted hue per day) with high-contrast day text.
- The location name moves into the card body (or sits below the day bar) so the day bar is the dominant visual signal.
- Keep the colored bar readable in print: use solid background fills with dark or white text per contrast, and ensure the color survives the `@media print` rules (no `background: #fff` override wiping it out — scope that override to `body` only).
- Keep the existing card content (dish lines, totals) unchanged.

## Scope

- Touch only `src/routes/_authenticated/kitchen-sheet.tsx` (card header markup + a small day→color map).
- No database, schema, suggestion, production, or allotment changes.
