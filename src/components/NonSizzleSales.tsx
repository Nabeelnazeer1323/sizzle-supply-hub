import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/lib/supabase";
import { dietAnalyticsRange } from "@/components/DietAnalytics";
import type { AnalyticsPeriod } from "@/components/OrderAnalytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

type NonSizzleOrder = {
  id: string;
  transaction_type: string;
  order_items: {
    quantity: number;
    products: { name: string; stocked_by_sizzle: boolean | null; price: number | null } | null;
  }[];
};

const sek = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

export function NonSizzleSales({
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
    queryKey: ["non-sizzle-sales", period, range.start, range.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,transaction_type,order_items(quantity,products(name,stocked_by_sizzle,price))",
        )
        .gte("ordered_at", range.start)
        .lt("ordered_at", range.end);
      if (error) throw error;
      return data as unknown as NonSizzleOrder[];
    },
  });

  const { nonSizzleUnits, totalUnits, amount } = useMemo(() => {
    let nonSizzle = 0;
    let total = 0;
    let sum = 0;
    for (const order of ordersQuery.data ?? []) {
      if (order.transaction_type !== "PAYMENT") continue;
      for (const item of order.order_items) {
        total += item.quantity;
        if (!item.products?.stocked_by_sizzle) {
          nonSizzle += item.quantity;
          sum += item.quantity * (item.products?.price ?? 0);
        }
      }
    }
    return { nonSizzleUnits: nonSizzle, totalUnits: total, amount: sum };
  }, [ordersQuery.data]);

  const share = totalUnits ? Math.round((nonSizzleUnits / totalUnits) * 100) : 0;

  return (
    <section className="space-y-2">
      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load non-Sizzle stocked sales</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Non Sizzle stocked
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {ordersQuery.isPending ? "…" : `${nonSizzleUnits} units`}
            </p>
            <p className="text-lg font-semibold tabular-nums text-muted-foreground">
              {ordersQuery.isPending ? "" : sek.format(amount)}
            </p>
          </div>
          <p className="text-right text-sm tabular-nums text-muted-foreground">
            {nonSizzleUnits} of {totalUnits} units
            <br />
            {share}% of all sales this period
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
