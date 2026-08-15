import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";

import {
  supabase,
  PRODUCT_COLUMNS,
  type AllocationRow,
  type Location,
  type Product,
  type ProductionRow,
  type RequirementRow,
} from "@/lib/supabase";
import { currentWeek, isoWeekDate } from "@/lib/week";
import {
  categoriesOf,
  categoryLabel,
  normalizeCategory,
  productCategory,
  type Category,
} from "@/lib/category";
import { computeAllotment, locationTotals } from "@/lib/allotment";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Search = { year: number; week: number; day: string; category: string | undefined };

export const Route = createFileRoute("/_authenticated/allotment")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const now = currentWeek();
    return {
      year: Number(search['year']) || now.year,
      week: Number(search['week']) || now.week,
      day: typeof search['day'] === "string" ? search['day'] : "Monday",
      category: typeof search['category'] === "string" ? search['category'] : undefined,
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { year, week, day: rawDay } = search;
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);
  const queryClient = useQueryClient();

  const allProductsQuery = useQuery({
    queryKey: ["products", week, day],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("week_number", week)
        .order("name");
      if (error) throw error;
      return (data as unknown as Product[]).filter(
        (p) => (p.delivery_day ?? "").toLowerCase() === day.toLowerCase(),
      );
    },
  });

  const dayProducts = useMemo(() => allProductsQuery.data ?? [], [allProductsQuery.data]);
  const categories: Category[] = [DEFAULT_CATEGORY];
  const category: Category = DEFAULT_CATEGORY;


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
      dayProducts
        .filter((p) => productCategory(p) === category)
        .map((p) => ({
          ...p,
          isVegan: Boolean(p.is_vegan),
          produced:
            productionQuery.data?.find((r) => r.product_id === p.id)?.quantity_produced ?? 0,
        })),
    [dayProducts, category, productionQuery.data],
  );

  const locations = useMemo(() => {
    const reqs = requirementsQuery.data ?? [];
    return (locationsQuery.data ?? [])
      .map((l) => ({
        ...l,
        required:
          reqs.find(
            (r) => r.location_id === l.id && normalizeCategory(r.category) === category,
          )?.total_required ?? 0,
        veganPct: l.vegan_target ?? 25,
      }))
      .filter((l) => l.required > 0);
  }, [locationsQuery.data, requirementsQuery.data, category]);

  const [cells, setCells] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    if (products.length === 0 || locations.length === 0) return;
    const saved = (allocationsQuery.data ?? []).filter((a) =>
      products.some((p) => p.id === a.product_id),
    );
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
      const existing = (allocationsQuery.data ?? []).filter((a) =>
        products.some((p) => p.id === a.product_id),
      );

      for (const p of products) {
        for (const l of locations) {
          const qty = cells[p.id]?.[l.id] ?? 0;
          const row = existing.find((a) => a.product_id === p.id && a.location_id === l.id);
          if (qty > 0) {
            if (row) {
              if (row.quantity_allocated !== qty) {
                // Update in place so quantity_returned and the row id survive.
                const { error } = await supabase
                  .from("allocations")
                  .update({ quantity_allocated: qty })
                  .eq("id", row.id);
                if (error) throw error;
              }
            } else {
              const { error } = await supabase.from("allocations").insert({
                product_id: p.id,
                location_id: l.id,
                delivery_date: date,
                quantity_allocated: qty,
              });
              if (error) throw error;
            }
          } else if (row) {
            const { error } = await supabase.from("allocations").delete().eq("id", row.id);
            if (error) throw error;
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Allotment saved");
      void queryClient.invalidateQueries({ queryKey: ["allocations", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ready = products.length > 0 && locations.length > 0;
  const allotted = products.reduce(
    (sum, p) => sum + locations.reduce((s, l) => s + (cells[p.id]?.[l.id] ?? 0), 0),
    0,
  );

  function setCell(productId: string, locationId: string, value: number) {
    setCells((prev) => ({ ...prev, [productId]: { ...(prev[productId] ?? {}), [locationId]: value } }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Allotment</h1>
        <p className="text-sm text-muted-foreground">
          Production split across locations in proportion to their requirement. Vegan is a soft
          target — shortfalls are flagged, not blocked.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <Button
              key={c}
              size="sm"
              className="h-10"
              variant={c === category ? "default" : "outline"}
              onClick={() =>
                void navigate({ search: (p: Search) => ({ ...p, category: c }) })
              }
            >
              {categoryLabel(c)}
            </Button>
          ))}
        </div>
      )}

      {!ready ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Register requirements and production for {day}, week {week} first.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: one card per dish */}
          <div className="space-y-3 md:hidden">
            {products.map((p) => {
              const rowTotal = locations.reduce((s, l) => s + (cells[p.id]?.[l.id] ?? 0), 0);
              const diff = rowTotal - p.produced;
              return (
                <Card key={p.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                      <span className="flex items-center gap-2">
                        {p.name}
                        {p.isVegan && <Badge className="text-[10px]">Vegan</Badge>}
                      </span>
                      <span
                        className={`text-xs font-normal tabular-nums ${
                          diff === 0 ? "text-muted-foreground" : "text-destructive"
                        }`}
                      >
                        {rowTotal}/{p.produced}
                        {diff !== 0 && (diff > 0 ? ` (+${diff} over)` : ` (${-diff} left)`)}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {locations.map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                        <QtyStepper
                          ariaLabel={`${p.name} for ${l.name}`}
                          value={cells[p.id]?.[l.id] ?? 0}
                          onChange={(v) => setCell(p.id, l.id, v)}
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Desktop: full grid */}
          <Card className="hidden md:block">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">
                {products.length} dishes × {locations.length} locations
              </CardTitle>
              <Button variant="outline" onClick={autoFill}>
                <Wand2 className="size-4" />
                Auto pro-rata
              </Button>
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
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) =>
                                setCell(
                                  p.id,
                                  l.id,
                                  Number(e.target.value.replace(/[^0-9]/g, "")) || 0,
                                )
                              }
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

          <SaveBar
            summary={`${allotted} portions allotted`}
            onSave={() => save.mutate()}
            saving={save.isPending}
            label="Save allotment"
            secondary={
              <Button variant="outline" className="h-12 md:hidden" onClick={autoFill}>
                <Wand2 className="size-4" />
                Auto
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}
