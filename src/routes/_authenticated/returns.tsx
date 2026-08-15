import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  supabase,
  PRODUCT_COLUMNS,
  type AllocationRow,
  type Location,
  type Product,
} from "@/lib/supabase";
import { currentWeek, formatDate, isoWeek, isoWeekDate } from "@/lib/week";
import { returnsWindow, storytelDeliversOn, weekdayOf } from "@/lib/delivery";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Search = { year: number; week: number; day: string; location: string | undefined };

const LAST_LOCATION_KEY = "sizzle:last-returns-location";

/** Today's week/weekday, so the driver never has to pick a date. */
function todayDefaults() {
  const now = new Date();
  const { year, week } = isoWeek(now);
  const day = weekdayOf(new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10));
  return { year, week, day };
}

export const Route = createFileRoute("/_authenticated/returns")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const today = todayDefaults();
    const fallback = currentWeek();
    return {
      year: Number(search['year']) || today.year || fallback.year,
      week: Number(search['week']) || today.week || fallback.week,
      day: typeof search['day'] === "string" ? search['day'] : today.day,
      location: typeof search['location'] === "string" ? search['location'] : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Returns — Sizzle Ops" },
      {
        name: "description",
        content: "Log unsold dishes picked up from each location, straight from the delivery run.",
      },
      { property: "og:title", content: "Returns — Sizzle Ops" },
      { property: "og:description", content: "Fast pickup logging of unsold items per location." },
    ],
  }),
  component: ReturnsPage,
});

function ReturnsPage() {
  const { year, week, day: rawDay, location: locationParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

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

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);

  const [remembered, setRemembered] = useState<string | undefined>(undefined);
  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored) setRemembered(stored);
  }, []);

  const locationId =
    locationParam ??
    (remembered && locations.some((l) => l.id === remembered) ? remembered : locations[0]?.id);
  const location = locations.find((l) => l.id === locationId);

  function pickLocation(id: string) {
    window.localStorage.setItem(LAST_LOCATION_KEY, id);
    setRemembered(id);
    void navigate({ search: (p: Search) => ({ ...p, location: id }) });
  }

  const window_ = useMemo(() => returnsWindow(location, date), [location, date]);

  const allocationsQuery = useQuery({
    queryKey: ["returns-allocations", locationId, window_.start, window_.end],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("location_id", locationId!)
        .gte("delivery_date", window_.start)
        .lte("delivery_date", window_.end)
        .order("delivery_date");
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const allocations = useMemo(() => allocationsQuery.data ?? [], [allocationsQuery.data]);

  // `returned_at` is the real "already counted" marker. Until that column
  // exists, every delivered row is still pending — quantity_returned defaults
  // to 0 in the database, so it can never tell us anything.
  const hasReturnedAt = allocations.some((a) => a.returned_at !== undefined);
  const pending = useMemo(
    () => (hasReturnedAt ? allocations.filter((a) => !a.returned_at) : allocations),
    [allocations, hasReturnedAt],
  );

  const productIds = pending.map((a) => a.product_id).sort().join(",");
  const productsQuery = useQuery({
    queryKey: ["products-by-id", productIds],
    enabled: pending.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .in("id", pending.map((a) => a.product_id));
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  // Show the run that is due today; if that has already been logged (or was
  // never delivered), fall back to whatever is still outstanding further back
  // so nothing gets stranded.
  const inStrict = pending.filter(
    (a) => a.delivery_date >= window_.strictStart && a.delivery_date <= window_.strictEnd,
  );
  const candidates = inStrict.length > 0 ? inStrict : pending;

  const rows = useMemo(
    () =>
      candidates
        .map((a) => ({ ...a, product: products.find((p) => p.id === a.product_id) }))
        // For Storytel, keep the dishes that really ran that day.
        .filter(
          (r) =>
            window_.mode !== "storytel" ||
            !r.product ||
            storytelDeliversOn(r.product, weekdayOf(r.delivery_date)),
        )
        .sort(
          (a, b) =>
            a.delivery_date.localeCompare(b.delivery_date) ||
            (a.product?.name ?? "").localeCompare(b.product?.name ?? ""),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, products, window_.mode],
  );

  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    setDraft({});
  }, [locationId, window_.start, window_.end]);

  const save = useMutation({
    mutationFn: async () => {
      const stamp = new Date().toISOString();
      for (const r of rows) {
        const qty = draft[r.id] ?? 0;
        const { error } = await supabase
          .from("allocations")
          .update({ quantity_returned: qty, returned_at: stamp })
          .eq("id", r.id);
        if (error) {
          if (error.message.toLowerCase().includes("returned_at")) {
            const retry = await supabase
              .from("allocations")
              .update({ quantity_returned: qty })
              .eq("id", r.id);
            if (retry.error) throw retry.error;
          } else {
            throw error;
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("Returns saved");
      void queryClient.invalidateQueries({ queryKey: ["returns-allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.delivered += r.quantity_allocated;
      acc.returned += draft[r.id] ?? 0;
      return acc;
    },
    { delivered: 0, returned: 0 },
  );
  const wastePct = totals.delivered ? Math.round((totals.returned / totals.delivered) * 100) : 0;
  const allZero = rows.every((r) => (draft[r.id] ?? 0) === 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Returns pickup</h1>
        <p className="text-sm text-muted-foreground">
          {window_.mode === "storytel"
            ? `Food delivered ${formatDate(window_.end)} (plus anything still open).`
            : `Everything delivered last week, up to ${formatDate(window_.end)}.`}{" "}
          If nothing came back, tap All sold.
        </p>
      </div>

      <WeekBar year={year} week={week} day={day} label="Pickup week" />

      <div className="rounded-xl border border-border bg-card p-3">
        <Select value={locationId ?? ""} onValueChange={pickLocation}>
          <SelectTrigger className="h-14 w-full text-base">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id} className="py-3 text-base">
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing left to pick up here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const value = draft[r.id] ?? 0;
            return (
              <Card key={r.id} className={value > 0 ? "border-primary/50" : ""}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {r.product?.name ?? r.product_id}
                    </div>
                    <button
                      type="button"
                      className="mt-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() => setDraft((d) => ({ ...d, [r.id]: r.quantity_allocated }))}
                    >
                      {formatDate(r.delivery_date)} · sent {r.quantity_allocated} · all back
                    </button>
                  </div>
                  <QtyStepper
                    ariaLabel={`${r.product?.name ?? "dish"} returned`}
                    value={value}
                    max={r.quantity_allocated}
                    onChange={(v) => setDraft((d) => ({ ...d, [r.id]: v }))}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <SaveBar
          summary={
            <span>
              {totals.returned} back of {totals.delivered} ·{" "}
              <span className={wastePct > 15 ? "font-medium text-destructive" : ""}>
                {wastePct}% waste
              </span>
            </span>
          }
          onSave={() => save.mutate()}
          saving={save.isPending}
          label={allZero ? "All sold" : "Save returns"}
          secondary={
            !allZero ? (
              <Button
                variant="outline"
                className="h-12"
                onClick={() => setDraft(Object.fromEntries(rows.map((r) => [r.id, 0])))}
              >
                Reset
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
