import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { supabase } from "@/lib/supabase";
import { shiftDate } from "@/lib/week";
import type { AnalyticsPeriod } from "@/components/OrderAnalytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ReturnsAllocation = {
  location_id: string;
  product_id: string;
  delivery_date: string;
  quantity_allocated: number | null;
  quantity_returned: number | null;
  returned_at: string | null;
  locations: { name: string } | null;
  products: { id: string; name: string } | null;
};

type Bucket = { name: string; delivered: number; returned: number; sold: number };

const sellConfig = {
  sold: { label: "Sold", color: "var(--color-chart-1)" },
  returned: { label: "Returned", color: "var(--color-chart-5)" },
} satisfies ChartConfig;

const dishConfig = {
  sold: { label: "Sold", color: "var(--color-chart-3)" },
  returned: { label: "Returned", color: "var(--color-chart-5)" },
} satisfies ChartConfig;

type SortMode = "sold" | "waste";

function wastePct(bucket: Bucket) {
  return bucket.delivered ? Math.round((bucket.returned / bucket.delivered) * 100) : 0;
}

function sortBuckets(buckets: Bucket[], mode: SortMode) {
  return [...buckets].sort((a, b) =>
    mode === "sold" ? b.sold - a.sold : wastePct(b) - wastePct(a) || b.returned - a.returned,
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bad" | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`text-xl font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function BucketSection({
  title,
  buckets,
  config,
  sort,
  onSortChange,
}: {
  title: string;
  buckets: Bucket[];
  config: ChartConfig;
  sort: SortMode;
  onSortChange: (mode: SortMode) => void;
}) {
  const sorted = sortBuckets(buckets, sort);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex gap-1">
          {(["sold", "waste"] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={sort === mode ? "default" : "outline"}
              onClick={() => onSortChange(mode)}
            >
              {mode === "sold" ? "Best sellers" : "Worst waste"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length ? (
          <>
            <ChartContainer config={config} className="h-72 w-full">
              <BarChart data={sorted.slice(0, 12)} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="sold" stackId="a" fill="var(--color-sold)" radius={[0, 0, 0, 0]} />
                <Bar
                  dataKey="returned"
                  stackId="a"
                  fill="var(--color-returned)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
            <ul className="mt-3 divide-y divide-border text-sm">
              {sorted.map((bucket) => (
                <li key={bucket.name} className="flex justify-between gap-3 py-2">
                  <span>{bucket.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {bucket.delivered} out · {bucket.returned} back ·{" "}
                    <span className={wastePct(bucket) > 15 ? "text-destructive" : ""}>
                      {wastePct(bucket)}% waste
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No deliveries in this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ReturnsAnalytics({
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
    () => returnsRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );

  const allocationsQuery = useQuery({
    queryKey: ["returns-analytics", period, range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select(
          "location_id,product_id,delivery_date,quantity_allocated,quantity_returned,returned_at,locations(name),products(id,name)",
        )
        .gte("delivery_date", range.start)
        .lt("delivery_date", range.end)
        .order("delivery_date", { ascending: true });
      if (error) throw error;
      return data as unknown as ReturnsAllocation[];
    },
  });

  const rows = useMemo(() => allocationsQuery.data ?? [], [allocationsQuery.data]);

  const totals = useMemo(() => {
    let delivered = 0;
    let returned = 0;
    let unlogged = 0;
    for (const row of rows) {
      delivered += row.quantity_allocated ?? 0;
      if (row.returned_at) returned += row.quantity_returned ?? 0;
      else unlogged += 1;
    }
    return { delivered, returned, sold: delivered - returned, unlogged };
  }, [rows]);

  const byDish = useMemo(() => aggregate(rows, (row) => row.products?.name ?? "Unknown dish"), [
    rows,
  ]);
  const byLocation = useMemo(
    () => aggregate(rows, (row) => row.locations?.name ?? "Unknown location"),
    [rows],
  );

  const [dishSort, setDishSort] = useState<SortMode>("sold");
  const [locationSort, setLocationSort] = useState<SortMode>("sold");
  const [selectedDish, setSelectedDish] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDish(null);
  }, [period, range.start, range.end]);

  const dishNames = useMemo(() => sortBuckets(byDish, "sold").map((b) => b.name), [byDish]);
  const activeDish =
    selectedDish && dishNames.includes(selectedDish) ? selectedDish : (dishNames[0] ?? null);

  const dishByLocation = useMemo(() => {
    if (!activeDish) return [];
    return aggregate(
      rows.filter((row) => (row.products?.name ?? "Unknown dish") === activeDish),
      (row) => row.locations?.name ?? "Unknown location",
    );
  }, [rows, activeDish]);

  const overallWaste = totals.delivered
    ? Math.round((totals.returned / totals.delivered) * 100)
    : 0;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Delivery performance</h2>
        <p className="text-sm text-muted-foreground">{range.label}</p>
      </div>

      {allocationsQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load returns analytics</AlertTitle>
          <AlertDescription>{allocationsQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Delivered" value={String(totals.delivered)} />
        <Stat label="Returned" value={String(totals.returned)} />
        <Stat label="Sold" value={String(totals.sold)} />
        <Stat
          label="Waste"
          value={`${overallWaste}%`}
          tone={overallWaste > 15 ? "bad" : undefined}
        />
        <Stat label="Not logged" value={String(totals.unlogged)} />
      </div>

      <BucketSection
        title="Sell-through by dish"
        buckets={byDish}
        config={sellConfig}
        sort={dishSort}
        onSortChange={setDishSort}
      />

      <BucketSection
        title="Sell-through by location"
        buckets={byLocation}
        config={sellConfig}
        sort={locationSort}
        onSortChange={setLocationSort}
      />

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Dish by location</CardTitle>
          <Select
            value={activeDish ?? ""}
            onValueChange={setSelectedDish}
            disabled={dishNames.length === 0}
          >
            <SelectTrigger className="h-11 w-full sm:max-w-sm" aria-label="Select dish">
              <SelectValue placeholder="No deliveries in this period" />
            </SelectTrigger>
            <SelectContent>
              {dishNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {dishByLocation.length ? (
            <>
              <ChartContainer config={dishConfig} className="h-72 w-full">
                <BarChart
                  data={sortBuckets(dishByLocation, "sold")}
                  margin={{ left: 0, right: 8 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="sold" stackId="a" fill="var(--color-sold)" />
                  <Bar
                    dataKey="returned"
                    stackId="a"
                    fill="var(--color-returned)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
              <ul className="mt-3 divide-y divide-border text-sm">
                {sortBuckets(dishByLocation, "sold").map((bucket) => (
                  <li key={bucket.name} className="flex justify-between gap-3 py-2">
                    <span>{bucket.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {bucket.delivered} out · {bucket.returned} back · {wastePct(bucket)}% waste
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="py-20 text-center text-sm text-muted-foreground">
              No deliveries in this period.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function aggregate(rows: ReturnsAllocation[], key: (row: ReturnsAllocation) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const name = key(row);
    const bucket = map.get(name) ?? { name, delivered: 0, returned: 0, sold: 0 };
    bucket.delivered += row.quantity_allocated ?? 0;
    if (row.returned_at) bucket.returned += row.quantity_returned ?? 0;
    bucket.sold = bucket.delivered - bucket.returned;
    map.set(name, bucket);
  }
  return [...map.values()];
}

function returnsRange(
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
  return {
    start: startDate,
    end: endDate,
    label: `${startDate} – ${shiftDate(endDate, -1)}`,
  };
}
