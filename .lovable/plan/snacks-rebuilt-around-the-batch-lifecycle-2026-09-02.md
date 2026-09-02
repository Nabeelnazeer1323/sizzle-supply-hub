# Snacks, rebuilt around the batch lifecycle

The current snacks section treats stock as one running number per product per location, computed by consuming every sale ever recorded against the oldest batch. That is why it gets confusing: batches blur together, a batch that was picked up at its due date is never closed, and the restock form guesses defaults from history instead of the product record. This plan rebuilds the section around the real lifecycle you described: **delivered → sold → expired/collected → restocked**, with each batch a closed, auditable unit.

## 1. Find out what the "unknown" rows are (first step, before anything else)

I could not read your data from here, so the cause is unconfirmed. The inventory list renders "Unknown snack" whenever a batch's `product_id` has no matching row in the product list the page loads — and that list is filtered to products whose `types` contain SNACK, BREAKFAST or DRINK. Two candidates, both checkable in one query:

- the product row exists but is not tagged with any of those three categories (so it is filtered out), or
- the batch points at a product row that no longer exists / is a different week's duplicate row for the same item.

Step one is to list the distinct `product_id`s in `snack_batches` that resolve to nothing, look them up unfiltered, and report which case it is. The fix follows from the answer: if it is categorisation, the products get retagged and the page stops filtering names out; if it is duplicate/stale product rows, batches get repointed and the app keys inventory by a stable product identity instead of the week-scoped row.

Regardless of the cause, the UI will stop ever printing "Unknown": product names for inventory are looked up by id across **all** products, not only pantry-tagged ones, and any item whose category is missing is shown with a visible "needs a category" flag instead of being hidden.

## 2. Batches become real, closeable objects

Each delivery of one product to one location stays one batch row, and gains a lifecycle:

```text
ACTIVE      delivered, on the shelf
SOLD_OUT    sales consumed the whole batch
EXPIRED     past its best-before while units remain
CLOSED      picked back up / written off, with the leftover count recorded
```

New fields on `snack_batches`: `status`, `closed_on`, `closed_quantity` (units taken back), `close_reason` (collected, thrown away, moved). Closing a batch is one tap from the location view and is what stops leftovers haunting the numbers forever.

## 3. Sales are attributed per batch, by date window

Instead of FIFO over all history, sales at a location for a product are cut into windows by batch:

```text
batch window = its delivered_on  ->  the next batch's delivered_on (or its closed_on / today)
sold(batch)  = units bought at that location in that window
remaining    = quantity - sold(batch)  (and 0 once closed)
```

So a batch that sat until its due date shows exactly what it sold and exactly what was left when it was collected, and the next batch starts clean. When two batches of the same item overlap, the older one is filled first within the overlap — but the boundary is a date, not an open-ended queue, so a new delivery never rewrites the previous batch's history.

## 4. Restock form: due dates come from the product

- Best-before defaults to the product's current `due_date` from the products table. Only when that is empty does it fall back to the last batch's date, and the field always shows where the value came from.
- Cost still prefills from the last batch (that is genuinely historical), and is editable.
- The list keeps the single-list, stepper-per-row layout, grouped by category, with search — plus a "needs restock" group at the top pulling in everything that is sold out, expired, or expiring within 7 days at the chosen location.
- Saving a restock offers to close any still-open batch of the same product at that location (default on, with the leftover count prefilled from the computed remaining) so restocking and pickup are one action.

## 5. The dashboard: what is in each fridge, right now

`/snacks` becomes a per-location fridge view (location picker at top, remembered):

- Four status tiles that are also filters: **Expired**, **Sold out**, **Expiring ≤7 days**, **Running low** (under a week of cover at the recent sales rate). Tapping one filters the list to those items.
- Below, one row per product: name and category, units left, the earliest best-before with a days-left chip, and the recent daily sales rate. Colour follows the worst status.
- Tapping a row opens the item: every batch for that location with delivered date, quantity, sold in its window, remaining, best-before and status — so "what is left from which delivery" is answerable at a glance. Actions in the sheet: close batch (collected / thrown away, with leftover count), correct a count, restock this item.
- A compact "all locations" summary stays available for the overview: value on hand, out-of-stock count, expiring count, units sold this week.

## 6. Report page

The report keeps its day/week/month/year toggles and adds what the batch model now makes possible: sell-through per batch (sold ÷ delivered before it expired), waste in units and cost from closed batches, average days to sell out, and the slowest movers per location.

## Technical notes

- Migration adds `status`, `closed_on`, `closed_quantity`, `close_reason` to `snack_batches`, plus an index on `(location_id, product_id, delivered_on)`. Existing rows backfill to `ACTIVE`. Since this backend is your own project, the SQL is added to `/setup` for you to run, as before.
- `src/lib/snacks.ts` is rewritten: `buildStock` is replaced by a batch-window attribution function returning per-batch `sold`/`remaining`/`status` and a per-product roll-up. Pure functions, covered by unit tests for the tricky cases (overlapping batches, refunds, a batch closed mid-window).
- `src/lib/snacks-data.ts` loads pantry products for the restock list but resolves display names from a full product map, so nothing renders as "Unknown".
- `snacks.tsx` is rebuilt around the four status buckets and the per-batch detail sheet; `snacks_.restock.tsx` changes only its defaults, grouping and the close-batch step; `snacks_.report.tsx` and `SnackAnalytics.tsx` switch to the new aggregation.
- Nothing outside the snacks section is touched: lunch requirements, production, allotment, packing, returns and the main dashboard are unchanged.
