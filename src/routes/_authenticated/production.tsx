import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase, type Product, type ProductionRow, type RequirementRow, type Location } from "@/lib/supabase";
import { currentWeek, isoWeekDate } from "@/lib/week";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

export function useDayProducts(week: number, day: string) {
  return useQuery({
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

  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!productsQuery.data || !productionQuery.data) return;
    const next: Record<string, string> = {};
    for (const p of productsQuery.data) {
      const row = productionQuery.data.find((r) => r.product_id === p.id);
      next[p.id] = row ? String(row.quantity_produced) : "";
    }
    setDraft(next);
  }, [productsQuery.data, productionQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const existing = productionQuery.data ?? [];
      for (const p of productsQuery.data ?? []) {
        const value = draft[p.id];
        const row = existing.find((r) => r.product_id === p.id);
        if (!value || !value.trim()) {
          if (row) {
            const { error } = await supabase.from("production").delete().eq("id", row.id);
            if (error) throw error;
          }
          continue;
        }
        const qty = Number(value);
        if (row) {
          const { error } = await supabase
            .from("production")
            .update({ quantity_produced: qty, week_number: week, year })
            .eq("id", row.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("production").insert({
            product_id: p.id,
            production_date: date,
            week_number: week,
            year,
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
      const vegan = Math.round((r.total_required * pct) / 100);
      acc.total += r.total_required;
      acc.vegan += vegan;
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  const produced = products.reduce(
    (acc, p) => {
      const qty = Number(draft[p.id]) || 0;
      acc.total += qty;
      if (p.is_vegan) acc.vegan += qty;
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Production register</h1>
        <p className="text-sm text-muted-foreground">
          This day&apos;s menu, pulled from the product database. Enter what the kitchen actually
          produced.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Required" value={demand.total} hint={`${demand.vegan} vegan`} />
        <Stat label="Produced" value={produced.total} hint={`${produced.vegan} vegan`} />
        <Stat
          label="Balance"
          value={produced.total - demand.total}
          hint={`vegan ${produced.vegan - demand.vegan}`}
          tone={produced.total - demand.total < 0 ? "bad" : "good"}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{products.length} dishes on the menu</CardTitle>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save production"}
          </Button>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No dishes found for week {week} on {day}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dish</TableHead>
                  <TableHead className="w-32">Diet</TableHead>
                  <TableHead className="w-40">Produced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.translated_name && p.translated_name !== p.name && (
                        <span className="block text-xs text-muted-foreground">
                          {p.translated_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.is_vegan ? (
                        <Badge>Vegan</Badge>
                      ) : p.is_vegetarian ? (
                        <Badge variant="secondary">Vegetarian</Badge>
                      ) : (
                        <Badge variant="outline">Regular</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        placeholder="0"
                        value={draft[p.id] ?? ""}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [p.id]: e.target.value.replace(/[^0-9]/g, ""),
                          }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "bad" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
