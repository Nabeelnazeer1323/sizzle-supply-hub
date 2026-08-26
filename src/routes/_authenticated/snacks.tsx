import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, PackagePlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useSnackInventory } from "@/lib/snacks-data";
import { money, reasonLabel, stockTone, type StockLine } from "@/lib/snacks";
import { formatDate, todayIso } from "@/lib/week";
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
          "Live snack stock per location, with best-before warnings and stock value at cost.",
      },
      { property: "og:title", content: "Snack inventory — Sizzle Ops" },
      {
        property: "og:description",
        content: "What is left in every fridge, what is selling and what is about to expire.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SnacksPage,
});

const TONE_CLASS: Record<string, string> = {
  out: "border-destructive/60",
  expired: "border-destructive/60",
  expiring: "border-amber-500/60",
  low: "border-amber-500/40",
  ok: "border-border",
};

function ToneBadge({ line }: { line: StockLine }) {
  const tone = stockTone(line);
  if (tone === "out") return <Badge variant="destructive">Out of stock</Badge>;
  if (tone === "expired")
    return <Badge variant="destructive">{line.expiredUnits} expired</Badge>;
  if (tone === "expiring")
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        {line.expiringUnits} expiring
      </Badge>
    );
  if (tone === "low")
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        Running low
      </Badge>
    );
  return null;
}

function SnacksPage() {
  const queryClient = useQueryClient();
  const { locations, products, lines, adjustments, isPending, error } = useSnackInventory();

  const [locationId, setLocationId] = useState<string>("all");
  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored) setLocationId(stored);
  }, []);

  function pickLocation(id: string) {
    setLocationId(id);
    window.localStorage.setItem(LAST_LOCATION_KEY, id);
  }

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  const visible = useMemo(
    () =>
      lines
        .filter((line) => locationId === "all" || line.location_id === locationId)
        .sort((a, b) => {
          const order = { out: 0, expired: 1, expiring: 2, low: 3, ok: 4 } as const;
          const diff = order[stockTone(a)] - order[stockTone(b)];
          if (diff !== 0) return diff;
          return (productById.get(a.product_id)?.name ?? "").localeCompare(
            productById.get(b.product_id)?.name ?? "",
          );
        }),
    [lines, locationId, productById],
  );

  const totals = useMemo(() => {
    let value = 0;
    let out = 0;
    let expiring = 0;
    let sold7 = 0;
    for (const line of visible) {
      value += line.value;
      if (line.onHand <= 0) out += 1;
      expiring += line.expiringUnits + line.expiredUnits;
      sold7 += line.soldLast7;
    }
    return { value, out, expiring, sold7 };
  }, [visible]);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const openLine = visible.find((l) => l.key === openKey) ?? null;

  const adjust = useMutation({
    mutationFn: async (input: {
      line: StockLine;
      delta: number;
      reason: string;
      batchId?: string | null;
    }) => {
      const { error: insertError } = await supabase.from("snack_adjustments").insert({
        product_id: input.line.product_id,
        location_id: input.line.location_id,
        batch_id: input.batchId ?? null,
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

  const [recount, setRecount] = useState<number>(0);
  useEffect(() => {
    if (openLine) setRecount(openLine.onHand);
  }, [openKey, openLine?.onHand]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Snack inventory</h1>
          <p className="text-sm text-muted-foreground">
            Live stock: delivered minus sold, updated whenever orders are refreshed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/snacks/report">
              <BarChart3 className="size-4" /> Report
            </Link>
          </Button>
          <Button asChild>
            <Link to="/snacks/restock">
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
            {error.message.toLowerCase().includes("snack_") ? (
              <>
                {" "}
                Run the snack SQL on the <Link className="underline" to="/setup">setup page</Link>{" "}
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
        <Stat label="Stock value" value={money.format(totals.value)} />
        <Stat label="Out of stock" value={String(totals.out)} warn={totals.out > 0} />
        <Stat label="Expiring units" value={String(totals.expiring)} warn={totals.expiring > 0} />
        <Stat label="Sold last 7 days" value={String(totals.sold7)} />
      </div>

      {isPending ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading inventory…</p>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No snacks delivered here yet. Use Restock to add the first delivery.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((line) => {
            const product = productById.get(line.product_id);
            const location = locationById.get(line.location_id);
            return (
              <li key={line.key}>
                <button
                  type="button"
                  onClick={() => setOpenKey(line.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent ${TONE_CLASS[stockTone(line)]}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{product?.name ?? "Unknown snack"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {location?.name ?? "Unknown location"}
                      {line.earliestBestBefore
                        ? ` · best before ${formatDate(line.earliestBestBefore)}`
                        : ""}
                      {line.daysOfCover !== null
                        ? ` · ~${Math.floor(line.daysOfCover)}d cover`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{line.onHand}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {line.soldLast7} sold/7d
                    </p>
                  </div>
                  <ToneBadge line={line} />
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
                  {productById.get(openLine.product_id)?.name ?? "Snack"} ·{" "}
                  {locationById.get(openLine.location_id)?.name ?? ""}
                </SheetTitle>
                <SheetDescription>
                  {openLine.delivered} delivered · {openLine.sold} sold ·{" "}
                  {openLine.adjusted !== 0 ? `${openLine.adjusted} adjusted · ` : ""}
                  {openLine.onHand} on hand · {money.format(openLine.value)} at cost
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 px-4 pb-8">
                <div>
                  <h3 className="mb-2 text-sm font-medium">Batches</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {openLine.batches.map((batch) => (
                      <li key={batch.id} className="flex items-center gap-3 p-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{formatDate(batch.delivered_on)}</p>
                          <p className="text-xs text-muted-foreground">
                            {batch.quantity} in ·{" "}
                            {batch.unit_cost !== null
                              ? `${money.format(batch.unit_cost)} each`
                              : "no cost"}
                            {batch.best_before
                              ? ` · best before ${formatDate(batch.best_before)}`
                              : ""}
                          </p>
                        </div>
                        {batch.expired && batch.remaining > 0 ? (
                          <AlertTriangle className="size-4 text-destructive" />
                        ) : null}
                        <span className="tabular-nums font-semibold">{batch.remaining}</span>
                        {batch.expired && batch.remaining > 0 ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={adjust.isPending}
                            onClick={() =>
                              adjust.mutate({
                                line: openLine,
                                delta: -batch.remaining,
                                reason: "EXPIRED",
                                batchId: batch.id,
                              })
                            }
                          >
                            Write off
                          </Button>
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

                {adjustments.filter(
                  (a) =>
                    a.product_id === openLine.product_id &&
                    a.location_id === openLine.location_id,
                ).length ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Adjustments</h3>
                    <ul className="divide-y divide-border text-sm">
                      {adjustments
                        .filter(
                          (a) =>
                            a.product_id === openLine.product_id &&
                            a.location_id === openLine.location_id,
                        )
                        .slice(0, 10)
                        .map((a) => (
                          <li key={a.id} className="flex justify-between gap-3 py-2">
                            <span>
                              {formatDate(a.occurred_on)} · {reasonLabel(a.reason)}
                            </span>
                            <span className="tabular-nums text-muted-foreground">
                              {a.quantity_delta > 0 ? "+" : ""}
                              {a.quantity_delta}
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

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
