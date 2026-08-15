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
import { formatDate, todayIso } from "@/lib/week";
import {
  deliversOn,
  isStorytel,
  previousWeekRange,
  previousWeekday,
  storytelDeliversOn,
  weekdayOf,
} from "@/lib/delivery";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Search = { date: string | undefined; location: string | undefined };

const LAST_LOCATION_KEY = "sizzle:last-returns-location";

export const Route = createFileRoute("/_authenticated/returns")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    date: typeof search['date'] === "string" ? search['date'] : undefined,
    location: typeof search['location'] === "string" ? search['location'] : undefined,
  }),
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  // The driver never picks a date — today is the pickup day.
  const date = search.date ?? todayIso();
  const [showDate, setShowDate] = useState(false);

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
    search.location ??
    (remembered && locations.some((l) => l.id === remembered) ? remembered : locations[0]?.id);
  const location = locations.find((l) => l.id === locationId);

  function pickLocation(id: string) {
    window.localStorage.setItem(LAST_LOCATION_KEY, id);
    setRemembered(id);
    void navigate({ search: (p: Search) => ({ ...p, location: id }) });
  }

  /**
   * Storytel picks up the previous delivery day's food (Monday collects Friday's).
   * Everyone else is a weekly run: on their delivery day everything from the
   * whole previous week comes back at once.
   */
  const window_ = useMemo(() => {
    if (location && isStorytel(location)) {
      const from = previousWeekday(date);
      return { start: from, end: from, mode: "storytel" as const };
    }
    const { start, end } = previousWeekRange(date);
    return { start, end, mode: "weekly" as const };
  }, [location, date]);

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

  // Anything already counted drops off the list, so a second visit never re-asks.
  const pending = useMemo(
    () => (allocationsQuery.data ?? []).filter((a) => a.quantity_returned === null),
    [allocationsQuery.data],
  );

  const productsQuery = useQuery({
    queryKey: ["products-by-id", pending.map((a) => a.product_id).sort().join(",")],
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

  const products = productsQuery.data ?? [];

  const rows = useMemo(
    () =>
      pending
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
    [pending, products, window_.mode],
  );

  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    setDraft({});
  }, [locationId, window_.start, window_.end]);

  const save = useMutation({
    mutationFn: async () => {
      for (const r of rows) {
        const qty = draft[r.id] ?? 0;
        const { error } = await supabase
          .from("allocations")
          .update({ quantity_returned: qty })
          .eq("id", r.id);
        if (error) throw error;
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

  const scheduledToday = location ? deliversOn(location, weekdayOf(date)) : true;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Returns pickup</h1>
        <p className="text-sm text-muted-foreground">
          {window_.mode === "storytel"
            ? `Food delivered ${formatDate(window_.start)}.`
            : `Everything delivered ${formatDate(window_.start)} – ${formatDate(window_.end)}.`}{" "}
          If nothing came back, tap All sold.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
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

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Today · {formatDate(date)}</span>
          {showDate ? (
            <Input
              type="date"
              className="h-9 w-40"
              value={date}
              onChange={(e) =>
                void navigate({ search: (p: Search) => ({ ...p, date: e.target.value }) })
              }
            />
          ) : (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => setShowDate(true)}
            >
              change date
            </button>
          )}
        </div>
        {!scheduledToday && (
          <p className="text-xs text-muted-foreground">
            {location?.name} has no delivery on {weekdayOf(date)} — showing anything still
            outstanding.
          </p>
        )}
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
