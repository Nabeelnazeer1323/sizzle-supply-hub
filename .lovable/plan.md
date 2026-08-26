# Returns: tie each pickup to the day it belongs to

## How it works today

Returns are stored on the `allocations` rows themselves: `quantity_returned` plus a `returned_at` timestamp that marks a row as "logged". The screen picks a location and a date, then asks `src/lib/delivery.ts → returnsWindow()` which deliveries are due.

That function currently returns two ranges:

- a **strict** range — what is genuinely due on the chosen day (Storytel: the previous weekday; everyone else: last Mon–Fri), and
- a **wide** range — 28–30 days back, meant to catch anything never logged.

The screen queries the wide range, drops every row that already has `returned_at`, and then: if anything falls inside the strict range it shows that, otherwise it shows *everything still unlogged going back a month*.

That fallback is the bug you are seeing. On Friday, Storytel's Thursday delivery may already be logged (or never existed for those dishes), so the strict list is empty and the screen dumps the whole month of unlogged rows — the "whole week" you saw. On Thursday the strict list happened to be non-empty, so it looked right. It also means anything missed silently re-appears on every following day forever.

A second consequence: once a row is logged it disappears from every view, so a mistake can never be corrected, and a dish delivered Monday and Tuesday can look like it "vanished" after the Tuesday pickup.

## What it should do

One pickup day maps to exactly one delivery window, always, with no carry-forward:

- **Storytel** — pickup on day D covers only the previous delivery weekday's delivery: Mon collects Fri, Tue collects Mon, Wed collects Tue, Thu collects Wed, Fri collects Thu. Dishes are filtered by that dish's `storytel_delivery_days` for the delivery date, so a Mon+Tue dish appears twice: once on Tuesday against the Monday allocation, once on Wednesday against the Tuesday allocation.
- **All other locations** — pickup covers the whole previous ISO week (Mon–Fri) of deliveries, never anything from the current week.

Nothing ever spills into a later day. If a pickup was missed, the driver logs it by stepping back to that day on the week bar — the numbers stay attached to the delivery they belong to.

## Changes

1. `returnsWindow()` drops the wide lookback and returns a single strict range per rule above (Storytel: one date; other locations: previous Mon–Fri).
2. The returns screen queries exactly that range and removes the "otherwise show everything outstanding" fallback.
3. Already-logged rows stay visible for that day instead of disappearing: shown with their saved quantity prefilled and a small "logged" marker, editable, and saving updates them. The save summary counts only what's on screen.
4. If everything for the day is logged, the empty state says so explicitly ("Friday's pickup is already logged") rather than the generic "nothing left".
5. Dashboard is untouched — it already reads per-date allocations.

## Technical notes

- `src/lib/delivery.ts`: `returnsWindow(location, iso)` returns `{ start, end, mode }` only; `strictStart`/`strictEnd` and the 28/30-day `back()` helper go away. Storytel uses `previousWeekday(iso)` for both bounds; weekly uses `previousWeekRange(iso)` unchanged, with no clamping to the last delivery date.
- `src/routes/_authenticated/returns.tsx`: query stays keyed on `[locationId, start, end]`; drop the `hasReturnedAt` / `pending` / `candidates` chain and render all rows in range. Seed `draft` from `quantity_returned` for rows with `returned_at`.
- No schema change; `returned_at` keeps its meaning (this row's pickup was logged) and now only affects presentation, not which rows appear.
