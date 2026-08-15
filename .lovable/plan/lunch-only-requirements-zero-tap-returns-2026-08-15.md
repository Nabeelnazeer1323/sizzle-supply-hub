# Lunch-only requirements + zero-tap returns

## 1. Requirements page: lunch only, delivery days only

- Drop the category selector entirely. Every requirement row is lunch (`FOOD`), one row per location per delivery date.
- Only render locations whose `delivery_days` contains the selected weekday. A house, Tobii, King, Embark, Nordnet, Schibsted are Monday/Wednesday only, so they disappear on Tuesday/Thursday/Friday; Storytel shows every weekday.
- If no location delivers on the chosen day, show a clear "No deliveries scheduled" state instead of an empty grid.
- Vegan % stays per location as a soft target.

Same delivery-day filter is applied to Allotment and Packing so the three pages agree on who is being served that day.

## 2. Returns: the driver never picks a date

Opening `/returns` uses today's date and immediately shows exactly what needs picking up, per location. Two rules, chosen automatically by location:

**Storytel** — picks up yesterday's food. For today's date we look one delivery day back (Monday looks back to Friday) and list the dishes delivered on that date. Product-level check uses `products.storytel_delivery_days`: a dish listed for Monday+Tuesday is delivered Monday and picked up Tuesday.

**All other locations** — weekly pickup. On their delivery day we list every dish delivered to them during the previous week (both the Monday and the Wednesday drop), so Monday's visit shows all of last week's dishes at once.

Screen behaviour:

- Location picker at the top only (remembers the last one). No day stepper in the main flow; a small "change date" affordance stays available for corrections.
- One row per dish: name, quantity sent, and a single number input defaulting to 0.
- Rows already accounted for (a returns figure was saved) drop off the list, so a second visit doesn't re-ask.
- One **Save** at the bottom, plus **All sold** which writes 0 for every listed dish in one action — nothing is recorded as accounted until he saves.
- Saving writes `quantity_returned` on the existing `allocations` rows by id; nothing is inserted or deleted.

## Technical notes

- New `src/lib/delivery.ts`: `deliversOn(location, weekday)` (matches `locations.delivery_days`, case-insensitive), `storytelPickupDate(date)` (previous weekday, skipping the weekend), and `previousWeekRange(date)` (Mon–Fri of the prior ISO week).
- Storytel is detected by its location name/id; product eligibility for a given Storytel delivery day is validated against `products.storytel_delivery_days`.
- Returns query becomes a date-range query on `allocations` (`delivery_date` in range, `location_id` = picked location) with `quantity_returned is null` for the pending list.
- Requirements save always writes `category = 'FOOD'` (falls back silently if the column isn't there yet); `src/lib/category.ts` shrinks to the lunch helpers still used by product filtering.
