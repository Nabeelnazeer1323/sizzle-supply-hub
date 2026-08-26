# Suggested production & allotment, multi-day dishes, kitchen sheet

## What's wrong today (verified against the live data)

- **Multi-day dishes only appear on their first day.** Every dish row carries a single `delivery_day` (e.g. "Monday") plus a `storytel_delivery_days` array (e.g. `["Monday","Tuesday"]`). Production and Allotment both filter dishes with `delivery_day === selected day` only, so Tuesday and Thursday show nothing even though Storytel gets Monday's/Wednesday's dishes on those days.
- **Nothing is suggested.** Production starts at 0 for every dish and Allotment only splits whatever production already exists. The requirement numbers (per location, per day) are never turned into a proposal.
- **Vegan is treated as vegan-only.** The split uses `is_vegan`; vegetarian dishes fall into the "regular" pool.
- **No kitchen print-out.** Packing lists exist per location, but there is no single sheet showing what to cook and how it splits.

## What we'll build

### 1. One shared rule for "which dish goes where, on which day"

New helper module (`src/lib/serving.ts`), used by Production, Allotment, Packing and the new sheet:

- Storytel: a dish serves it on a weekday if `storytel_delivery_days` contains that weekday (falls back to `delivery_day` when the array is empty).
- All other locations: a dish serves them on their `delivery_day` only, and only if the location itself delivers that weekday.

Result: Tuesday/Thursday now correctly show the Monday/Wednesday dishes for Storytel, and only for Storytel.

### 2. Suggestion engine (`src/lib/suggest.ts`)

For a chosen date, per location with a saved requirement:

- Plant-based need = requirement x plant share; the rest is regular. Plant-based counts **vegan or vegetarian**.
- Plant share: Storytel 50%, all other locations 40% (read from each location's stored target, which we'll set to those values).
- Split each pool evenly across that location's dishes for the day, using the existing largest-remainder helper so the parts sum exactly.
- Suggested production for a dish on that date = sum of its suggested location quantities.

No safety buffer — suggestions equal the requirement exactly.

### 3. Production page

- Prefills each dish with the suggested number whenever no production has been saved for that date; saved numbers always win.
- Each dish shows "suggested N" next to the stepper, with a "Reset to suggestion" action; a "Use suggestions" button refills the whole day.
- Days are split by delivery day as they are now, so Tuesday gets its own (Storytel-only) production row. The kitchen sheet is what tells the kitchen to cook Monday+Tuesday together.
- Saving production is the confirmation step — nothing else changes.

### 4. Allotment page

- Uses the new serving rule, so Storytel-only days work.
- When no allotment is saved yet, it prefills from the suggestion instead of a blank grid, then reconciles against actual production: if production differs from suggested, the pro-rata split of the real produced number is used.
- Manual overrides and the existing save/update logic (which preserves `quantity_returned` and row ids) stay exactly as they are.
- Vegan targeting inside the split switches to vegan-or-vegetarian.

### 5. Printable A4 kitchen sheet

New route `/kitchen-sheet` with the same week/day bar, linked from Production and Allotment:

- Header: cook date, week, and the delivery days it covers.
- One table: rows = dishes, columns = locations grouped by delivery day (e.g. "Mon — King, Embark, …" and "Tue — Storytel"), last column = **total to cook today**, which sums the dish across all of its delivery days.
- Plant-based dishes flagged; footer totals per column.
- Print CSS sized for a single portrait A4 (compact rows, no app chrome).

## Technical notes

- No database changes. `production`, `requirements` and `allocations` keep their current shape and keys; only the two location plant-share values are updated to 50/40.
- New files: `src/lib/serving.ts`, `src/lib/suggest.ts`, `src/routes/_authenticated/kitchen-sheet.tsx`. Edited: `production.tsx`, `allotment.tsx`, and the dish-lookup in `packing.tsx` so packing matches the new serving rule.
- `src/lib/allotment.ts` gains a "plant-based" notion (vegan OR vegetarian) without changing its distribution maths; returns, dashboard, orders and analytics are untouched.

## Suggested order of work

1. Serving rule + suggestion engine, wired into Production (fixes the missing-days bug and adds suggestions).
2. Allotment prefill and plant-based handling.
3. Kitchen sheet page.
