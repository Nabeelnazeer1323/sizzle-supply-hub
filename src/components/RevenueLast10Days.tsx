import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { stockholmLocalToIso } from "@/lib/order-import";
import { shiftDate } from "@/lib/week";
import { supabase } from "@/lib/supabase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type RevenueOrder = {
  id: string;
  ordered_at: string;
  transaction_type: string;
  amount: number;
};

const sek = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

const stockholmDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  day: "numeric",
});

const revenueConfig = {
  revenue: { label: "Revenue", color: "var(--color-chart-1)" },
} satisfies ChartConfig;

export function RevenueLast10Days({ anchorDate }: { anchorDate: string }) {
  const days = useMemo(
    () => Array.from({ length: 10 }, (_, i) => shiftDate(anchorDate, i - 9)),
    [anchorDate],
  );
  const start = useMemo(() => stockholmLocalToIso(days[0], "00:00:00"), [days]);
  const end = useMemo(
    () => stockholmLocalToIso(shiftDate(anchorDate, 1), "00:00:00"),
    [anchorDate],
  );

  const ordersQuery = useQuery({
    queryKey: ["revenue-10-days", start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id,ordered_at,transaction_type,amount")
        .gte("ordered_at", start)
        .lt("ordered_at", end);
      if (error) throw error;
      return data as unknown as RevenueOrder[];
    },
  });

  const chartData = useMemo(() => {
    const byDay = new Map<string, number>(days.map((d) => [d, 0]));
    for (const order of ordersQuery.data ?? []) {
      const day = stockholmDate.format(new Date(order.ordered_at));
      const current = byDay.get(day);
      if (current === undefined) continue;
      const signed = order.transaction_type === "PAYMENT" ? order.amount : -order.amount;
      byDay.set(day, current + signed);
    }
    return days.map((d) => ({
      day: d,
      label: dayLabel.format(new Date(`${d}T12:00:00Z`)),
      revenue: Math.round(byDay.get(d) ?? 0),
    }));
  }, [days, ordersQuery.data]);

  const total = chartData.reduce((sum, d) => sum + d.revenue, 0);

  return (
    <section className="space-y-2">
      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load revenue</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle className="text-base">Revenue — last 10 days</CardTitle>
            <span className="text-lg font-semibold tabular-nums">
              {ordersQuery.isPending ? "…" : sek.format(total)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={revenueConfig} className="h-56 w-full">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => sek.format(Number(value))}
                    labelFormatter={(_label, payload) =>
                      payload?.[0]?.payload?.day ?? String(_label)
                    }
                  />
                }
              />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </section>
  );
}
