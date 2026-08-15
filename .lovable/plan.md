# Two roles only, plus a tighter requirements row

## Roles

Drop the packer/driver role entirely. Two roles remain:

- **admin** — full access to every page, and the only role that can manage roles.
- **kitchen** — sees Requirements read-only, can edit Production, Allotment, Packing and Returns.

Returns is visible and editable to both admin and kitchen.

### Setup SQL changes (/setup)

- `app_role` enum becomes `('admin', 'kitchen')`. Since the type may already exist with `packer`, the SQL first reassigns any `packer` rows to `kitchen`, then removes the value (recreate the enum safely rather than assuming `ALTER TYPE ... DROP VALUE`, which Postgres does not support).
- Keep `user_roles`, grants, RLS and `has_role()` as they are; only admins can insert/update/delete roles (existing "Admins manage roles" policy).
- Keep the "make yourself an admin" step, with the placeholder email.
- Keep the staff-access loop over `locations, products, requirements, production, allocations` — write access still needs to reach both roles; requirements stays writable at the database level and read-only in the UI for kitchen.

### App changes

- `AppRole` type: `"admin" | "kitchen"`.
- Navigation: Dashboard, Production, Allotment, Packing, Returns for both roles; Requirements shown to both but editable only by admin.
- Requirements page: for kitchen, steppers are disabled and the save bar is hidden.
- Fallback when the roles table is missing stays "admin"; the default role for a signed-in user with no row becomes `kitchen` instead of `packer`.

## Requirements page layout

Replace the current card-with-"Lunches"-label layout with one compact row per location:

```text
Kungsgatan 5      Mon, Wed        [ − ] 120 [ + ]
```

Location name and delivery days on the left, the number stepper on the right, all on a single line. No "Lunches" label, no separate card header/body split. Rows stack in one bordered list; on narrow screens the delivery-day hint drops below the name so the stepper always stays on the same line as the location.

## Technical notes

- Files touched: `src/routes/setup.tsx` (SQL strings), `src/hooks/useAuth.tsx` (role union + default), `src/components/AppShell.tsx` (nav role lists), `src/routes/_authenticated/requirements.tsx` (row layout + admin-only editing).
- Any other route referencing `"packer"` gets updated to the new role set.
- No schema/data migration is run automatically; the SQL stays copy-paste on /setup as today.
