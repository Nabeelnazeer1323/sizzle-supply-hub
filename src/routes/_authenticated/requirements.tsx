import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase, type Location, type RequirementRow } from "@/lib/supabase";
import { isoWeekDate, currentWeek } from "@/lib/week";
import { deliversOn } from "@/lib/delivery";
import { DEFAULT_CATEGORY, normalizeCategory } from "@/lib/category";
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
      { title: "Lunch requirements — Sizzle Ops" },
      {
        name: "description",
        content: "Register the daily lunch requirement and vegan share for every Sizzle location.",
      },
      { property: "og:title", content: "Lunch requirements — Sizzle Ops" },
      {
        property: "og:description",
        content: "Daily lunch requirement and vegan share per location.",
      },
    ],
  }),
  component: RequirementsPage,
});

type DraftEntry = { vegan: string; qty: string };

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

  // Only locations that actually get a delivery on this weekday.
  const locations = (locationsQuery.data ?? []).filter((l) => deliversOn(l, day));

  const [draft, setDraft] = useState<Record<string, DraftEntry>>({});

  useEffect(() => {
    if (!locationsQuery.data || !requirementsQuery.data) return;
    const next: Record<string, DraftEntry> = {};
    for (const loc of locationsQuery.data) {
      const row = requirementsQuery.data.find(
        (r) =>
          r.location_id === loc.id && normalizeCategory(r.category) === DEFAULT_CATEGORY,
      );
      next[loc.id] = {
        vegan: String(loc.vegan_target ?? 25),
        qty: row ? String(row.total_required) : "",
      };
    }
    setDraft(next);
  }, [locationsQuery.data, requirementsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
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

        const qty = Number(entry.qty);
        const row = existing.find(
          (r) =>
            r.location_id === loc.id && normalizeCategory(r.category) === DEFAULT_CATEGORY,
        );

        if (!entry.qty.trim() || Number.isNaN(qty) || qty <= 0) {
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
          const base = { location_id: loc.id, delivery_date: date, total_required: qty };
          const { error } = await supabase
            .from("requirements")
            .insert({ ...base, category: DEFAULT_CATEGORY });
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
      return categorySupported;
    },
    onSuccess: () => {
      toast.success("Requirements saved");
      void queryClient.invalidateQueries({ queryKey: ["requirements", date] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = locations.reduce(
    (acc, loc) => {
      const entry = draft[loc.id];
      const total = Number(entry?.qty) || 0;
      acc.total += total;
      acc.vegan += Math.round((total * (Number(entry?.vegan) || 0)) / 100);
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Lunch requirements</h1>
        <p className="text-sm text-muted-foreground">
          How many lunches each location needs on this delivery day, and how much of it is vegan.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <div className="space-y-3">
        {locations.map((loc) => {
          const entry = draft[loc.id] ?? { vegan: "25", qty: "" };
          const total = Number(entry.qty) || 0;
          return (
            <Card key={loc.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                  <span>{loc.name}</span>
                  <span className="text-xs font-normal capitalize text-muted-foreground">
                    {(loc.delivery_days ?? []).join(", ")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Lunches</span>
                  <QtyStepper
                    ariaLabel={`${loc.name} lunches required`}
                    value={total}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        [loc.id]: { ...entry, qty: v ? String(v) : "" },
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {locations.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No deliveries scheduled on {day}.
            </CardContent>
          </Card>
        )}
      </div>

      {locations.length > 0 && (
        <SaveBar
          summary={`${totals.total} lunches · ${totals.vegan} vegan`}
          onSave={() => save.mutate()}
          saving={save.isPending}
          label="Save requirements"
        />
      )}
    </div>
  );
}
