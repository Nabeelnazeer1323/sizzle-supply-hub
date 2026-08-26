import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/lib/supabase";
import { useSnackInventory } from "@/lib/snacks-data";
import { money, stockKey } from "@/lib/snacks";
import { todayIso } from "@/lib/week";
import { QtyStepper } from "@/components/QtyStepper";
import { SaveBar } from "@/components/SaveBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const LAST_LOCATION_KEY = "sizzle:last-snack-location";

type Line = {
  uid: string;
  product_id: string;
  quantity: number;
  unit_cost: string;
  best_before: string;
};

function newLine(): Line {
  return {
    uid: Math.random().toString(36).slice(2),
    product_id: "",
    quantity: 1,
    unit_cost: "",
    best_before: "",
  };
}

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
  const [lines, setLines] = useState<Line[]>([newLine()]);

  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_LOCATION_KEY);
    if (stored && stored !== "all") setLocationId(stored);
  }, []);
  useEffect(() => {
    if (!locationId && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const stockByKey = useMemo(() => new Map(stock.map((l) => [l.key, l])), [stock]);

  /** Cost and best-before default to the last delivery of the same snack. */
  function lastBatchOf(productId: string) {
    return [...batches]
      .filter((b) => b.product_id === productId)
      .sort((a, b) => b.delivered_on.localeCompare(a.delivered_on))[0];
  }

  function update(uid: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function pickProduct(uid: string, productId: string) {
    const last = lastBatchOf(productId);
    update(uid, {
      product_id: productId,
      unit_cost: last?.unit_cost != null ? String(last.unit_cost) : "",
    });
  }

  const filled = lines.filter((l) => l.product_id && l.quantity > 0);
  const totalUnits = filled.reduce((sum, l) => sum + l.quantity, 0);
  const totalCost = filled.reduce((sum, l) => sum + l.quantity * (Number(l.unit_cost) || 0), 0);

  const save = useMutation({
    mutationFn: async () => {
      const rows = filled.map((l) => ({
        product_id: l.product_id,
        location_id: locationId,
        delivered_on: deliveredOn,
        quantity: l.quantity,
        unit_cost: l.unit_cost === "" ? null : Number(l.unit_cost),
        best_before: l.best_before || null,
      }));
      const { error: insertError } = await supabase.from("snack_batches").insert(rows);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast.success(`${totalUnits} units added to stock`);
      void queryClient.invalidateQueries({ queryKey: ["snack-batches"] });
      void navigate({ to: "/snacks" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            Adds to whatever is already left at the location.
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

      <ul className="space-y-3">
        {lines.map((line) => {
          const current = stockByKey.get(stockKey(locationId, line.product_id));
          const onHand = current?.onHand ?? 0;
          return (
            <li key={line.uid}>
              <Card>
                <CardContent className="space-y-3 p-3">
                  <div className="flex items-start gap-2">
                    <Select
                      value={line.product_id}
                      onValueChange={(v) => pickProduct(line.uid, v)}
                    >
                      <SelectTrigger className="h-12 flex-1 text-base" aria-label="Snack">
                        <SelectValue placeholder="Pick a snack" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove line"
                      className="size-12"
                      onClick={() =>
                        setLines((prev) =>
                          prev.length > 1
                            ? prev.filter((l) => l.uid !== line.uid)
                            : [newLine()],
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <QtyStepper
                      value={line.quantity}
                      min={1}
                      onChange={(v) => update(line.uid, { quantity: v })}
                      ariaLabel="Quantity"
                    />
                    {line.product_id ? (
                      <p className="text-xs text-muted-foreground">
                        {onHand} left · becomes{" "}
                        <span className="font-semibold text-foreground">
                          {onHand + line.quantity}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Cost per item
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        aria-label="Cost per item"
                        className="mt-1.5 h-12 text-base"
                        value={line.unit_cost}
                        onChange={(e) => update(line.uid, { unit_cost: e.target.value })}
                      />
                    </label>
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Best before
                      <Input
                        type="date"
                        aria-label="Best before"
                        className="mt-1.5 h-12 text-base"
                        value={line.best_before}
                        onChange={(e) => update(line.uid, { best_before: e.target.value })}
                      />
                    </label>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button
        variant="outline"
        className="h-12 w-full"
        onClick={() => setLines((prev) => [...prev, newLine()])}
      >
        <Plus className="size-4" /> Add another snack
      </Button>

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
