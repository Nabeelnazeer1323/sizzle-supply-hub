# Fix the snack inventory SQL

## Why it failed

Your `products.id` column is `text`, not `uuid`. The snack SQL declared `product_id uuid ... references public.products(id)`, and Postgres refuses a foreign key between mismatched types. Nothing was created — the run aborted at the first table.

No service role key needed: this is a type mismatch, not a permissions problem, and the SQL editor already runs with full rights.

## The fix

Rewrite the `SNACK_SQL` block in `src/routes/setup.tsx` so the foreign-key columns automatically match whatever types your `products.id` and `locations.id` actually are. The table creation moves into a small `do $$` block that looks up the real column types from `information_schema` and builds the `create table` statements with them:

```text
1. look up data_type of products.id   -> e.g. text
2. look up data_type of locations.id  -> text or uuid
3. create snack_batches    with product_id / location_id of those exact types
4. create snack_adjustments the same way (batch_id stays uuid — it references snack_batches, which we create)
5. indexes, grants, RLS policies — unchanged from the current block
```

Everything else in the SQL (columns, indexes, grants, "Staff full access" policies) stays exactly as it is.

## No app code changes

The app already treats all IDs as strings (`Product.id`, `Location.id`, and the snack types in `src/lib/snacks.ts` are all `string`), so whether the columns end up `text` or `uuid` makes no difference to the code. Only the SQL on the setup page changes.

## After the fix

Copy the updated snack SQL from `/setup` and run it once — it will succeed regardless of your ID column types, and the Snacks pages will light up.
