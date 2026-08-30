import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";

import { supabase, type Product } from "@/lib/supabase";
import { categoryLabel, productCategory } from "@/lib/category";
import { useSnackInventory } from "@/lib/snacks-data";
import { money, stockKey, type SnackBatch } from "@/lib/snacks";
import { todayIso } from "@/lib/week";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LAST_LOCATION_KEY = "sizzle:last-snack-location";

type Line = {
  quantity: number;
  unit_cost: string;
  best_before: string;
};

export const Route = createFileRoute("/_authenticated/snacks_/restock")({
  head: () => ({
    meta: [
      { title: "Restock snacks — Sizzle Ops" },
      {
        name: "description",
        content: "Register a snack delivery with quantity, cost price and best-before date.",
      },
      { property: "og:title", content: "Restock snacks — Sizzle Ops" },
      {
        property: "og:description",
        content: "Add new snack stock to a location in seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RestockPage,
});

function RestockPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locations, products, batches, lines: stock, error } = useSnackInventory();

  const [locationId, setLocationId] = useState<string>("");
  const [deliveredOn, setDeliveredOn] = useState(todayIso());
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored && stored !== "all") setLocationId(stored);
  }, []);
  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const stockByKey = useMemo(() => new Map(stock.map((l) => [l.key, l])), [stock]);

  function lastBatchOf(productId: string): SnackBatch | undefined {
    return [...batches]
      .filter((b) => b.product_id === productId)
      .sort((a, b) => b.delivered_on.localeCompare(a.delivered_on))[0];
  }

  function defaultBestBefore(product: Product): string {
    const last = lastBatchOf(product.id);
    if (last?.best_before) return last.best_before;
    return product.due_date ?? "";
  }

  function defaultUnitCost(product: Product): string {
    const last = lastBatchOf(product.id);
    return last?.unit_cost != null ? String(last.unit_cost) : "";
  }

  function update(productId: string, patch: Partial<Line>) {
    setLines((prev) => {
      const base = prev[productId] ?? {
        quantity: 0,
        unit_cost: defaultUnitCost(products.find((p) => p.id === productId)!),
        best_before: defaultBestBefore(products.find((p) => p.id === productId)!),
      };
      return { ...prev, [productId]: { ...base, ...patch } };
    });
  }

  function ensureLine(productId: string): Line {
    if (!lines[productId]) {
      const product = products.find((p) => p.id === productId)!;
      return {
        quantity: 0,
        unit_cost: defaultUnitCost(product),
        best_before: defaultBestBefore(product),
      };
    }
    return lines[productId];
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (q ? p.name.toLowerCase().includes(q) : true));
  }, [products, query]);

  const { inStock, outOfStock } = useMemo(() => {
    const inStock: Product[] = [];
    const outOfStock: Product[] = [];
    for (const p of filtered) {
      const onHand = stockByKey.get(stockKey(locationId, p.id))?.onHand ?? 0;
      (onHand > 0 ? inStock : outOfStock).push(p);
    }
    return { inStock, outOfStock };
  }, [filtered, locationId, stockByKey]);

  const filled = useMemo(() => {
    return products
      .map((p) => ({ product: p, line: ensureLine(p.id) }))
      .filter(({ line }) => line.quantity > 0);
  }, [products, lines]);

  const totalUnits = filled.reduce((sum, { line }) => sum + line.quantity, 0);
  const totalCost = filled.reduce(
    (sum, { line }) => sum + line.quantity * (Number(line.unit_cost) || 0),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const rows = filled.map(({ product, line }) => ({
        product_id: product.id,
        location_id: locationId,
        delivered_on: deliveredOn,
        quantity: line.quantity,
        unit_cost: line.unit_cost === "" ? null : Number(line.unit_cost),
        best_before: line.best_before || product.due_date || null,
      }));
      const { error: insertError } = await supabase.from("snack_batches").insert(rows);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      window.localStorage.setItem(LAST_LOCATION_KEY, locationId);
      toast.success(`${totalUnits} units added to stock`);
      void queryClient.invalidateQueries({ queryKey: ["snack-batches"] });
      void navigate({ to: "/snacks" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function renderRow(product: Product) {
    const line = ensureLine(product.id);
    const current = stockByKey.get(stockKey(locationId, product.id));
    const onHand = current?.onHand ?? 0;
    const active = line.quantity > 0;

    return (
      <li
        key={product.id}
        className={`rounded-xl border p-3 transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-card"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{product.name}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {categoryLabel(productCategory(product))}
            </p>
            <p className="text-xs text-muted-foreground">
              {onHand > 0 ? (
                <>
                  {onHand} left{" "}
                  {active && (
                    <>
                      · becomes{" "}
                      <span className="font-semibold text-foreground">{onHand + line.quantity}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-destructive">none left</span>
              )}
            </p>
          </div>
          <QtyStepper
            value={line.quantity}
            min={0}
            onChange={(v) => update(product.id, { quantity: v })}
            ariaLabel={`Quantity for ${product.name}`}
          />
        </div>

        {active && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Cost per item
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-label={`Cost per item for ${product.name}`}
                className="mt-1.5 h-12 text-base"
                value={line.unit_cost}
                onChange={(e) => update(product.id, { unit_cost: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Best before
              <Input
                type="date"
                aria-label={`Best before for ${product.name}`}
                className="mt-1.5 h-12 text-base"
                value={line.best_before}
                onChange={(e) => update(product.id, { best_before: e.target.value })}
              />
            </label>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to inventory">
          <Link to="/snacks">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Restock snacks</h1>
          <p className="text-sm text-muted-foreground">
            Walk the shelf and enter every snack, drink and breakfast item at once.
          </p>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Snack tables missing</AlertTitle>
          <AlertDescription>
            {error.message} Run the snack SQL on the{" "}
            <Link className="underline" to="/setup">
              setup page
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Location
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="mt-1.5 h-12 w-full text-base" aria-label="Location">
              <SelectValue placeholder="Pick a location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Delivered on
          <Input
            type="date"
            aria-label="Delivery date"
            className="mt-1.5 h-12 text-base"
            value={deliveredOn}
            onChange={(e) => setDeliveredOn(e.target.value)}
          />
        </label>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Find a snack, drink or breakfast item…"
          className="h-12 pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="space-y-3">
        {inStock.map(renderRow)}
        {outOfStock.length > 0 && (
          <li className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Out of stock
            </p>
          </li>
        )}
        {outOfStock.map(renderRow)}
      </ul>

      <SaveBar
        summary={`${filled.length} lines · ${totalUnits} units · ${money.format(totalCost)}`}
        onSave={() => save.mutate()}
        saving={save.isPending}
        disabled={!locationId || filled.length === 0}
        label="Save delivery"
      />
    </div>
  );
}
