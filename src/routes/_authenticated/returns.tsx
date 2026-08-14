import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  supabase,
  PRODUCT_COLUMNS,
  type AllocationRow,
  type Location,
  type Product,
} from "@/lib/supabase";
import { formatDate, todayIso, shiftDate } from "@/lib/week";
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

  const date = search.date ?? todayIso();

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

  // Remember the location the driver used last so the flow is one tap on arrival.
  const [remembered, setRemembered] = useState<string | undefined>(undefined);
  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored) setRemembered(stored);
  }, []);

  const locationId =
    search.location ??
    (remembered && locations.some((l) => l.id === remembered) ? remembered : locations[0]?.id);

  function pickLocation(id: string) {
    window.localStorage.setItem(LAST_LOCATION_KEY, id);
    setRemembered(id);
    void navigate({ search: (p: Search) => ({ ...p, location: id }) });
  }

  function setDate(next: string) {
    void navigate({ search: (p: Search) => ({ ...p, date: next }) });
  }

  const allocationsQuery = useQuery({
    queryKey: ["allocations", date, locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("delivery_date", date)
        .eq("location_id", locationId!);
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const allocations = useMemo(() => allocationsQuery.data ?? [], [allocationsQuery.data]);

  const productsQuery = useQuery({
    queryKey: ["products-by-id", allocations.map((a) => a.product_id).sort().join(",")],
    enabled: allocations.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .in("id", allocations.map((a) => a.product_id));
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const products = productsQuery.data ?? [];

  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const a of allocations) next[a.id] = a.quantity_returned ?? 0;
    setDraft(next);
  }, [allocations]);

  const save = useMutation({
    mutationFn: async () => {
      for (const a of allocations) {
        const qty = draft[a.id] ?? 0;
        if ((a.quantity_returned ?? 0) === qty) continue;
        const { error } = await supabase
          .from("allocations")
          .update({ quantity_returned: qty })
          .eq("id", a.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Returns saved");
      void queryClient.invalidateQueries({ queryKey: ["allocations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totals = allocations.reduce(
    (acc, a) => {
      acc.delivered += a.quantity_allocated;
      acc.returned += draft[a.id] ?? 0;
      return acc;
    },
    { delivered: 0, returned: 0 },
  );
  const wastePct = totals.delivered
    ? Math.round((totals.returned / totals.delivered) * 100)
    : 0;

  const rows = allocations
    .map((a) => ({ ...a, product: products.find((p) => p.id === a.product_id) }))
    .sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Returns pickup</h1>
        <p className="text-sm text-muted-foreground">
          Tap what came back. Everything starts at zero — only touch the dishes with leftovers.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
        <Select value={locationId ?? ""} onValueChange={pickLocation}>
          <SelectTrigger className="h-12 w-full text-base">
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

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Previous day"
            onClick={() => setDate(shiftDate(date, -1))}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div className="flex-1 text-center text-sm font-medium">{formatDate(date)}</div>
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label="Next day"
            onClick={() => setDate(shiftDate(date, 1))}
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing was delivered to this location on {formatDate(date)}.
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
                      onClick={() =>
                        setDraft((d) => ({ ...d, [r.id]: r.quantity_allocated }))
                      }
                    >
                      sent {r.quantity_allocated} · all back
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
          label="Save returns"
          secondary={
            <Button
              variant="outline"
              className="h-12"
              onClick={() => setDraft(Object.fromEntries(allocations.map((a) => [a.id, 0])))}
            >
              All sold
            </Button>
          }
        />
      )}
    </div>
  );
}
