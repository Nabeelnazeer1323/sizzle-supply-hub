import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  supabase,
  PRODUCT_COLUMNS,
  type AllocationRow,
  type Location,
  type Product,
  type ProductionRow,
  type RequirementRow,
} from "@/lib/supabase";
import { currentWeek, formatDate, isoWeekDate } from "@/lib/week";
import { deliversOn } from "@/lib/delivery";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const now = currentWeek();
    return {
      year: Number(search['year']) || now.year,
      week: Number(search['week']) || now.week,
      day: typeof search['day'] === "string" ? search['day'] : "Monday",
    };
  },
  head: () => ({
    meta: [
      { title: "Day overview — Sizzle Ops" },
      {
        name: "description",
        content:
          "Read-only overview of one delivery day: requirements, production, deliveries and returns.",
      },
      { property: "og:title", content: "Day overview — Sizzle Ops" },
      {
        property: "og:description",
        content: "Everything recorded for a single Sizzle delivery day, in one view.",
      },
    ],
  }),
  component: DashboardPage,
});

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function DashboardPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,vegan_target,delivery_days,is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });

  const requirementsQuery = useQuery({
    queryKey: ["requirements", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("requirements")
        .select("*")
        .eq("delivery_date", date);
      if (error) throw error;
      return data as RequirementRow[];
    },
  });

  const productionQuery = useQuery({
    queryKey: ["production", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production")
        .select("*")
        .eq("production_date", date);
      if (error) throw error;
      return data as ProductionRow[];
    },
  });

  const allocationsQuery = useQuery({
    queryKey: ["allocations", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("delivery_date", date);
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const production = useMemo(() => productionQuery.data ?? [], [productionQuery.data]);
  const allocations = useMemo(() => allocationsQuery.data ?? [], [allocationsQuery.data]);
  const requirements = requirementsQuery.data ?? [];
  const locations = locationsQuery.data ?? [];

  const productIds = useMemo(
    () =>
      Array.from(
        new Set([...production.map((p) => p.product_id), ...allocations.map((a) => a.product_id)]),
      ),
    [production, allocations],
  );

  const productsQuery = useQuery({
    queryKey: ["products-by-id", productIds.slice().sort().join(",")],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .in("id", productIds);
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const products = productsQuery.data ?? [];
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const isVegan = (id: string) => Boolean(products.find((p) => p.id === id)?.is_vegan);
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  const scheduled = locations.filter((l) => deliversOn(l, day));

  const totals = {
    required: requirements.reduce((s, r) => s + (r.total_required ?? 0), 0),
    produced: production.reduce((s, p) => s + (p.quantity_produced ?? 0), 0),
    delivered: allocations.reduce((s, a) => s + (a.quantity_allocated ?? 0), 0),
    returned: allocations.reduce((s, a) => s + (a.quantity_returned ?? 0), 0),
  };
  const wastePct = totals.delivered
    ? Math.round((totals.returned / totals.delivered) * 100)
    : 0;

  const byLocation = useMemo(() => {
    const map = new Map<string, AllocationRow[]>();
    for (const a of allocations) {
      map.set(a.location_id, [...(map.get(a.location_id) ?? []), a]);
    }
    return Array.from(map.entries()).sort((a, b) =>
      locationName(a[0]).localeCompare(locationName(b[0])),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocations, locations]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Day overview</h1>
        <p className="text-sm text-muted-foreground">
          Everything recorded for {formatDate(date)}. Read-only — nothing here can be edited.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Required" value={String(totals.required)} />
        <Stat label="Produced" value={String(totals.produced)} />
        <Stat label="Delivered" value={String(totals.delivered)} />
        <Stat label="Returned" value={String(totals.returned)} />
        <Stat label="Waste" value={`${wastePct}%`} tone={wastePct > 15 ? "bad" : undefined} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          {scheduled.length === 0 ? (
            <Empty>No locations take a delivery on this day.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {scheduled.map((loc) => {
                const req = requirements.find((r) => r.location_id === loc.id);
                return (
                  <li key={loc.id} className="flex items-center justify-between py-2">
                    <span>{loc.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {req ? `${req.total_required} lunches` : "not set"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Production</CardTitle>
        </CardHeader>
        <CardContent>
          {production.length === 0 ? (
            <Empty>Nothing was registered as produced on this day.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {production.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{productName(p.product_id)}</span>
                    {isVegan(p.product_id) && (
                      <Badge variant="secondary" className="shrink-0">
                        Vegan
                      </Badge>
                    )}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{p.quantity_produced}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Delivered &amp; returned</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {byLocation.length === 0 ? (
            <Empty>Nothing has been allotted for this day yet.</Empty>
          ) : (
            byLocation.map(([locId, rows]) => (
              <div key={locId}>
                <div className="mb-1 text-sm font-medium">{locationName(locId)}</div>
                <ul className="divide-y divide-border text-sm">
                  {rows
                    .slice()
                    .sort((a, b) => productName(a.product_id).localeCompare(productName(b.product_id)))
                    .map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="truncate">{productName(a.product_id)}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {a.quantity_allocated} sent ·{" "}
                          {a.returned_at
                            ? `${a.quantity_returned ?? 0} back`
                            : "returns not logged"}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
