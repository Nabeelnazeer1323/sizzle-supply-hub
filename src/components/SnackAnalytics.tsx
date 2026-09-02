import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { isPantryProduct } from "@/lib/category";
import { money } from "@/lib/snacks";
import { useSnackInventory } from "@/lib/snacks-data";
import { PRODUCT_COLUMNS, supabase, type Product } from "@/lib/supabase";
import { shiftDate } from "@/lib/week";
import type { AnalyticsPeriod } from "@/components/OrderAnalytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type SnackOrder = {
  ordered_at: string;
  transaction_type: string;
  location_id: string | null;
  locations: { name: string } | null;
  order_items: { quantity: number; product_id: string | null; unit_amount: number | null }[];
};

const unitsConfig = {
  units: { label: "Units sold", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

type Bucket = { name: string; units: number; revenue: number };

export function SnackAnalytics({
  period,
  anchorDate,
  fromYear,
  toYear,
  yearToDate,
}: {
  period: AnalyticsPeriod;
  anchorDate: string;
  fromYear: number;
  toYear: number;
  yearToDate: boolean;
}) {
  const range = useMemo(
    () => snackRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );

  const { lines, adjustments } = useSnackInventory();

  const productsQuery = useQuery({
    queryKey: ["snack-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select(PRODUCT_COLUMNS).order("name");
      if (error) throw error;
      return (data as unknown as Product[]).filter(isPantryProduct);
    },
  });

  const snackIds = useMemo(
    () => new Set((productsQuery.data ?? []).map((p) => p.id)),
    [productsQuery.data],
  );
  const nameById = useMemo(
    () => new Map((productsQuery.data ?? []).map((p) => [p.id, p.name])),
    [productsQuery.data],
  );

  const ordersQuery = useQuery({
    queryKey: ["snack-analytics", range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "ordered_at,transaction_type,location_id,locations(name),order_items(quantity,product_id,unit_amount)",
        )
        .eq("mapping_status", "MAPPED")
        .gte("ordered_at", `${range.start}T00:00:00Z`)
        .lt("ordered_at", `${range.end}T00:00:00Z`)
        .order("ordered_at", { ascending: true });
      if (error) throw error;
      return data as unknown as SnackOrder[];
    },
  });

  const orders = useMemo(
    () => (ordersQuery.data ?? []).filter((o) => o.transaction_type === "PAYMENT"),
    [ordersQuery.data],
  );

  const { bySnack, byLocation, totals } = useMemo(() => {
    const snacks = new Map<string, Bucket>();
    const locationsMap = new Map<string, Bucket>();
    let units = 0;
    let revenue = 0;
    for (const order of orders) {
      for (const item of order.order_items ?? []) {
        if (!item.product_id || !snackIds.has(item.product_id)) continue;
        const value = item.quantity * (item.unit_amount ?? 0);
        units += item.quantity;
        revenue += value;
        const snackName = nameById.get(item.product_id) ?? "Unknown snack";
        const snack = snacks.get(snackName) ?? { name: snackName, units: 0, revenue: 0 };
        snack.units += item.quantity;
        snack.revenue += value;
        snacks.set(snackName, snack);

        const locName = order.locations?.name ?? "Unknown location";
        const loc = locationsMap.get(locName) ?? { name: locName, units: 0, revenue: 0 };
        loc.units += item.quantity;
        loc.revenue += value;
        locationsMap.set(locName, loc);
      }
    }
    const sortUnits = (list: Bucket[]) => [...list].sort((a, b) => b.units - a.units);
    return {
      bySnack: sortUnits([...snacks.values()]),
      byLocation: sortUnits([...locationsMap.values()]),
      totals: { units, revenue },
    };
  }, [orders, snackIds, nameById]);

  /** Waste = manual write-offs plus what came back when a batch was closed. */
  const wasteUnits = useMemo(() => {
    const fromAdjustments = adjustments
      .filter(
        (a) =>
          a.quantity_delta < 0 &&
          a.occurred_on >= range.start &&
          a.occurred_on < range.end &&
          (a.reason === "EXPIRED" || a.reason === "DAMAGED"),
      )
      .reduce((sum, a) => sum + Math.abs(a.quantity_delta), 0);
    const fromBatches = batches
      .filter((b) => b.closed_on && b.closed_on >= range.start && b.closed_on < range.end)
      .reduce((sum, b) => sum + (b.closed_quantity ?? 0), 0);
    return fromAdjustments + fromBatches;
  }, [adjustments, batches, range.start, range.end]);


  const stockValue = lines.reduce((sum, line) => sum + line.value, 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Snack performance</h2>
        <p className="text-sm text-muted-foreground">{range.label}</p>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load snack sales</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Units sold" value={String(totals.units)} />
        <Stat label="Revenue" value={money.format(totals.revenue)} />
        <Stat label="Written off" value={String(wasteUnits)} warn={wasteUnits > 0} />
        <Stat label="Stock value now" value={money.format(stockValue)} />
      </div>

      <BucketCard title="Sales by snack" buckets={bySnack} />
      <BucketCard title="Sales by location" buckets={byLocation} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Slowest movers</CardTitle>
        </CardHeader>
        <CardContent>
          {bySnack.length ? (
            <ul className="divide-y divide-border text-sm">
              {[...bySnack]
                .sort((a, b) => a.units - b.units)
                .slice(0, 10)
                .map((bucket) => (
                  <li key={bucket.name} className="flex justify-between gap-3 py-2">
                    <span>{bucket.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {bucket.units} sold · {money.format(bucket.revenue)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No snack sales in this period.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function BucketCard({ title, buckets }: { title: string; buckets: Bucket[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {buckets.length ? (
          <>
            <ChartContainer config={unitsConfig} className="h-72 w-full">
              <BarChart data={buckets.slice(0, 12)} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="units" fill="var(--color-units)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <ul className="mt-3 divide-y divide-border text-sm">
              {buckets.map((bucket) => (
                <li key={bucket.name} className="flex justify-between gap-3 py-2">
                  <span>{bucket.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {bucket.units} sold · {money.format(bucket.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No snack sales in this period.
          </p>
        )}
      </CardContent>
    </Card>
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

function snackRange(
  period: AnalyticsPeriod,
  date: string,
  fromYear: number,
  toYear: number,
  yearToDate: boolean,
) {
  let startDate: string;
  let endDate: string;
  if (period === "day") {
    startDate = date;
    endDate = shiftDate(date, 1);
  } else if (period === "week") {
    const anchor = new Date(`${date}T00:00:00Z`);
    const weekday = anchor.getUTCDay() || 7;
    startDate = shiftDate(date, 1 - weekday);
    endDate = shiftDate(startDate, 7);
  } else if (period === "month") {
    startDate = `${date.slice(0, 7)}-01`;
    const nextMonth = new Date(`${startDate}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    endDate = nextMonth.toISOString().slice(0, 10);
  } else {
    startDate = `${fromYear}-01-01`;
    if (yearToDate) {
      const today = new Date();
      const monthDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      endDate = shiftDate(`${toYear}-${monthDay}`, 1);
    } else {
      endDate = `${toYear + 1}-01-01`;
    }
  }
  return { start: startDate, end: endDate, label: `${startDate} – ${shiftDate(endDate, -1)}` };
}
