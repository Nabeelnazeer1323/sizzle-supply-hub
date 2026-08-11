import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  supabase,
  type AllocationRow,
  type Location,
  type Product,
  type ReturnRow,
} from "@/lib/supabase";
import { WEEKDAYS, currentWeek, formatWeek, isoWeekDate, previousWeek } from "@/lib/week";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Search = { year: number; week: number; day: string; location: string | undefined };

export const Route = createFileRoute("/_authenticated/returns")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const now = currentWeek();
    return {
      year: Number(search['year']) || now.year,
      week: Number(search['week']) || now.week,
      day: typeof search['day'] === "string" ? search['day'] : "Monday",
      location: typeof search['location'] === "string" ? search['location'] : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Returns — Sizzle Ops" },
      {
        name: "description",
        content: "Log unsold dishes returned from each location for the previous week.",
      },
      { property: "og:title", content: "Returns — Sizzle Ops" },
      { property: "og:description", content: "Record last week's unsold items per location." },
    ],
  }),
  component: ReturnsPage,
});

function ReturnsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // Returns are always registered against the week BEFORE the selected week.
  const prev = previousWeek(search.year, search.week);

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

  const locations = locationsQuery.data ?? [];
  const locationId = search.location ?? locations[0]?.id;

  const dates = WEEKDAYS.map((d) => ({ day: d, date: isoWeekDate(prev.year, prev.week, d) }));

  const allocationsQuery = useQuery({
    queryKey: ["allocations-week", prev.year, prev.week, locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("location_id", locationId!)
        .in(
          "delivery_date",
          dates.map((d) => d.date),
        );
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["products", prev.week],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,translated_name,week_number,delivery_day,is_vegan,is_vegetarian,is_snack,image_url",
        )
        .eq("week_number", prev.week);
      if (error) throw error;
      return data as Product[];
    },
  });

  const returnsQuery = useQuery({
    queryKey: ["returns", prev.year, prev.week, locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("returns")
        .select("*")
        .eq("location_id", locationId!)
        .eq("week_number", prev.week)
        .eq("year", prev.year);
      if (error) {
        if (error.message.toLowerCase().includes("returns")) return [] as ReturnRow[];
        throw error;
      }
      return data as ReturnRow[];
    },
  });

  const allocations = allocationsQuery.data ?? [];
  const products = productsQuery.data ?? [];

  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const a of allocations) {
      const key = `${a.delivery_date}|${a.product_id}`;
      const existing = (returnsQuery.data ?? []).find(
        (r) => r.delivery_date === a.delivery_date && r.product_id === a.product_id,
      );
      next[key] = existing ? String(existing.quantity_returned) : "";
    }
    setDraft(next);
  }, [allocationsQuery.data, returnsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(draft)
        .filter(([, v]) => v.trim() !== "")
        .map(([key, v]) => {
          const [date, productId] = key.split("|");
          return {
            location_id: locationId!,
            product_id: productId!,
            delivery_date: date!,
            week_number: prev.week,
            year: prev.year,
            quantity_returned: Number(v),
          };
        });

      const { error: delError } = await supabase
        .from("returns")
        .delete()
        .eq("location_id", locationId!)
        .eq("week_number", prev.week)
        .eq("year", prev.year);
      if (delError) throw delError;

      if (rows.length > 0) {
        const { error } = await supabase.from("returns").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Returns saved");
      void queryClient.invalidateQueries({ queryKey: ["returns"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("returns")
          ? "The returns table doesn't exist yet — open Setup to create it."
          : e.message,
      ),
  });

  const totals = allocations.reduce(
    (acc, a) => {
      const returned = Number(draft[`${a.delivery_date}|${a.product_id}`]) || 0;
      acc.delivered += a.quantity_allocated;
      acc.returned += returned;
      return acc;
    },
    { delivered: 0, returned: 0 },
  );
  const wastePct = totals.delivered ? Math.round((totals.returned / totals.delivered) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Returns</h1>
        <p className="text-sm text-muted-foreground">
          Unsold items coming back from the fridges. Dishes are pulled from the previous week&apos;s
          deliveries — {formatWeek(prev.year, prev.week)}.
        </p>
      </div>

      <WeekBar year={search.year} week={search.week} day={normalizeDay(search.day)} showDay={false} />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={locationId ?? ""}
          onValueChange={(v) =>
            void navigate({ search: (p: Search) => ({ ...p, location: v }) })
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          {totals.delivered} delivered · {totals.returned} returned ·{" "}
          <span className={wastePct > 15 ? "font-medium text-destructive" : ""}>
            {wastePct}% waste
          </span>
        </div>
        <Button className="ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save returns"}
        </Button>
      </div>

      {allocations.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No deliveries recorded for this location in {formatWeek(prev.year, prev.week)}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {dates.map(({ day, date }) => {
            const rows = allocations.filter((a) => a.delivery_date === date);
            if (rows.length === 0) return null;
            return (
              <Card key={date}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {day} <span className="text-muted-foreground">· {date}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rows.map((a) => {
                    const product = products.find((p) => p.id === a.product_id);
                    const key = `${a.delivery_date}|${a.product_id}`;
                    return (
                      <div key={a.id} className="flex items-center gap-3">
                        <span className="flex-1 text-sm">{product?.name ?? a.product_id}</span>
                        <span className="w-24 text-right text-sm text-muted-foreground">
                          sent {a.quantity_allocated}
                        </span>
                        <Input
                          className="w-28 text-center"
                          inputMode="numeric"
                          placeholder="returned"
                          value={draft[key] ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              [key]: e.target.value.replace(/[^0-9]/g, ""),
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
