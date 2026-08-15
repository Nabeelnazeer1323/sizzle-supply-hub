# Admin-only access, plus a one-line requirements row

## Roles

Drop the role system entirely for now. Every signed-in user is an admin and can use every page, so no role checks are needed in the app.

### Setup SQL changes (/setup)

- Remove the whole roles block: the `app_role` enum, the `user_roles` table, its grants, RLS policies, the `has_role()` function, and the "make yourself an admin" insert.
- Keep the two schema steps: `requirements.category` and `allocations.returned_at`.
- Keep the staff-access loop over `locations, products, requirements, production, allocations` (grants + RLS + "Staff full access" policy for authenticated users).
- Renumber the remaining steps and update the page copy so it no longer mentions roles.

### App changes

- `useAuth`: stop querying `user_roles`; expose everyone as admin so nothing else has to change. `hasRole` always returns true.
- Navigation stays as-is: Dashboard, Requirements, Production, Allotment, Packing, Returns for everyone.
- Remove any remaining `"packer"` / `"kitchen"` references.

## Requirements page layout

Replace the current card-with-"Lunches"-label layout with one compact row per location:

```text
Kungsgatan 5      Mon, Wed        [ − ] 120 [ + ]
```

Location name and delivery days on the left, the number stepper on the right, all on one line. No "Lunches" label, no card header/body split. Rows stack in a single bordered list; on narrow screens the delivery-day hint drops below the name so the stepper stays on the same line as the location.

## Technical notes

- Files touched: `src/routes/setup.tsx` (SQL strings + copy), `src/hooks/useAuth.tsx` (drop role lookup), `src/components/AppShell.tsx` (drop role gating), `src/routes/_authenticated/requirements.tsx` (row layout).
- No automatic migration is run; the SQL stays copy-paste on /setup as today.
