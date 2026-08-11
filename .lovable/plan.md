# Sizzle — Weekly Production, Allotment, Packing & Returns

An internal web app for running the weekly food cycle: capture location requirements, generate a production register from the week's menu, allot output across locations, print packing lists, and record returns from the prior week.

Connects to your existing Supabase project (URL + publishable key you provided). No OAuth — email/password sign-in with roles.

## Step 0 — Connect and read your schema (first thing I do)

Your tables already exist, so before building any screens I will:
- Wire the project to `https://bovopbgjrgjjratouilb.supabase.co` with the publishable key.
- Introspect the existing tables/columns and map them to the concepts below (locations, dishes/menu-by-week, production, allotment, returns).
- Report back the mapping, plus a short list of anything missing that needs an added table or column (e.g. `vegan_pct` on locations, an `allotments` table, a `returns` table). Missing pieces get added by migration — nothing existing is renamed or dropped without asking.

Everything after this step assumes that mapping. If a core table is absent, I'll confirm the shape with you before creating it.

## Pages

**1. Requirements (per week)**
- Pick a week and a day. Table of all locations with: total meal requirement, vegan % (0–100).
- Auto-derived vegan vs non-vegan counts shown live.
- Saved per location per day so the week can be planned ahead and edited.

**2. Production Register**
- Pick week/day. Pulls that day's dishes from the menu data in your DB, split vegan / non-vegan.
- Shows total required (sum of requirements, with the vegan split) as the target.
- Kitchen enters actual quantity produced per dish. Saving locks a "production total" for the day.

**3. Allotment**
- Grid: dishes (rows) x locations (columns).
- Auto-fills proportionally — each location's share of a dish = its requirement ÷ total requirement, rounded to whole units with remainders distributed largest-first so the column totals exactly match production.
- Vegan is a **soft target**: vegan dishes are allotted first against each location's vegan count; if vegan production falls short, the gap is filled with non-vegan dishes and the row is flagged "vegan short by N" rather than blocking.
- Every cell is manually editable. Live validation shows over/under-allotted per dish and per location. A "Lock allotment" action freezes the day.

**4. Packing Lists**
- Per-location view for the chosen day: dish name, vegan flag, quantity, plus location totals.
- Print-friendly layout (one page per location) and an "all locations" print mode.

**5. Returns**
- Pick a week; the page loads the **previous** week's dishes and per-location allotted quantities.
- Staff enter unsold quantity per dish per location; sold = allotted − returned, shown live with a waste %.
- Guard: returned cannot exceed allotted.

**6. Auth + roles**
- Email/password sign-in. Roles stored in a dedicated roles table (never on the profile) with three roles:
  - `admin` — all pages, can lock/unlock.
  - `kitchen` — production register + read-only allotment/packing.
  - `packer` — packing lists + returns entry.
- Row-level security so only signed-in staff read data, and only permitted roles write.

## Technical notes

- TanStack Start; Supabase JS client using your project URL and publishable key (safe in client code). Any privileged reads go through server functions.
- Protected pages live under the `_authenticated` layout; a public `/auth` route handles sign-in.
- Data reads via TanStack Query with route loaders; week is a URL search param (`?week=2026-W33`) so views are shareable and bookmarkable.
- Rounding helper for pro-rata allotment lives in one shared module and is unit-tested, since allotment and vegan fallback both use it.
- Returns join on the previous ISO week derived from the selected week.

## Open items I'll confirm after Step 0

- Exact names of your menu/dish and location tables and how a dish is tied to a week/day.
- Whether requirements are per-day or one number for the whole week.
- Whether existing tables already have RLS policies I should extend rather than replace.
