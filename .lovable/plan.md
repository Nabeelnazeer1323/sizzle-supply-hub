# What broke the other app, and how to undo it

## What I verified against the shared backend

- `allocations` contains **56 rows, all created today (2026-08-11)** — nothing older. That table was empty before yesterday's work, so every row the customer app now sees is one this app wrote.
- We also wrote **7 rows to `production`** and **16 rows to `requirements`** today.
- No schema or security change happened: `returns` and `user_roles` still don't exist, so the `/setup` SQL (which would have enabled RLS on the shared tables) was never run. Anonymous reads still work normally.

## Why the customer app changed what it shows

1. **The allocations table went from empty to populated.** The customer app decides what a location can buy from `allocations`. With no rows it evidently fell back to showing the general menu; now it finds rows and shows exactly the 7 dishes this app allotted, per location.
2. **Wrong dishes for the day.** The allotment/packing screens filter products by `week_number` only and ignore `products.delivery_day`. Result: the rows dated **2026-08-12 (a Tuesday)** contain **Wednesday dishes** (Köttbullar, Mapo Tofu, Teriyaki kyckling) for all 8 locations — including locations that don't even take Tuesday deliveries.
3. **Week-to-date mapping doesn't match your data.** Our code maps week 33 to ISO calendar dates (Mon 2026-08-10). Your week-33 products carry `due_date` 2026-08-13/08-16, so your operational week 33 is a different calendar span. Every date we wrote is therefore in the wrong delivery week.

Net effect: the customer app is reading real-looking but fabricated allocations for the wrong dates and the wrong days.

## Fix

**Step 1 — Clean the shared data (restores the other app immediately)**
- Delete the 56 `allocations` rows created 2026-08-11 (this returns the table to its previous empty state).
- Delete the 7 `production` and 16 `requirements` rows created 2026-08-11.
- I can only do this with write access; I'll give you a short, exact SQL snippet scoped by `created_at >= '2026-08-11'` to run in your SQL editor, or you can grant this app a signed-in write path and I'll do it from here.

**Step 2 — Make this app safe against the shared backend**
- Filter products by `delivery_day` (and `is_snack`) as well as `week_number` on Production, Allotment and Packing, so Wednesday dishes can never land on a Tuesday.
- Derive the delivery date from your data (`products.due_date` / location `delivery_days`, which are lowercase) instead of ISO-week arithmetic, and only offer days a location actually receives.
- Treat writes as explicit: the Allotment page saves only when you press Save, shows exactly which rows will be written, and warns that `allocations` is live customer-facing data.
- Preserve `allocations.quantity_returned` (existing column used by the other app) rather than overwriting it.

**Step 3 — Optional guardrail**
- Add a "sandbox mode" banner and a confirmation dialog before any write to `allocations`, since that table drives customer purchasing.

## Open question

Do you want the app to keep writing to the shared `allocations` table at all, or should it write to its own table (e.g. `ops_allocations`) and only publish to `allocations` on an explicit "Publish to customer app" action? The second option makes it impossible to disturb the other project while planning.
