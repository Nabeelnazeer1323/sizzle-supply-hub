import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { SUPABASE_URL } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SQL = `-- 1. Returns: unsold items coming back from each location
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  delivery_date date not null,
  week_number int not null,
  year int not null,
  quantity_returned int not null default 0,
  created_at timestamptz not null default now(),
  unique (location_id, product_id, delivery_date)
);

grant select, insert, update, delete on public.returns to authenticated;
grant all on public.returns to service_role;
alter table public.returns enable row level security;

create policy "Staff can read returns" on public.returns
  for select to authenticated using (true);
create policy "Staff can write returns" on public.returns
  for all to authenticated using (true) with check (true);

-- 2. Roles: admin / kitchen / packer
do $$ begin
  create type public.app_role as enum ('admin', 'kitchen', 'packer');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "Users read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);
create policy "Admins read all roles" on public.user_roles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins manage roles" on public.user_roles
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- 3. Make yourself an admin (replace the email)
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@sizzle.example'
on conflict do nothing;

-- 4. Allow signed-in staff to work with the existing operational tables
do $$
declare t text;
begin
  foreach t in array array['locations','products','requirements','production','allocations'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format(
        'create policy "Staff full access" on public.%I for all to authenticated using (true) with check (true)', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;`;

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Setup — Sizzle Ops" },
      {
        name: "description",
        content: "One-time database setup for returns tracking and staff roles in Sizzle Ops.",
      },
      { property: "og:title", content: "Setup — Sizzle Ops" },
      { property: "og:description", content: "Run this SQL once to finish setting up Sizzle Ops." },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const [copied, setCopied] = useState(false);
  const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Finish setup</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Two things are missing from your database: a table for returns and a table for staff roles.
        Run the SQL below once in your Supabase SQL editor and everything in the app will light up.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">One-time SQL</CardTitle>
          <CardDescription>
            Open{" "}
            <a
              className="underline"
              target="_blank"
              rel="noreferrer"
              href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`}
            >
              the SQL editor
            </a>
            , paste, and run. Replace the placeholder email in step 3 with your own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(SQL);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy SQL"}
          </Button>
          <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
            <code>{SQL}</code>
          </pre>
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link to="/requirements">Back to the app</Link>
        </Button>
      </div>
    </div>
  );
}
