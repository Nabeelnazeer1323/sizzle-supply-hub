import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { stockholmLocalToIso } from "@/lib/order-import";
import { supabase } from "@/lib/supabase";
import { shiftDate } from "@/lib/week";
import type { AnalyticsPeriod } from "@/components/OrderAnalytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type DietOrder = {
  id: string;
  ordered_at: string;
  transaction_type: string;
  amount: number;
  locations: { name: string } | null;
  order_items: {
    quantity: number;
    products: { name: string; is_vegan: boolean | null; is_vegetarian: boolean | null } | null;
  }[];
};

type Diet = "vegan" | "vegetarian" | "meat";

const dietConfig = {
  vegan: { label: "Vegan", color: "var(--color-chart-2)" },
  vegetarian: { label: "Vegetarian", color: "var(--color-chart-4)" },
  meat: { label: "Meat", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

function dietOf(product: DietOrder["order_items"][number]["products"]): Diet {
  if (product?.is_vegan) return "vegan";
  if (product?.is_vegetarian) return "vegetarian";
  return "meat";
}

export function DietAnalytics({
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
    () => dietAnalyticsRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );

  const ordersQuery = useQuery({
    queryKey: ["diet-analytics", period, range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,ordered_at,transaction_type,amount,locations(name),order_items(quantity,products(name,is_vegan,is_vegetarian))",
        )
        .gte("ordered_at", range.start)
        .lt("ordered_at", range.end)
        .order("ordered_at", { ascending: true });
      if (error) throw error;
      return data as unknown as DietOrder[];
    },
  });

  const payments = useMemo(
    () => (ordersQuery.data ?? []).filter((order) => order.transaction_type === "PAYMENT"),
    [ordersQuery.data],
  );

  const locationData = useMemo(() => {
    const values = new Map<
      string,
      { name: string; vegan: number; vegetarian: number; meat: number }
    >();
    for (const order of payments) {
      const name = order.locations?.name ?? "Unmapped";
      const current = values.get(name) ?? { name, vegan: 0, vegetarian: 0, meat: 0 };
      for (const item of order.order_items) {
        current[dietOf(item.products)] += item.quantity;
      }
      values.set(name, current);
    }
    return [...values.values()]
      .filter((row) => row.vegan + row.vegetarian + row.meat > 0)
      .sort(
        (a, b) => b.vegan + b.vegetarian + b.meat - (a.vegan + a.vegetarian + a.meat),
      );
  }, [payments]);

  const totals = useMemo(() => {
    const sum = { vegan: 0, vegetarian: 0, meat: 0 };
    for (const row of locationData) {
      sum.vegan += row.vegan;
      sum.vegetarian += row.vegetarian;
      sum.meat += row.meat;
    }
    return sum;
  }, [locationData]);

  const totalUnits = totals.vegan + totals.vegetarian + totals.meat;
  const share = (value: number) =>
    totalUnits ? `${Math.round((value / totalUnits) * 100)}%` : "0%";
  const totalRow = [{ name: "All locations", ...totals }];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Diet mix</h2>
        <p className="text-sm text-muted-foreground">{range.label}</p>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load diet analytics</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <DietStat label="Vegan" units={totals.vegan} share={share(totals.vegan)} />
        <DietStat label="Vegetarian" units={totals.vegetarian} share={share(totals.vegetarian)} />
        <DietStat label="Meat" units={totals.meat} share={share(totals.meat)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total split</CardTitle>
          </CardHeader>
          <CardContent>
            {totalUnits ? (
              <ChartContainer config={dietConfig} className="h-72 w-full">
                <BarChart data={totalRow} layout="vertical" margin={{ left: 12, right: 8 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={90}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="vegan" stackId="diet" fill="var(--color-vegan)" />
                  <Bar dataKey="vegetarian" stackId="diet" fill="var(--color-vegetarian)" />
                  <Bar
                    dataKey="meat"
                    stackId="diet"
                    fill="var(--color-meat)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                No sales in this period.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Diet mix by location</CardTitle>
          </CardHeader>
          <CardContent>
            {locationData.length ? (
              <ChartContainer config={dietConfig} className="h-72 w-full">
                <BarChart data={locationData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="vegan" stackId="diet" fill="var(--color-vegan)" />
                  <Bar dataKey="vegetarian" stackId="diet" fill="var(--color-vegetarian)" />
                  <Bar
                    dataKey="meat"
                    stackId="diet"
                    fill="var(--color-meat)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="py-20 text-center text-sm text-muted-foreground">
                No sales in this period.
              </p>
            )}

            {locationData.length ? (
              <ul className="mt-3 divide-y divide-border text-sm">
                {locationData.map((location) => {
                  const total = location.vegan + location.vegetarian + location.meat;
                  const plant = location.vegan + location.vegetarian;
                  return (
                    <li key={location.name} className="flex justify-between gap-3 py-2">
                      <span>{location.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {location.vegan} vegan · {location.vegetarian} veg · {location.meat} meat ·{" "}
                        {total ? Math.round((plant / total) * 100) : 0}% plant-based
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function DietStat({ label, units, share }: { label: string; units: number; share: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{units}</p>
      <p className="text-xs text-muted-foreground">{share} of units</p>
    </div>
  );
}

export function dietAnalyticsRange(
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
    start: stockholmLocalToIso(startDate, "00:00:00"),
    end: stockholmLocalToIso(endDate, "00:00:00"),
    label: `${startDate} – ${shiftDate(endDate, -1)}`,
  };
}
