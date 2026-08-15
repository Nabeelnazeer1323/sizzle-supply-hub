# Fix returns, simplify requirements, add a daily dashboard

## 1. Why returns is empty (confirmed)

Two separate causes, both verified against the live data:

**a) Every allocation row already has `quantity_returned = 0`.** All 56 allocation rows in the backend (dates 2026-08-10 and 2026-08-12) carry a value — mostly `0`, a few `1`/`2`. The allotment save never writes that field, so the database default fills it with `0` at insert time. The returns screen builds its pending list with `quantity_returned === null`, so the list is empty for every location, every day. This alone makes the page look broken.

**b) The lookback windows don't match where the data actually is.** Today is Saturday 15 Aug. For a normal location the screen looks at the previous ISO week (3–7 Aug) — empty. For Storytel it looks at the previous weekday (14 Aug) — also empty. The real deliveries sit on 10 and 12 Aug, inside the current week. The rule "previous week" is right for a Monday pickup, but with no way to move the date the driver can never reach the dishes that are actually out there.

**Fix**

- Stop using `quantity_returned IS NULL` as the "already counted" marker. Add a nullable `returned_at` timestamp column to `allocations` (purely additive, the customer-facing app ignores it) and set it when the driver saves. Pending = `returned_at IS NULL`. Rows counted before the column existed stay visible once, which is correct — nobody has actually logged them through the app.
- Widen the lookback so nothing gets stranded: for a normal location, list everything delivered since its previous delivery day that is still unlogged — in practice last week's Monday and Wednesday drops, and on a Saturday/late run whatever is still open from this week. Storytel keeps the previous-delivery-day rule (Monday collects Friday) but also picks up anything older still unlogged, so a skipped day isn't lost.
- Keep the "All sold" one-tap save and per-dish input as they are.

## 2. Returns date picker

Replace the small "change date" link with the same week/day bar used on Requirements: week arrows plus Mon–Fri buttons, defaulting to today's week and weekday. The zero-tap behaviour stays — the driver opens Returns and today is already selected; the bar is only there when he needs another day.

## 3. Requirements: drop the vegan % row

Remove the "Vegan %" line from each location card. The vegan share stays on the location record and continues to drive allotment; it is just no longer editable per delivery. Card shows the location, its delivery days, and the lunch count only. The page footer keeps the vegan total for information.

## 4. New Dashboard page

A read-only day view at `/dashboard`, added as the first item in the nav and the landing route after sign-in. Same week/day bar, no inputs anywhere:

- **Day summary**: lunches required, produced, delivered, returned, waste %.
- **Requirements**: one row per location delivering that day with its number.
- **Production**: each dish cooked that day with quantity, vegan marked.
- **Allotment/delivery**: per location, the dishes and counts sent.
- **Returns**: what came back per location, with the dishes still not accounted for flagged.
- Empty sections say plainly that nothing is recorded for that day.

## Technical notes

- Migration (additive only): `alter table allocations add column if not exists returned_at timestamptz;`. No drops, no policy changes.
- `src/lib/delivery.ts` gains `returnsWindow(location, date)` returning the start/end range per rule, replacing the split `previousWeekday`/`previousWeekRange` calls in the route.
- Returns query filters on `returned_at is null` and the date range; save sets `quantity_returned` and `returned_at` in the same update by row id.
- Returns route search params move to `{ year, week, day, location }` so `WeekBar` can drive it, defaulting to today's ISO week/weekday.
- New `src/routes/_authenticated/dashboard.tsx` reads requirements, production, allocations and locations for the selected date with react-query; no mutations.
- `src/routes/index.tsx` redirects to `/dashboard`; `AppShell` nav gets the Dashboard entry (all roles).
