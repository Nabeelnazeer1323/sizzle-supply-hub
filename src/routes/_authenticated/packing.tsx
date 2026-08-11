import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";

import {
  supabase,
  type AllocationRow,
  type Location,
  type Product,
} from "@/lib/supabase";
import { currentWeek, formatDate, isoWeekDate } from "@/lib/week";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/packing")({
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
      { title: "Packing lists — Sizzle Ops" },
      {
        name: "description",
        content: "Printable per-location packing lists for the day's allotted dishes.",
      },
      { property: "og:title", content: "Packing lists — Sizzle Ops" },
      { property: "og:description", content: "Per-location packing sheets for the delivery day." },
    ],
  }),
  component: PackingPage,
});

function PackingPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,vegan_target,delivery_days,is_active")
        .order("name");
      if (error) throw error;
      return data as Location[];
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

  const productsQuery = useQuery({
    queryKey: ["products", week, day],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,translated_name,week_number,delivery_day,is_vegan,is_vegetarian,is_snack,image_url",
        )
        .eq("week_number", week);
      if (error) throw error;
      return data as Product[];
    },
  });

  const allocations = allocationsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const locations = (locationsQuery.data ?? []).filter((l) =>
    allocations.some((a) => a.location_id === l.id),
  );

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">Packing lists</h1>
        <p className="text-sm text-muted-foreground">
          What goes in each fridge today, straight from the saved allotment.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print all
        </Button>
      </div>

      {locations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing allotted yet for {formatDate(date)}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {locations.map((loc) => {
            const rows = allocations
              .filter((a) => a.location_id === loc.id)
              .map((a) => ({ ...a, product: products.find((p) => p.id === a.product_id) }))
              .sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));
            const total = rows.reduce((s, r) => s + r.quantity_allocated, 0);
            const vegan = rows.reduce(
              (s, r) => s + (r.product?.is_vegan ? r.quantity_allocated : 0),
              0,
            );
            return (
              <Card key={loc.id} className="break-inside-avoid print:break-after-page">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{loc.name}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {formatDate(date)} · {total} items ({vegan} vegan)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-border">
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 py-2">
                        <span className="w-12 text-right text-lg font-semibold tabular-nums">
                          {r.quantity_allocated}
                        </span>
                        <span className="flex-1">
                          {r.product?.name ?? r.product_id}
                          {r.product?.translated_name &&
                            r.product.translated_name !== r.product.name && (
                              <span className="block text-xs text-muted-foreground">
                                {r.product.translated_name}
                              </span>
                            )}
                        </span>
                        {r.product?.is_vegan && <Badge variant="secondary">Vegan</Badge>}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
