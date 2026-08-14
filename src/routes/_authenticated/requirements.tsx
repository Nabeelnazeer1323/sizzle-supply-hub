import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  supabase,
  PRODUCT_COLUMNS,
  type Location,
  type Product,
  type RequirementRow,
} from "@/lib/supabase";
import { isoWeekDate, currentWeek } from "@/lib/week";
import {
  DEFAULT_CATEGORY,
  categoriesOf,
  categoryLabel,
  normalizeCategory,
  type Category,
} from "@/lib/category";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/requirements")({
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
      { title: "Location requirements — Sizzle Ops" },
      {
        name: "description",
        content: "Register the daily meal requirement and vegan share for every Sizzle location.",
      },
      { property: "og:title", content: "Location requirements — Sizzle Ops" },
      {
        property: "og:description",
        content: "Daily meal requirement and vegan share per location.",
      },
    ],
  }),
  component: RequirementsPage,
});

type DraftEntry = { vegan: string; byCategory: Record<string, string> };

function RequirementsPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);
  const queryClient = useQueryClient();

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

  const productsQuery = useQuery({
    queryKey: ["products", week, day],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("week_number", week);
      if (error) throw error;
      return (data as unknown as Product[]).filter(
        (p) =>
          !p.delivery_day ||
          p.delivery_day === "" ||
          p.delivery_day.toLowerCase() === day.toLowerCase(),
      );
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

  const categories: Category[] = useMemo(
    () => categoriesOf(productsQuery.data ?? []),
    [productsQuery.data],
  );

  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});

  useEffect(() => {
    if (!locationsQuery.data || !requirementsQuery.data) return;
    const next: Record<string, DraftEntry> = {};
    for (const loc of locationsQuery.data) {
      const rows = requirementsQuery.data.filter((r) => r.location_id === loc.id);
      const byCategory: Record<string, string> = {};
      for (const r of rows) {
        byCategory[normalizeCategory(r.category)] = String(r.total_required);
      }
      next[loc.id] = { vegan: String(loc.vegan_target ?? 25), byCategory };
    }
    setDraft(next);
  }, [locationsQuery.data, requirementsQuery.data]);

  function setQty(locationId: string, category: string, value: string) {
    setDraft((d) => {
      const entry = d[locationId] ?? { vegan: "25", byCategory: {} };
      return {
        ...d,
        [locationId]: { ...entry, byCategory: { ...entry.byCategory, [category]: value } },
      };
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const locations = locationsQuery.data ?? [];
      const existing = requirementsQuery.data ?? [];
      let categorySupported = true;

      for (const loc of locations) {
        const entry = draft[loc.id];
        if (!entry) continue;

        const vegan = Math.min(100, Math.max(0, Number(entry.vegan) || 0));
        if (vegan !== (loc.vegan_target ?? 25)) {
          const { error } = await supabase
            .from("locations")
            .update({ vegan_target: vegan })
            .eq("id", loc.id);
          if (error) throw error;
        }

        for (const category of categories) {
          const raw = entry.byCategory[category] ?? "";
          const qty = Number(raw);
          const row = existing.find(
            (r) => r.location_id === loc.id && normalizeCategory(r.category) === category,
          );

          if (!raw.trim() || Number.isNaN(qty) || qty <= 0) {
            if (row) {
              const { error } = await supabase.from("requirements").delete().eq("id", row.id);
              if (error) throw error;
            }
            continue;
          }

          if (row) {
            const { error } = await supabase
              .from("requirements")
              .update({ total_required: qty })
              .eq("id", row.id);
            if (error) throw error;
          } else {
            const base = {
              location_id: loc.id,
              delivery_date: date,
              total_required: qty,
            };
            const { error } = await supabase.from("requirements").insert({ ...base, category });
            if (error) {
              // The category column may not exist yet — fall back to a plain row.
              if (error.message.toLowerCase().includes("category")) {
                categorySupported = false;
                const retry = await supabase.from("requirements").insert(base);
                if (retry.error) throw retry.error;
              } else {
                throw error;
              }
            }
          }
        }
      }
      return categorySupported;
    },
    onSuccess: (categorySupported) => {
      toast.success(
        categorySupported
          ? "Requirements saved"
          : "Saved — add the category column in Setup to split by category",
      );
      void queryClient.invalidateQueries({ queryKey: ["requirements", date] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locations = locationsQuery.data ?? [];
  const totals = locations.reduce(
    (acc, loc) => {
      const entry = draft[loc.id];
      const total = Object.values(entry?.byCategory ?? {}).reduce(
        (s, v) => s + (Number(v) || 0),
        0,
      );
      const veganPct = Number(entry?.vegan) || 0;
      acc.total += total;
      acc.vegan += Math.round((total * veganPct) / 100);
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Location requirements</h1>
        <p className="text-sm text-muted-foreground">
          What each location needs on this delivery day, per category, and how much of it is vegan.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="space-y-3">
        {locations.map((loc) => {
          const entry = draft[loc.id] ?? { vegan: "25", byCategory: {} };
          const scheduled = (loc.delivery_days ?? []).some(
            (d) => d.toLowerCase() === day.toLowerCase(),
          );
          const total = categories.reduce(
            (s, c) => s + (Number(entry.byCategory[c]) || 0),
            0,
          );
          const vegan = Math.round((total * (Number(entry.vegan) || 0)) / 100);
          return (
            <Card key={loc.id} className={scheduled ? "" : "opacity-60"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                  <span>{loc.name}</span>
                  <span className="text-xs font-normal capitalize text-muted-foreground">
                    {(loc.delivery_days ?? []).join(", ") || "no days set"}
                    {!scheduled && ` · not scheduled ${day}`}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {categories.map((c) => (
                  <div key={c} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{categoryLabel(c)}</span>
                    <QtyStepper
                      ariaLabel={`${loc.name} ${categoryLabel(c)} required`}
                      value={Number(entry.byCategory[c]) || 0}
                      onChange={(v) => setQty(loc.id, c, v ? String(v) : "")}
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-sm font-medium">Vegan %</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {vegan} of {total}
                    </span>
                    <Input
                      aria-label={`${loc.name} vegan percent`}
                      inputMode="numeric"
                      className="h-11 w-20 text-center text-base tabular-nums"
                      value={entry.vegan}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [loc.id]: {
                            ...entry,
                            vegan: e.target.value.replace(/[^0-9]/g, ""),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {locations.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No active locations found.
            </CardContent>
          </Card>
        )}
      </div>

      <SaveBar
        summary={`${totals.total} meals · ${totals.vegan} vegan`}
        onSave={() => save.mutate()}
        saving={save.isPending}
        label="Save requirements"
      />
    </div>
  );
}

export { DEFAULT_CATEGORY };
