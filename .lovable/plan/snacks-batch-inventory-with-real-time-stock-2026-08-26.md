# Snacks: batch inventory with real-time stock

Snacks work nothing like lunch: no requirements, no production, no returns. They are bought in bulk, dropped at locations, and sold off over days or weeks. So this is a separate flow with its own pages, sharing only products, locations and orders.

## The model

Two new tables, plus stock derived from them and from orders.

**Snack batches** — one row per product per location per delivery, exactly what you described plus a best-before date:

- product, location, delivered_on, quantity, unit_cost, best_before, note

Keeping the best-before on the batch (not the product) is the part that makes "what's going out of date" actually work: the same snack delivered twice sits in two batches with two dates, and the older one is flagged while the newer one is fine.

**Snack adjustments** — manual corrections: expired/thrown away, shrinkage, physical recount, transfer. Each has a quantity delta, a reason and a note, optionally tied to a batch.

**Stock is never stored.** It is computed:

```text
stock(product, location) = delivered - sold - adjusted
delivered = sum of batch quantities
sold      = order_items for that product on mapped orders at that location,
            counted from the first delivery onward (payments add, refunds subtract)
adjusted  = sum of adjustment deltas
```

Nothing to sync, nothing to drift, re-running an import can't double-count. Refreshing orders instantly moves the stock numbers.

Batch-level remaining uses FIFO: sales consume the oldest batch first, so each batch shows how much of it is still on the shelf and whether that quantity is about to expire.

## Pages

### /snacks — inventory (the main screen)

- Filter by location (remembers last used) or view all locations.
- Cards on mobile / table on desktop, one line per product × location: on hand, sold in the last 7 days, days of cover at that rate, earliest best-before, stock value at cost.
- Colour flags: red = out of stock or expired, amber = expiring within 7 days or under a week of cover, plain = fine.
- Tap a row to open a detail sheet: every batch with its delivered date, quantity, remaining, cost and best-before; recent sales; and quick "write off expired" / "recount" actions.
- Top tiles: total stock value, items out of stock, batches expiring in 7 days, units sold this week.

### /snacks/restock — the restock form

Built for entering a delivery fast on a phone:

- Pick location and delivery date (defaults to today).
- Add lines: snack product (only SNACK-category products), quantity, unit cost, best-before. Each line shows the current on-hand for that product at that location, so you see "12 left, adding 24 → 36" while typing.
- Unit cost and best-before prefill from the last batch of the same product.
- Sticky footer with line count, total units and total cost, one Save.

### /snacks/report — snack performance

Same visual language as the returns dashboard, over day/week/month/year: units sold and revenue per snack and per location, sell-through against delivered quantity, waste from expiry write-offs, and the slowest movers so you know what to stop buying.

Navigation gets a "Snacks" entry; the report is reachable from the inventory page rather than adding more bottom-tab items.

## Technical notes

- New SQL added to `/setup` (this backend is your own project, so you run it there): `snack_batches` and `snack_adjustments`, with grants and staff RLS policies matching the existing tables, plus indexes on (location_id, product_id) and best_before.
- `src/lib/snacks.ts`: batch/sales/adjustment aggregation, FIFO batch remaining, expiry and cover calculations — pure functions, unit-testable, no UI.
- Sales come from `order_items` joined to `orders` filtered to `mapping_status = 'MAPPED'` with a location, PAYMENT adding and REFUND/REFUND_CORRECTION subtracting.
- Snack products are identified with the existing `productCategory` helper (`products.types` contains SNACK), so nothing changes in the product table.
- No existing page, table or column is touched: lunch requirements, production, allotment, packing and returns are untouched.

## One thing to decide later

If a snack is ever moved between locations, the adjustment reason "transfer" covers it as two entries (out of one, into the other). A dedicated transfer action can be added later if it happens often.
