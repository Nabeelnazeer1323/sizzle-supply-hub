# Schema cleanup + mobile-first Sizzle Ops

## What I verified in the backend

- `products` has no `category` column. The equivalent field is `types`, an array holding `FOOD`, `SNACK`, `BREAKFAST`, `DRINK`. It also has `delivery_day`, `is_snack`, `week_number`, `due_date`.
- `requirements` has `delivery_date` plus `is_snack`, `week_number`, `year` (the latter three are `null` on older rows already).
- `production` has `production_date` plus `week_number`, `year`.
- `allocations` already has `quantity_returned` — no new table needed for returns.
- This backend is your own Supabase project reached with a publishable key, so I cannot run DDL. Any `DROP COLUMN` has to be SQL you run in the SQL editor.

## Decisions locked in

- Category = `products.types` values.
- No column drops yet: the app stops reading/writing the redundant columns now; I hand you the drop SQL to run once the customer app is confirmed clear.
- The separate `returns` table is dropped from the plan entirely; returns are an update to `allocations.quantity_returned`.
- Returns UX: pick a location, then a tap-through list with steppers and one save.

## Changes

### 1. Stop using the redundant columns

- `requirements`: derive the date only from `delivery_date`. Replace the `is_snack` flag with a `category` value taken from `products.types` (default `FOOD`), so a location can have separate FOOD / SNACK / BREAKFAST requirements for the same day. Stop writing `week_number` and `year`.
- `production`: keyed by `production_date` only; stop writing `week_number` / `year`.
- `allocations`: keyed by `delivery_date`; stop writing `week_number` / `year`, and never overwrite `quantity_returned` when saving an allotment.
- Product lookups use `week_number` + `delivery_day` for menu selection (that stays — it lives on `products`), but nothing else stores a week.

### 2. Requirements page

- One row per location per category, with the category chosen from the categories present in that week's products.
- Vegan % stays a soft target on the location.
- Rows for locations not scheduled that day stay visible but dimmed.

### 3. Returns — the driver flow

New mobile-first `/returns` screen, built for speed:

- Big location picker at the top (remembers the last one used).
- One card per delivered dish for the chosen day, showing what was sent, with a large `−` / number / `+` stepper. Everything defaults to what's already stored (0 first time).
- Quick actions: "All sold" (zero everything) and per-dish "all back" (set to the sent quantity).
- Sticky footer with running totals, waste %, and a single big Save that writes `quantity_returned` on the existing allocation rows via an update, never a delete/insert.
- Optimistic save with a toast, so the driver can leave immediately.

### 4. Mobile-first across the whole app

- The wide grids (Allotment, Requirements, Production) get a card/stacked layout below the `md` breakpoint and keep the table above it.
- Bottom tab bar navigation on mobile, sidebar/top nav on desktop.
- Larger tap targets, numeric keyboards on all quantity inputs, sticky save bars instead of buttons that scroll off.
- Packing lists become swipeable per-location cards on mobile; printing stays desktop.

### 5. Setup page

- Remove the `returns` table and its policies from the setup SQL.
- Add a clearly-labelled optional block with the `DROP COLUMN` statements for `requirements.is_snack`, `requirements.week_number`, `requirements.year`, `production.week_number`, `production.year`, `allocations.week_number`, `allocations.year` — plus the `ALTER TABLE requirements ADD COLUMN category text` you need to run before the category work goes live.

## Technical notes

- `src/lib/supabase.ts` row types updated to drop `week_number` / `year` / `is_snack` and add `category` / `quantity_returned`.
- `src/lib/week.ts` keeps ISO week helpers only for menu selection and the week picker, not for row keys.
- Returns saving uses `update ... eq('id', allocationId)` batched, so the customer app's rows keep their identity.

## One dependency

The `requirements.category` column must exist before the Requirements page can save categories. I'll include that `ALTER TABLE` at the top of the setup SQL; until you run it, the page falls back to treating everything as `FOOD`.

## Also in this pass

Existing TypeScript build errors from the previous session get fixed as part of the work: routes with required search params (`/requirements`) are missing `search` on their `Link`/`navigate`/`redirect` calls, and `WeekBar`s search reducer is typed against a required-field shape while TanStack passes a partial one. These are corrected while the pages are rewritten for mobile.
