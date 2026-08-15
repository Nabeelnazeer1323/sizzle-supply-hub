# Fix the Returns logic

## What is actually wrong (traced in the code)

**1. Friday at Storytel shows the whole week.**
`returnsWindow` asks for a wide range (30 days back) and then narrows to the "strict" day. In `returns.tsx` the narrowing has a fallback: `candidates = inStrict.length > 0 ? inStrict : pending`. On Friday the strict day is Thursday, nothing was delivered on Thursday, so the strict list is empty and the page silently falls back to every unlogged delivery of the last month. Thursday works only because Wednesday genuinely has rows.

**2. A dish that runs Monday and Tuesday disappears after the first pickup.**
Allotment writes one `allocations` row per product per `delivery_date`, and a dish only has one `delivery_day`. A dish that Storytel serves Monday *and* Tuesday therefore has a single row. Logging the pickup on Tuesday stamps `returned_at` on that one row, so on Wednesday there is nothing left to count for Tuesday's batch. One row cannot hold two pickups.

**3. Storytel days come from the wrong place.**
The window is decided from the location (previous weekday), and `storytel_delivery_days` is only used afterwards to filter the list. It has to be the other way round: the dish's own `storytel_delivery_days` in the products table decides which days it was in the fridge.

**4. Other locations can see current-week dishes.**
`returnsWindow` stretches `end` forward to the last delivery day when it is later than last Friday, and the wide fallback in point 1 pulls in more. Returns for a weekly location must only ever be last week.

## The fix

### Pickups become their own record
Add a `pickups` table: location, product, the delivery date the food came from, the pickup date, and the quantity returned. Returns are logged there instead of stamping the single allocation row, so Tuesday's and Wednesday's counts for the same dish stay apart. `allocations.quantity_returned` keeps being updated with the running total so the rest of the app and reporting are unchanged.

### Storytel: driven by the dish, not the location
Pickup on day D covers the previous delivery day (Monday covers Friday). A dish appears if its `storytel_delivery_days` includes that previous day and it was allotted to Storytel in that week. Each day gets its own line, so a Monday+Tuesday dish is counted on Tuesday for Monday and again on Wednesday for Tuesday.

### Other locations: strictly last week
Monday–Friday of the previous ISO week, nothing from the current week, no wide fallback. All dishes delivered across that whole week show at once.

### Empty days
When nothing is due, the page says so. Below it, a small collapsed "Still open" section lists older deliveries never logged, so a skipped day can be caught up without polluting the normal list.

## Technical notes

- Migration: `create table public.pickups (id uuid pk default gen_random_uuid(), location_id uuid, product_id uuid, delivery_date date, pickup_date date, quantity_returned int not null default 0, created_at timestamptz default now(), unique (location_id, product_id, delivery_date, pickup_date))`, followed by `grant select, insert, update, delete ... to authenticated`, `grant all ... to service_role`, `enable row level security`, and a policy allowing signed-in staff. Purely additive; the customer-facing app is untouched. The SQL goes into `/setup` alongside the existing statements.
- `src/lib/delivery.ts`: `returnsWindow` is replaced by `pickupsDue(location, date, allocations, products)` returning one entry per (allocation, source day). Storytel expands rows over `storytel_delivery_days`; weekly locations return one entry per allocation in the previous ISO week. `end` no longer stretches into the current week and the `inStrict ? : pending` fallback is deleted.
- `src/routes/_authenticated/returns.tsx`: query allocations for the previous week (and, for Storytel, the week containing the previous delivery day), join the already-saved `pickups` rows to hide what is done, and save through `pickups` upsert plus a `quantity_returned` total update on the allocation. `returned_at` is no longer the pending marker.
- "Still open" list = deliveries older than the current window with no matching `pickups` row, rendered collapsed under the main list.
- The week/day bar, the "All sold" one-tap save and the per-dish stepper stay exactly as they are.
