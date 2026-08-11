import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase, type Location, type RequirementRow } from "@/lib/supabase";
import { isoWeekDate, currentWeek } from "@/lib/week";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
      { property: "og:description", content: "Daily meal requirement and vegan share per location." },
    ],
  }),
  component: RequirementsPage,
});

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

  const [draft, setDraft] = useState<Record<string, { total: string; vegan: string }>>({});

  useEffect(() => {
    if (!locationsQuery.data || !requirementsQuery.data) return;
    const next: Record<string, { total: string; vegan: string }> = {};
    for (const loc of locationsQuery.data) {
      const req = requirementsQuery.data.find((r) => r.location_id === loc.id);
      next[loc.id] = {
        total: req ? String(req.total_required) : "",
        vegan: String(loc.vegan_target ?? 25),
      };
    }
    setDraft(next);
  }, [locationsQuery.data, requirementsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const locations = locationsQuery.data ?? [];
      const existing = requirementsQuery.data ?? [];
      for (const loc of locations) {
        const entry = draft[loc.id];
        if (!entry) continue;
        const total = Number(entry.total);
        const vegan = Math.min(100, Math.max(0, Number(entry.vegan) || 0));

        if (vegan !== (loc.vegan_target ?? 25)) {
          const { error } = await supabase
            .from("locations")
            .update({ vegan_target: vegan })
            .eq("id", loc.id);
          if (error) throw error;
        }

        const row = existing.find((r) => r.location_id === loc.id);
        if (!entry.total.trim() || Number.isNaN(total)) {
          if (row) {
            const { error } = await supabase.from("requirements").delete().eq("id", row.id);
            if (error) throw error;
          }
          continue;
        }
        if (row) {
          const { error } = await supabase
            .from("requirements")
            .update({ total_required: total, week_number: week, year })
            .eq("id", row.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("requirements").insert({
            location_id: loc.id,
            delivery_date: date,
            week_number: week,
            year,
            total_required: total,
            is_snack: false,
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("Requirements saved");
      void queryClient.invalidateQueries({ queryKey: ["requirements", date] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const locations = locationsQuery.data ?? [];
  const totals = locations.reduce(
    (acc, loc) => {
      const entry = draft[loc.id];
      const total = Number(entry?.total) || 0;
      const veganPct = Number(entry?.vegan) || 0;
      const vegan = Math.round((total * veganPct) / 100);
      acc.total += total;
      acc.vegan += vegan;
      return acc;
    },
    { total: 0, vegan: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Location requirements</h1>
        <p className="text-sm text-muted-foreground">
          How many meals each location needs on this delivery day, and how many of those should be
          vegan.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">
            {locations.length} active locations · {totals.total} meals ({totals.vegan} vegan /{" "}
            {totals.total - totals.vegan} non-vegan)
          </CardTitle>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save requirements"}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Scheduled days</TableHead>
                <TableHead className="w-32">Meals required</TableHead>
                <TableHead className="w-28">Vegan %</TableHead>
                <TableHead className="w-40 text-right">Split</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((loc) => {
                const entry = draft[loc.id] ?? { total: "", vegan: "25" };
                const total = Number(entry.total) || 0;
                const vegan = Math.round((total * (Number(entry.vegan) || 0)) / 100);
                const scheduled = (loc.delivery_days ?? []).some(
                  (d) => d.toLowerCase() === day.toLowerCase(),
                );
                return (
                  <TableRow key={loc.id} className={scheduled ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">
                      {(loc.delivery_days ?? []).join(", ") || "—"}
                      {!scheduled && <span className="ml-1">(not scheduled {day})</span>}
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        value={entry.total}
                        placeholder="0"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [loc.id]: { ...entry, total: e.target.value.replace(/[^0-9]/g, "") },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        value={entry.vegan}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [loc.id]: { ...entry, vegan: e.target.value.replace(/[^0-9]/g, "") },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <span className="font-medium text-foreground">{vegan}</span> vegan ·{" "}
                      {total - vegan} other
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
