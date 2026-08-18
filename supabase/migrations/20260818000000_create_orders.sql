-- A provider-neutral order model. The first importer uses SWISH_MANUAL;
-- STRIPE and SWISH_API can use the same tables later.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Null for guest purchases. A future signed-in customer can own the order.
  user_id uuid references auth.users(id) on delete set null,
  payment_method text not null,
  import_key text not null,
  external_reference text,
  transaction_type text not null default 'PAYMENT',
  ordered_at timestamptz not null,
  amount numeric(12, 2) not null,
  currency text not null default 'SEK',

  -- The message is required source data for matching and later reprocessing.
  -- Do not store payer name, phone number or the complete raw CSV row.
  message text not null,
  source_order_id text,
  source_status text,
  location_id uuid references public.locations(id) on delete restrict,
  mapping_status text not null default 'UNMAPPED',
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_payment_method_check check (
    payment_method in ('SWISH_MANUAL', 'SWISH_API', 'STRIPE')
  ),
  constraint orders_transaction_type_check check (
    transaction_type in ('PAYMENT', 'REFUND', 'REFUND_CORRECTION', 'PAYOUT', 'UNKNOWN')
  ),
  constraint orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint orders_mapping_status_check check (mapping_status in ('MAPPED', 'UNMAPPED')),
  constraint orders_payment_import_key_unique unique (payment_method, import_key)
);

-- One payment can contain several product numbers in its message.
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,

  -- Parsed from the message and retained even when product matching fails.
  raw_product_numeric_id integer not null,
  -- products.id is text in the existing schema (its values happen to look like UUIDs).
  product_id text references public.products(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  unit_amount numeric(12, 2),
  created_at timestamptz not null default now(),

  constraint order_items_order_product_unique unique (order_id, raw_product_numeric_id)
);

create index if not exists orders_ordered_at_idx on public.orders (ordered_at desc);
create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_location_id_idx on public.orders (location_id);
create index if not exists orders_mapping_status_idx on public.orders (mapping_status);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists products_numeric_id_idx on public.products (numeric_id);

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_order_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;

-- Admin is assigned server-side in auth.users.raw_app_meta_data as
-- { "role": "admin" }. Never authorize from user_metadata: users can edit it.
drop policy if exists "Staff full access" on public.orders;
drop policy if exists "orders_admin_all" on public.orders;
drop policy if exists "orders_admin_manage" on public.orders;
create policy "orders_admin_manage"
on public.orders for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "orders_customer_select_own" on public.orders;
create policy "orders_customer_select_own"
on public.orders for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Staff full access" on public.order_items;
drop policy if exists "order_items_admin_all" on public.order_items;
drop policy if exists "order_items_admin_manage" on public.order_items;
create policy "order_items_admin_manage"
on public.order_items for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "order_items_customer_select_own" on public.order_items;
create policy "order_items_customer_select_own"
on public.order_items for select to authenticated
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.user_id = (select auth.uid())
  )
);
