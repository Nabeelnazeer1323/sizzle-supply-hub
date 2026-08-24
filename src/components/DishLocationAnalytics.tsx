import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { stockholmLocalToIso } from "@/lib/order-import";
import { supabase } from "@/lib/supabase";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DishOrder = {
  id: string;
  ordered_at: string;
  transaction_type: string;
  amount: number;
  locations: { name: string } | null;
  order_items: {
    quantity: number;
    products: { id: string; name: string } | null;
  }[];
};

const dishConfig = {
  units: { label: "Units sold", color: "var(--color-chart-3)" },
} satisfies ChartConfig;
const money = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });

export function DishLocationAnalytics({
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
    () => dishAnalyticsRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );

  const ordersQuery = useQuery({
    queryKey: ["dish-location-analytics", period, range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,ordered_at,transaction_type,amount,locations(name),order_items(quantity,products(id,name))",
        )
        .gte("ordered_at", range.start)
        .lt("ordered_at", range.end)
        .order("ordered_at", { ascending: true });
      if (error) throw error;
      return data as unknown as DishOrder[];
    },
  });

  const payments = useMemo(
    () => (ordersQuery.data ?? []).filter((order) => order.transaction_type === "PAYMENT"),
    [ordersQuery.data],
  );

  const dishes = useMemo(() => {
    const values = new Map<string, { name: string; units: number }>();
    for (const order of payments) {
      for (const item of order.order_items) {
        const name = item.products?.name ?? "Unknown product";
        const current = values.get(name) ?? { name, units: 0 };
        current.units += item.quantity;
        values.set(name, current);
      }
    }
    return [...values.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
  }, [payments]);

  const [selectedDish, setSelectedDish] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDish(null);
  }, [period, range.start, range.end]);

  const activeDish =
    selectedDish && dishes.some((dish) => dish.name === selectedDish)
      ? selectedDish
      : (dishes[0]?.name ?? null);

  const locationData = useMemo(() => {
    if (!activeDish) return [];
    const values = new Map<string, { name: string; units: number; sales: number }>();
    for (const order of payments) {
      const totalUnits = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
      const dishUnits = order.order_items
        .filter((item) => (item.products?.name ?? "Unknown product") === activeDish)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (!dishUnits) continue;
      const locationName = order.locations?.name ?? "Unmapped";
      const current = values.get(locationName) ?? { name: locationName, units: 0, sales: 0 };
      current.units += dishUnits;
      current.sales += totalUnits ? (Number(order.amount) * dishUnits) / totalUnits : 0;
      values.set(locationName, current);
    }
    return [...values.values()].sort((a, b) => b.units - a.units);
  }, [payments, activeDish]);

  const totalUnits = locationData.reduce((sum, location) => sum + location.units, 0);
  const totalSales = locationData.reduce((sum, location) => sum + location.sales, 0);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Dish by location</h2>
        <p className="text-sm text-muted-foreground">{range.label}</p>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load dish analytics</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Units sold per location</CardTitle>
          <Select
            value={activeDish ?? ""}
            onValueChange={setSelectedDish}
            disabled={dishes.length === 0}
          >
            <SelectTrigger className="h-11 w-full sm:max-w-sm" aria-label="Select dish">
              <SelectValue placeholder="No dishes sold in this period" />
            </SelectTrigger>
            <SelectContent>
              {dishes.map((dish) => (
                <SelectItem key={dish.name} value={dish.name}>
                  {dish.name} · {dish.units} units
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Units sold
              </p>
              <p className="text-xl font-semibold tabular-nums">{totalUnits}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sales</p>
              <p className="text-xl font-semibold tabular-nums">{money.format(totalSales)}</p>
            </div>
          </div>

          {locationData.length ? (
            <ChartContainer config={dishConfig} className="h-72 w-full">
              <BarChart data={locationData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="units" fill="var(--color-units)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="py-20 text-center text-sm text-muted-foreground">
              No sales in this period.
            </p>
          )}

          {locationData.length ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {locationData.map((location) => (
                <li key={location.name} className="flex justify-between gap-3 py-2">
                  <span>{location.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {location.units} units · {money.format(location.sales)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function dishAnalyticsRange(
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
