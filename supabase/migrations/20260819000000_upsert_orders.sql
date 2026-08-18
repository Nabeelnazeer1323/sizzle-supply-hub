-- Atomically import a batch of parsed orders. This function runs with the
-- caller's permissions and also checks the immutable app_metadata admin claim.
alter table public.orders alter column location_id drop not null;
alter table public.orders add column if not exists source_order_id text;
alter table public.orders add column if not exists source_status text;
alter table public.orders add column if not exists mapping_status text not null default 'UNMAPPED';
alter table public.orders add column if not exists import_key text;
update public.orders
set import_key = case
  when nullif(external_reference, '') is not null then 'reference:' || external_reference
  when nullif(source_order_id, '') is not null then 'source:' || source_order_id || ':' || transaction_type
  else 'legacy:' || id::text
end
where import_key is null;
alter table public.orders alter column import_key set not null;
create unique index if not exists orders_payment_import_key_idx
  on public.orders (payment_method, import_key);
do $$
begin
  alter table public.orders
    add constraint orders_mapping_status_check check (mapping_status in ('MAPPED', 'UNMAPPED'));
exception when duplicate_object then null;
end $$;
create index if not exists orders_mapping_status_idx on public.orders (mapping_status);

create or replace function public.upsert_orders(p_orders jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  input_order jsonb;
  input_item jsonb;
  target_order_id uuid;
  existed boolean;
  unchanged boolean;
  inserted_count integer := 0;
  updated_count integer := 0;
  skipped_count integer := 0;
  item_count integer := 0;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_orders) <> 'array' then
    raise exception 'p_orders must be a JSON array' using errcode = '22023';
  end if;

  for input_order in select value from jsonb_array_elements(p_orders)
  loop
    if nullif(input_order ->> 'import_key', '') is null then
      raise exception 'Every imported order requires an import_key'
        using errcode = '22023';
    end if;

    target_order_id := null;
    unchanged := false;
    select
      orders.id,
      orders.external_reference is not distinct from nullif(input_order ->> 'external_reference', '')
      and orders.transaction_type = input_order ->> 'transaction_type'
      and orders.ordered_at = (input_order ->> 'ordered_at')::timestamptz
      and orders.amount = (input_order ->> 'amount')::numeric
      and orders.currency = coalesce(nullif(input_order ->> 'currency', ''), 'SEK')
      and orders.message = input_order ->> 'message'
      and orders.source_order_id is not distinct from nullif(input_order ->> 'source_order_id', '')
      and orders.source_status is not distinct from nullif(input_order ->> 'source_status', '')
      and orders.mapping_status = input_order ->> 'mapping_status'
      and orders.location_id is not distinct from nullif(input_order ->> 'location_id', '')::uuid
      and coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'numeric_id', order_items.raw_product_numeric_id,
            'product_id', order_items.product_id,
            'quantity', order_items.quantity
          ) order by order_items.raw_product_numeric_id
        )
        from public.order_items
        where order_items.order_id = orders.id
      ), '[]'::jsonb) = coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'numeric_id', (item ->> 'numeric_id')::integer,
            'product_id', item ->> 'product_id',
            'quantity', coalesce((item ->> 'quantity')::integer, 1)
          ) order by (item ->> 'numeric_id')::integer
        )
        from jsonb_array_elements(coalesce(input_order -> 'items', '[]'::jsonb)) as parsed(item)
      ), '[]'::jsonb)
    into target_order_id, unchanged
    from public.orders
    where payment_method = input_order ->> 'payment_method'
      and import_key = input_order ->> 'import_key';

    existed := target_order_id is not null;
    if existed and unchanged then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    insert into public.orders (
      user_id,
      payment_method,
      import_key,
      external_reference,
      transaction_type,
      ordered_at,
      amount,
      currency,
      message,
      source_order_id,
      source_status,
      location_id,
      mapping_status
    ) values (
      null,
      input_order ->> 'payment_method',
      input_order ->> 'import_key',
      nullif(input_order ->> 'external_reference', ''),
      input_order ->> 'transaction_type',
      (input_order ->> 'ordered_at')::timestamptz,
      (input_order ->> 'amount')::numeric,
      coalesce(nullif(input_order ->> 'currency', ''), 'SEK'),
      input_order ->> 'message',
      nullif(input_order ->> 'source_order_id', ''),
      nullif(input_order ->> 'source_status', ''),
      nullif(input_order ->> 'location_id', '')::uuid,
      input_order ->> 'mapping_status'
    )
    on conflict (payment_method, import_key) do update set
      external_reference = excluded.external_reference,
      transaction_type = excluded.transaction_type,
      ordered_at = excluded.ordered_at,
      amount = excluded.amount,
      currency = excluded.currency,
      message = excluded.message,
      source_order_id = excluded.source_order_id,
      source_status = excluded.source_status,
      location_id = excluded.location_id,
      mapping_status = excluded.mapping_status,
      imported_at = now()
    returning id into target_order_id;

    if existed then
      updated_count := updated_count + 1;
    else
      inserted_count := inserted_count + 1;
    end if;

    -- Replacing the derived items ensures a changed message is reflected and
    -- stale products disappear when the same report is uploaded again.
    delete from public.order_items where order_id = target_order_id;

    for input_item in
      select value from jsonb_array_elements(coalesce(input_order -> 'items', '[]'::jsonb))
    loop
      insert into public.order_items (
        order_id,
        raw_product_numeric_id,
        product_id,
        quantity
      ) values (
        target_order_id,
        (input_item ->> 'numeric_id')::integer,
        input_item ->> 'product_id',
        coalesce((input_item ->> 'quantity')::integer, 1)
      );
      item_count := item_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'skipped', skipped_count,
    'items', item_count
  );
end;
$$;

revoke all on function public.upsert_orders(jsonb) from public;
grant execute on function public.upsert_orders(jsonb) to authenticated;
