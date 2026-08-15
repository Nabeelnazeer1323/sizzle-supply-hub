import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { SUPABASE_URL } from "@/lib/supabase";
import { defaultWeekSearch } from "@/lib/week";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SQL = `-- 1. Requirements: replace the is_snack flag with the product category
alter table public.requirements add column if not exists category text not null default 'FOOD';

-- 2. Returns: mark when a pickup was actually logged
alter table public.allocations add column if not exists returned_at timestamptz;

-- 3. Allow signed-in staff to work with the existing operational tables
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


const CLEANUP_SQL = `-- OPTIONAL — only run once you have confirmed the customer-facing app
-- does not read these columns. This app has already stopped writing them.
alter table public.requirements drop column if exists is_snack;
alter table public.requirements drop column if exists week_number;
alter table public.requirements drop column if exists year;

alter table public.production drop column if exists week_number;
alter table public.production drop column if exists year;

alter table public.allocations drop column if exists week_number;
alter table public.allocations drop column if exists year;`;


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
  const [copied, setCopied] = useState<string | null>(null);
  const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];

  function copy(key: string, sql: string) {
    void navigator.clipboard.writeText(sql);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Finish setup</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Requirements need a <code>category</code> column and returns need a{" "}
        <code>returned_at</code> marker. Run the SQL below once in your Supabase SQL editor and
        everything in the app will light up. Every signed-in user has full access.

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
            , paste, and run. Replace the placeholder email in step 4 with your own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => copy("main", SQL)}>
            {copied === "main" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "main" ? "Copied" : "Copy SQL"}
          </Button>
          <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
            <code>{SQL}</code>
          </pre>
        </CardContent>
      </Card>

      <Card className="mt-6 border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Optional cleanup — drop unused columns</CardTitle>
          <CardDescription>
            This app no longer writes <code>week_number</code>, <code>year</code> or{" "}
            <code>is_snack</code>; the delivery/production date is the only key it needs. Other apps
            share this database, so only run this once you have confirmed nothing else reads them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => copy("cleanup", CLEANUP_SQL)}>
            {copied === "cleanup" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "cleanup" ? "Copied" : "Copy cleanup SQL"}
          </Button>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
            <code>{CLEANUP_SQL}</code>
          </pre>
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link to="/requirements" search={defaultWeekSearch()}>
            Back to the app
          </Link>
        </Button>
      </div>
    </div>
  );
}

