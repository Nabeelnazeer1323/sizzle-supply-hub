# Production split and kitchen sheet correction

## Goal

Correct the automatic menu split and make the kitchen sheet reflect confirmed production immediately, while redesigning the printout as a clear, worker-friendly single-page A4 document.

## Changes

### 1. Suggestion rules

- Replace the current two-pool calculation with three explicit pools for every location and delivery day:
  - 60% meat/regular
  - 20% vegan
  - 20% vegetarian
- Apply the same rule on Storytel-only days; Storytel will no longer receive a 50% combined plant-based target.
- Use whole-number largest-remainder allocation so every location total still equals its exact requirement.
- If one dish type is unavailable, move that type’s share to the closest available pool rather than dropping portions; document and test the fallback order.
- Keep manual production and allotment overrides unchanged.

### 2. Confirmed production precedence

- Make a saved production row authoritative for that product and delivery date, including a confirmed value lower than the suggestion.
- On the kitchen sheet, use the suggestion only when no production row has been saved for that product/date. Do not calculate COOK with `max(allotted, produced)`.
- Keep saved allotments authoritative for delivery columns; use suggested allotment only where that product/day has no saved allotment yet.
- Align production query invalidation so saving Production refreshes both the daily Production view and the week-based Kitchen Sheet data.
- Preserve the existing multi-day rule: the cook-day total combines each covered delivery day, but each day uses its own confirmed production when present.

### 3. A4 kitchen sheet redesign

- Use the full portrait A4 page with two visually separate sections:
  1. **Cook list** — prominent dish names, type marker, each covered delivery day, and a large bold total-to-cook figure.
  2. **Delivery split** — a compact matrix grouped first by delivery day and then by location, with row and column totals.
- Increase core print typography and numeric emphasis, strengthen header hierarchy and table rules, and reduce nonessential copy.
- Repeat essential context at the top: cook date, ISO week, covered delivery days, and grand total.
- Keep app controls on screen but hide all navigation, selectors, and actions in print.
- Add print-specific width, spacing, row-break, and overflow rules so the content uses one A4 page whenever the current week’s data can reasonably fit.

## Verification

- Add focused tests for 60/20/20 rounding, Storytel-only days, and missing vegan/vegetarian/meat pools.
- Verify saved production above, below, and equal to the suggestion; confirm the sheet updates after save and after navigation.
- Check a multi-day dish to ensure delivery-day splits remain separate while the cook total is combined correctly.
- Print-preview the populated week 35 sheet at A4 portrait and check legibility, clipping, overflow, and page count.

## Scope

- No database or schema changes.
- Do not change requirements entry, packing, returns, orders, dashboard analytics, or authentication.
