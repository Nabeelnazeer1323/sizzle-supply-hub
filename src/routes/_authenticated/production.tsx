import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  supabase,
  PRODUCT_COLUMNS,
  type Product,
  type ProductionRow,
  type RequirementRow,
  type Location,
} from "@/lib/supabase";
import { currentWeek, isoWeekDate } from "@/lib/week";
import { categoryLabel, productCategory } from "@/lib/category";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/production")({
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
      { title: "Production register — Sizzle Ops" },
      {
        name: "description",
        content: "Register how many portions of each dish were produced for the day.",
      },
      { property: "og:title", content: "Production register — Sizzle Ops" },
      { property: "og:description", content: "Daily produced quantities per dish." },
    ],
  }),
  component: ProductionPage,
});

/** Dishes on the menu for a given week + delivery day. */
export function useDayProducts(week: number, day: string) {
  return useQuery({
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
}

function ProductionPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);
  const queryClient = useQueryClient();

  const productsQuery = useDayProducts(week, day);

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
        .eq("is_active", true);
      if (error) throw error;
      return data as Location[];
    },
  });

  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!productsQuery.data || !productionQuery.data) return;
    const next: Record<string, number> = {};
    for (const p of productsQuery.data) {
      const row = productionQuery.data.find((r) => r.product_id === p.id);
      next[p.id] = row ? row.quantity_produced : 0;
    }
    setDraft(next);
  }, [productsQuery.data, productionQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const existing = productionQuery.data ?? [];
      for (const p of productsQuery.data ?? []) {
        const qty = draft[p.id] ?? 0;
        const row = existing.find((r) => r.product_id === p.id);
        if (qty <= 0) {
          if (row) {
            const { error } = await supabase.from("production").delete().eq("id", row.id);
            if (error) throw error;
          }
          continue;
        }
        if (row) {
          const { error } = await supabase
            .from("production")
            .update({ quantity_produced: qty })
            .eq("id", row.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("production").insert({
            product_id: p.id,
            production_date: date,
            quantity_produced: qty,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("Production registered");
      void queryClient.invalidateQueries({ queryKey: ["production", date] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const products = productsQuery.data ?? [];
  const requirements = requirementsQuery.data ?? [];
  const locations = locationsQuery.data ?? [];

  const demand = requirements.reduce(
    (acc, r) => {
      const loc = locations.find((l) => l.id === r.location_id);
      const pct = loc?.vegan_target ?? 25;
      acc.total += r.total_required;
      acc.vegan += Math.round((r.total_required * pct) / 100);
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  const produced = products.reduce(
    (acc, p) => {
      const qty = draft[p.id] ?? 0;
      acc.total += qty;
      if (p.is_vegan) acc.vegan += qty;
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Production register</h1>
        <p className="text-sm text-muted-foreground">
          This day&apos;s menu. Enter what the kitchen actually produced.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Required" value={demand.total} hint={`${demand.vegan} vegan`} />
        <Stat label="Produced" value={produced.total} hint={`${produced.vegan} vegan`} />
        <Stat
          label="Balance"
          value={produced.total - demand.total}
          hint={`vegan ${produced.vegan - demand.vegan}`}
          tone={produced.total - demand.total < 0 ? "bad" : "good"}
        />
      </div>

      {products.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No dishes found for week {week} on {day}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {products.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {p.is_vegan ? (
                      <Badge className="text-[10px]">Vegan</Badge>
                    ) : p.is_vegetarian ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Vegetarian
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Regular
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {categoryLabel(productCategory(p))}
                    </Badge>
                  </div>
                </div>
                <QtyStepper
                  ariaLabel={`${p.name} produced`}
                  value={draft[p.id] ?? 0}
                  onChange={(v) => setDraft((d) => ({ ...d, [p.id]: v }))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SaveBar
        summary={`${products.length} dishes · ${produced.total} portions`}
        onSave={() => save.mutate()}
        saving={save.isPending}
        label="Save production"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-xl font-semibold tabular-nums ${
          tone === "bad" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
