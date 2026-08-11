import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";

import {
  supabase,
  type AllocationRow,
  type Location,
  type Product,
  type ProductionRow,
  type RequirementRow,
} from "@/lib/supabase";
import { currentWeek, isoWeekDate } from "@/lib/week";
import { computeAllotment, locationTotals } from "@/lib/allotment";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/allotment")({
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
      { title: "Allotment — Sizzle Ops" },
      {
        name: "description",
        content: "Split the day's production across locations pro-rata, with manual overrides.",
      },
      { property: "og:title", content: "Allotment — Sizzle Ops" },
      { property: "og:description", content: "Pro-rata split of production across locations." },
    ],
  }),
  component: AllotmentPage,
});

function AllotmentPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);
  const queryClient = useQueryClient();

  const productsQuery = useQuery({
    queryKey: ["products", week, day],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,translated_name,week_number,delivery_day,is_vegan,is_vegetarian,is_snack,image_url",
        )
        .eq("week_number", week)
        .eq("is_snack", false)
        .order("name");
      if (error) throw error;
      return (data as Product[]).filter(
        (p) => (p.delivery_day ?? "").toLowerCase() === day.toLowerCase(),
      );
    },
  });

  const productionQuery = useQuery({
    queryKey: ["production", date],
    queryFn: async () => {
      const { data, error } = await supabase.from("production").select("*").eq("production_date", date);
      if (error) throw error;
      return data as ProductionRow[];
    },
  });

  const requirementsQuery = useQuery({
    queryKey: ["requirements", date],
    queryFn: async () => {
      const { data, error } = await supabase.from("requirements").select("*").eq("delivery_date", date);
      if (error) throw error;
      return data as RequirementRow[];
    },
  });

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

  const products = useMemo(
    () =>
      (productsQuery.data ?? []).map((p) => ({
        ...p,
        isVegan: Boolean(p.is_vegan),
        produced:
          productionQuery.data?.find((r) => r.product_id === p.id)?.quantity_produced ?? 0,
      })),
    [productsQuery.data, productionQuery.data],
  );

  const locations = useMemo(() => {
    const reqs = requirementsQuery.data ?? [];
    return (locationsQuery.data ?? [])
      .map((l) => ({
        ...l,
        required: reqs.find((r) => r.location_id === l.id)?.total_required ?? 0,
        veganPct: l.vegan_target ?? 25,
      }))
      .filter((l) => l.required > 0);
  }, [locationsQuery.data, requirementsQuery.data]);

  const [cells, setCells] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    if (products.length === 0 || locations.length === 0) return;
    const saved = allocationsQuery.data ?? [];
    if (saved.length > 0) {
      const next: Record<string, Record<string, number>> = {};
      for (const p of products) {
        next[p.id] = {};
        for (const l of locations) {
          next[p.id]![l.id] =
            saved.find((a) => a.product_id === p.id && a.location_id === l.id)
              ?.quantity_allocated ?? 0;
        }
      }
      setCells(next);
    } else {
      setCells(
        computeAllotment({
          products: products.map((p) => ({ id: p.id, isVegan: p.isVegan, produced: p.produced })),
          locations: locations.map((l) => ({
            id: l.id,
            required: l.required,
            veganPct: l.veganPct,
          })),
        }).cells,
      );
    }
  }, [products, locations, allocationsQuery.data]);

  function autoFill() {
    setCells(
      computeAllotment({
        products: products.map((p) => ({ id: p.id, isVegan: p.isVegan, produced: p.produced })),
        locations: locations.map((l) => ({ id: l.id, required: l.required, veganPct: l.veganPct })),
      }).cells,
    );
    toast.success("Recalculated pro-rata");
  }

  const save = useMutation({
    mutationFn: async () => {
      const { error: delError } = await supabase
        .from("allocations")
        .delete()
        .eq("delivery_date", date);
      if (delError) throw delError;

      const rows = [] as Record<string, unknown>[];
      for (const p of products) {
        for (const l of locations) {
          const qty = cells[p.id]?.[l.id] ?? 0;
          if (qty > 0) {
            rows.push({
              product_id: p.id,
              location_id: l.id,
              delivery_date: date,
              week_number: week,
              year,
              quantity_allocated: qty,
            });
          }
        }
      }
      if (rows.length > 0) {
        const { error } = await supabase.from("allocations").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Allotment saved");
      void queryClient.invalidateQueries({ queryKey: ["allocations", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = products.length > 0 && locations.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Allotment</h1>
        <p className="text-sm text-muted-foreground">
          Production is split across locations in proportion to their requirement. Vegan is a soft
          target — shortfalls are flagged, not blocked. Every number is editable.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      {!ready ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Register requirements and production for {day}, week {week} first.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              {products.length} dishes × {locations.length} locations
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={autoFill}>
                <Wand2 className="size-4" />
                Auto pro-rata
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save allotment"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 bg-card p-2 text-left font-medium">Dish</th>
                  <th className="p-2 text-right font-medium">Produced</th>
                  {locations.map((l) => (
                    <th key={l.id} className="p-2 text-center font-medium">
                      {l.name}
                      <div className="text-xs font-normal text-muted-foreground">
                        {l.required} · {l.veganPct}% v
                      </div>
                    </th>
                  ))}
                  <th className="p-2 text-right font-medium">Allotted</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const rowTotal = locations.reduce(
                    (sum, l) => sum + (cells[p.id]?.[l.id] ?? 0),
                    0,
                  );
                  const diff = rowTotal - p.produced;
                  return (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="sticky left-0 bg-card p-2">
                        <span className="font-medium">{p.name}</span>{" "}
                        {p.isVegan && (
                          <Badge className="ml-1 align-middle text-[10px]">Vegan</Badge>
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">{p.produced}</td>
                      {locations.map((l) => (
                        <td key={l.id} className="p-1">
                          <Input
                            className="h-9 text-center tabular-nums"
                            inputMode="numeric"
                            value={String(cells[p.id]?.[l.id] ?? 0)}
                            onChange={(e) => {
                              const v = Number(e.target.value.replace(/[^0-9]/g, "")) || 0;
                              setCells((prev) => ({
                                ...prev,
                                [p.id]: { ...(prev[p.id] ?? {}), [l.id]: v },
                              }));
                            }}
                          />
                        </td>
                      ))}
                      <td
                        className={`p-2 text-right tabular-nums ${
                          diff === 0 ? "text-muted-foreground" : "font-medium text-destructive"
                        }`}
                      >
                        {rowTotal}
                        {diff !== 0 && (
                          <span className="block text-xs">
                            {diff > 0 ? `+${diff} over` : `${diff} left`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td className="sticky left-0 bg-card p-2 font-medium">Location total</td>
                  <td />
                  {locations.map((l) => {
                    const t = locationTotals(cells, products, l.id);
                    const veganNeed = Math.round((l.required * l.veganPct) / 100);
                    const veganShort = veganNeed - t.vegan;
                    return (
                      <td key={l.id} className="p-2 text-center">
                        <div className="font-semibold tabular-nums">
                          {t.total}
                          <span className="text-xs font-normal text-muted-foreground">
                            {" "}
                            / {l.required}
                          </span>
                        </div>
                        <div
                          className={`text-xs ${
                            veganShort > 0 ? "text-destructive" : "text-muted-foreground"
                          }`}
                        >
                          {t.vegan} vegan
                          {veganShort > 0 ? ` (short ${veganShort})` : ""}
                        </div>
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
