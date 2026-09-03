import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, PackagePlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { categoryLabel, isPantryProduct, productCategory } from "@/lib/category";
import { useSnackInventory } from "@/lib/snacks-data";
import {
  batchStatusLabel,
  closeReasonLabel,
  money,
  reasonLabel,
  statusLabel,
  STATUS_ORDER,
  type BatchState,
  type StockLine,
  type StockStatus,
} from "@/lib/snacks";
import { defaultWeekSearch, formatDate, todayIso } from "@/lib/week";
import { QtyStepper } from "@/components/QtyStepper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const LAST_LOCATION_KEY = "sizzle:last-snack-location";

export const Route = createFileRoute("/_authenticated/snacks")({
  head: () => ({
    meta: [
      { title: "Snack inventory — Sizzle Ops" },
      {
        name: "description",
        content:
          "Live snack stock per location and per delivery batch, with expiry and sold-out warnings.",
      },
      { property: "og:title", content: "Snack inventory — Sizzle Ops" },
      {
        property: "og:description",
        content: "What is in every fridge, from which delivery, and what needs a restock.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SnacksPage,
});

const TONE_CLASS: Record<StockStatus, string> = {
  expired: "border-destructive/60",
  out: "border-destructive/60",
  expiring: "border-amber-500/60",
  low: "border-amber-500/40",
  ok: "border-border",
};

function StatusBadge({ status }: { status: StockStatus }) {
  if (status === "expired" || status === "out")
    return <Badge variant="destructive">{statusLabel(status)}</Badge>;
  if (status === "expiring" || status === "low")
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        {statusLabel(status)}
      </Badge>
    );
  return null;
}

function BatchBadge({ batch }: { batch: BatchState }) {
  if (batch.status === "CLOSED")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {closeReasonLabel(batch.close_reason)}
      </Badge>
    );
  if (batch.status === "EXPIRED") return <Badge variant="destructive">Expired</Badge>;
  if (batch.status === "SOLD_OUT")
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Sold out
      </Badge>
    );
  if (batch.daysLeft !== null && batch.daysLeft <= 7)
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        {batch.daysLeft}d left
      </Badge>
    );
  return null;
}

function SnacksPage() {
  const queryClient = useQueryClient();
  const { locations, productById, lines, adjustments, isPending, error } = useSnackInventory();

  const [locationId, setLocationId] = useState<string>("all");
  const [filter, setFilter] = useState<StockStatus | null>(null);
  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored) setLocationId(stored);
  }, []);

  function pickLocation(id: string) {
    setLocationId(id);
    window.localStorage.setItem(LAST_LOCATION_KEY, id);
  }

  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const atLocation = useMemo(
    () => lines.filter((line) => locationId === "all" || line.location_id === locationId),
    [lines, locationId],
  );

  const counts = useMemo(() => {
    const base: Record<StockStatus, number> = { expired: 0, out: 0, expiring: 0, low: 0, ok: 0 };
    for (const line of atLocation) base[line.status] += 1;
    return base;
  }, [atLocation]);

  const totals = useMemo(() => {
    let value = 0;
    let sold = 0;
    for (const line of atLocation) {
      value += line.value;
      sold += line.sold;
    }
    return { value, sold };
  }, [atLocation]);

  const visible = useMemo(
    () =>
      atLocation
        .filter((line) => (filter ? line.status === filter : true))
        .sort((a, b) => {
          const diff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (diff !== 0) return diff;
          return (productById.get(a.product_id)?.name ?? "").localeCompare(
            productById.get(b.product_id)?.name ?? "",
          );
        }),
    [atLocation, filter, productById],
  );

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openLine = lines.find((l) => l.key === openKey) ?? null;

  const adjust = useMutation({
    mutationFn: async (input: { line: StockLine; delta: number; reason: string }) => {
      const { error: insertError } = await supabase.from("snack_adjustments").insert({
        product_id: input.line.product_id,
        location_id: input.line.location_id,
        occurred_on: todayIso(),
        quantity_delta: input.delta,
        reason: input.reason,
      });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast.success("Stock updated");
      void queryClient.invalidateQueries({ queryKey: ["snack-adjustments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeBatch = useMutation({
    mutationFn: async (input: { batch: BatchState; reason: string; leftover: number }) => {
      const { error: updateError } = await supabase
        .from("snack_batches")
        .update({
          closed_on: todayIso(),
          closed_quantity: input.leftover,
          close_reason: input.reason,
        })
        .eq("id", input.batch.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      toast.success("Batch closed");
      void queryClient.invalidateQueries({ queryKey: ["snack-batches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeAdjustment = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError } = await supabase
        .from("snack_adjustments")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
    },
    onSuccess: () => {
      toast.success("Correction removed");
      void queryClient.invalidateQueries({ queryKey: ["snack-adjustments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const [recount, setRecount] = useState<number>(0);
  useEffect(() => {
    if (openLine) setRecount(openLine.onHand);
  }, [openKey, openLine?.onHand]);

  const openProduct = openLine ? productById.get(openLine.product_id) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Snack inventory</h1>
          <p className="text-sm text-muted-foreground">
            What is in the fridge right now, batch by batch.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/snacks/report" search={defaultWeekSearch()}>
              <BarChart3 className="size-4" /> Report
            </Link>
          </Button>
          <Button asChild>
            <Link to="/snacks/restock" search={{ location: locationId }}>
              <PackagePlus className="size-4" /> Restock
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load snack inventory</AlertTitle>
          <AlertDescription>
            {error.message}
            {error.message.toLowerCase().includes("snack_") ||
            error.message.toLowerCase().includes("closed_on") ? (
              <>
                {" "}
                Run the snack SQL on the{" "}
                <Link className="underline" to="/setup">
                  setup page
                </Link>{" "}
                first.
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Select value={locationId} onValueChange={pickLocation}>
        <SelectTrigger className="h-12 w-full text-base sm:max-w-sm" aria-label="Location">
          <SelectValue placeholder="All locations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All locations</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["expired", "out", "expiring", "low"] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(filter === status ? null : status)}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
              filter === status ? "border-primary bg-primary/5" : TONE_CLASS[status]
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {statusLabel(status)}
            </p>
            <p
              className={`text-xl font-semibold tabular-nums ${
                counts[status] > 0 && (status === "expired" || status === "out")
                  ? "text-destructive"
                  : ""
              }`}
            >
              {counts[status]}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>{money.format(totals.value)} on the shelf</span>
        <span>·</span>
        <span>{totals.sold} sold</span>
        {filter ? (
          <Button variant="ghost" size="sm" onClick={() => setFilter(null)}>
            Clear filter
          </Button>
        ) : null}
      </div>

      {isPending ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading inventory…</p>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {filter
              ? `Nothing ${statusLabel(filter).toLowerCase()} here.`
              : "No deliveries registered here yet. Use Restock to add the first one."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((line) => {
            const product = productById.get(line.product_id);
            const location = locationById.get(line.location_id);
            const uncategorised = product ? !isPantryProduct(product) : false;
            return (
              <li key={line.key}>
                <button
                  type="button"
                  onClick={() => setOpenKey(line.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent ${TONE_CLASS[line.status]}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {product?.name ?? `Product ${line.product_id}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {product ? `${categoryLabel(productCategory(product))} · ` : ""}
                      {location?.name ?? line.location_id}
                      {line.earliestBestBefore
                        ? ` · best before ${formatDate(line.earliestBestBefore)}`
                        : ""}
                      {line.daysOfCover !== null
                        ? ` · ~${Math.floor(line.daysOfCover)}d cover`
                        : ""}
                    </p>
                    {uncategorised ? (
                      <p className="text-[11px] font-medium text-amber-600">
                        Needs a category (snack / breakfast / drink)
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{line.onHand}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {line.sold} sold
                    </p>
                  </div>
                  <StatusBadge status={line.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={Boolean(openLine)} onOpenChange={(open) => !open && setOpenKey(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          {openLine ? (
            <>
              <SheetHeader>
                <SheetTitle>
                  {openProduct?.name ?? `Product ${openLine.product_id}`} ·{" "}
                  {locationById.get(openLine.location_id)?.name ?? ""}
                </SheetTitle>
                <SheetDescription>
                  {openLine.onHand} on hand · {openLine.delivered} delivered in total ·{" "}
                  {openLine.sold} sold
                  {openLine.wastedUnits > 0 ? ` · ${openLine.wastedUnits} taken back` : ""} ·{" "}
                  {money.format(openLine.value)} at cost
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 px-4 pb-8">
                <div>
                  <h3 className="mb-2 text-sm font-medium">Deliveries</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {[...openLine.batches].reverse().map((batch) => (
                      <li key={batch.id} className="space-y-2 p-3 text-sm">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">
                              Delivered {formatDate(batch.delivered_on)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {batch.quantity} delivered · {batch.sold} sold ·{" "}
                              {batch.adjusted === 0
                                ? "no corrections"
                                : `${batch.adjusted > 0 ? "+" : ""}${batch.adjusted} corrections`}{" "}
                              · {batch.closed_on ? 0 : batch.remaining} left
                              {batch.unit_cost !== null
                                ? ` · ${money.format(batch.unit_cost)} each`
                                : ""}
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {batch.best_before
                                ? `Best before ${formatDate(batch.best_before)}`
                                : "No best-before date"}
                              {batch.closed_on
                                ? ` · ${closeReasonLabel(batch.close_reason)} ${formatDate(batch.closed_on)} (${batch.closed_quantity ?? 0} back)`
                                : ` · ${batchStatusLabel(batch.status)}`}
                            </p>
                          </div>
                          <BatchBadge batch={batch} />
                          <span className="w-8 text-right font-semibold tabular-nums">
                            {batch.remaining}
                          </span>
                        </div>

                        {!batch.closed_on ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={closeBatch.isPending}
                              onClick={() =>
                                closeBatch.mutate({
                                  batch,
                                  reason: "COLLECTED",
                                  leftover: batch.remaining,
                                })
                              }
                            >
                              Picked back up ({batch.remaining})
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={closeBatch.isPending}
                              onClick={() =>
                                closeBatch.mutate({
                                  batch,
                                  reason: "THROWN",
                                  leftover: batch.remaining,
                                })
                              }
                            >
                              Thrown away
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <h3 className="mb-2 text-sm font-medium">Recount</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <QtyStepper value={recount} onChange={setRecount} ariaLabel="Counted units" />
                    <Button
                      disabled={adjust.isPending || recount === openLine.onHand}
                      onClick={() =>
                        adjust.mutate({
                          line: openLine,
                          delta: recount - openLine.onHand,
                          reason: "RECOUNT",
                        })
                      }
                    >
                      Save count
                    </Button>
                  </div>
                </div>

                <Button asChild variant="secondary" className="w-full">
                  <Link to="/snacks/restock" search={{ location: openLine.location_id }}>
                    Restock this location
                  </Link>
                </Button>

                {adjustments.filter(
                  (a) =>
                    a.product_id === openLine.product_id &&
                    a.location_id === openLine.location_id,
                ).length ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Corrections</h3>
                    <ul className="divide-y divide-border text-sm">
                      {adjustments
                        .filter(
                          (a) =>
                            a.product_id === openLine.product_id &&
                            a.location_id === openLine.location_id,
                        )
                        .slice(0, 10)
                        .map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                            <span>
                              {formatDate(a.occurred_on)} · {reasonLabel(a.reason)}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums text-muted-foreground">
                                {a.quantity_delta > 0 ? "+" : ""}
                                {a.quantity_delta}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={removeAdjustment.isPending}
                                onClick={() => removeAdjustment.mutate(a.id)}
                              >
                                Remove
                              </Button>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}

              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
