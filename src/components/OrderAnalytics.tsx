import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { analyticsRange, type AnalyticsPeriod } from "@/lib/analytics";
import { supabase } from "@/lib/supabase";
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

export type { AnalyticsPeriod } from "@/lib/analytics";

type AnalyticsOrder = {
  id: string;
  ordered_at: string;
  transaction_type: "PAYMENT" | "REFUND" | "REFUND_CORRECTION" | "PAYOUT" | "UNKNOWN";
  amount: number;
  mapping_status: "MAPPED" | "UNMAPPED";
  locations: { name: string } | null;
  order_items: {
    quantity: number;
    products: { name: string; types: string[] | null; is_snack: boolean | null } | null;
  }[];
};

const locationConfig = {
  sales: { label: "Sales (SEK)", color: "var(--color-chart-1)" },
} satisfies ChartConfig;
const productConfig = {
  units: { label: "Units sold", color: "var(--color-chart-2)" },
} satisfies ChartConfig;
const categoryConfig = {
  food: { label: "Food", color: "var(--color-chart-1)" },
  snack: { label: "Snack", color: "var(--color-chart-2)" },
  breakfast: { label: "Breakfast", color: "var(--color-chart-4)" },
  drink: { label: "Drink", color: "var(--color-chart-5)" },
} satisfies ChartConfig;
const money = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
const ANALYTICS_PAGE_SIZE = 500;

export function YearToDateHighlights() {
  const currentYear = new Date().getFullYear();
  const range = analyticsRange("year", `${currentYear}-01-01`, currentYear, currentYear, true);
  const ordersQuery = useQuery({
    queryKey: ["order-analytics-orders", range.start, range.end],
    queryFn: ({ signal }) => fetchAnalyticsOrders(range.start, range.end, signal),
  });

  const payments = (ordersQuery.data ?? []).filter((order) => order.transaction_type === "PAYMENT");
  const highlights = calculateHighlights(payments);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Year to date</h2>
        <p className="text-sm text-muted-foreground">
          Highlights for {currentYear} · always January 1 through today
        </p>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load year-to-date highlights</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <HighlightsGrid {...highlights} />
    </section>
  );
}

export function OrderAnalytics({
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
    () => analyticsRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );
  const ordersQuery = useQuery({
    queryKey: ["order-analytics-orders", range.start, range.end],
    queryFn: ({ signal }) => fetchAnalyticsOrders(range.start, range.end, signal),
  });

  const orders = ordersQuery.data ?? [];
  const payments = orders.filter((order) => order.transaction_type === "PAYMENT");
  const refunds = orders.filter(
    (order) =>
      order.transaction_type === "REFUND" || order.transaction_type === "REFUND_CORRECTION",
  );
  const gross = payments.reduce((sum, order) => sum + Number(order.amount), 0);
  const refundAmount = refunds.reduce((sum, order) => sum + Number(order.amount), 0);
  const net = orders.reduce((sum, order) => sum + Number(order.amount), 0);
  const unmapped = orders.filter((order) => order.mapping_status === "UNMAPPED").length;

  const locationData = useMemo(() => {
    const values = new Map<string, { name: string; sales: number; orders: number }>();
    for (const order of payments) {
      const name = order.locations?.name ?? "Unmapped";
      const current = values.get(name) ?? { name, sales: 0, orders: 0 };
      current.sales += Number(order.amount);
      current.orders += 1;
      values.set(name, current);
    }
    return [...values.values()].sort((a, b) => b.sales - a.sales);
  }, [payments]);

  const productData = useMemo(() => {
    const values = new Map<string, number>();
    for (const order of payments) {
      for (const item of order.order_items) {
        const name = item.products?.name ?? "Unknown product";
        values.set(name, (values.get(name) ?? 0) + item.quantity);
      }
    }
    return [...values].map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units);
  }, [payments]);

  const categoryByLocationData = useMemo(() => {
    const values = new Map<
      string,
      { name: string; food: number; snack: number; breakfast: number; drink: number }
    >();
    for (const order of payments) {
      const name = order.locations?.name ?? "Unmapped";
      const current = values.get(name) ?? {
        name,
        food: 0,
        snack: 0,
        breakfast: 0,
        drink: 0,
      };
      for (const item of order.order_items) {
        const category = analyticsCategory(item.products);
        current[category] += item.quantity;
      }
      values.set(name, current);
    }
    return [...values.values()].sort(
      (a, b) =>
        b.food + b.snack + b.breakfast + b.drink - (a.food + a.snack + a.breakfast + a.drink),
    );
  }, [payments]);

  return (
    <section className="space-y-3">
      <div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sales analytics</h2>
          <p className="text-sm text-muted-foreground">{range.label}</p>
        </div>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load sales analytics</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <SalesStat label="Gross sales" value={money.format(gross)} />
        <SalesStat label="Refunds" value={money.format(refundAmount)} />
        <SalesStat label="Net sales" value={money.format(net)} />
        <SalesStat label="Payments" value={String(payments.length)} />
        <SalesStat label="Unmapped" value={String(unmapped)} warn={unmapped > 0} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales by location</CardTitle>
          </CardHeader>
          <CardContent>
            {locationData.length ? (
              <ChartContainer config={locationConfig} className="h-72 w-full">
                <BarChart data={locationData} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={48} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="sales" fill="var(--color-sales)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptySales />
            )}
            {locationData.length ? (
              <ul className="mt-3 divide-y divide-border text-sm">
                {locationData.map((location) => (
                  <li key={location.name} className="flex justify-between gap-3 py-2">
                    <span>{location.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {location.orders} orders · {money.format(location.sales)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Units sold by product</CardTitle>
          </CardHeader>
          <CardContent>
            {productData.length ? (
              <ChartContainer config={productConfig} className="h-72 w-full">
                <BarChart data={productData.slice(0, 10)} layout="vertical" margin={{ left: 12 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={110}
                    tickFormatter={(value: string) =>
                      value.length > 18 ? `${value.slice(0, 17)}…` : value
                    }
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="units" fill="var(--color-units)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptySales />
            )}
            {productData.length ? (
              <ul className="mt-3 max-h-72 divide-y divide-border overflow-auto text-sm">
                {productData.map((product) => (
                  <li key={product.name} className="flex justify-between gap-3 py-2">
                    <span>{product.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {product.units} units
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Units by location and type</CardTitle>
        </CardHeader>
        <CardContent>
          {categoryByLocationData.length ? (
            <ChartContainer config={categoryConfig} className="h-80 w-full">
              <BarChart data={categoryByLocationData} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="food" stackId="type" fill="var(--color-food)" />
                <Bar dataKey="snack" stackId="type" fill="var(--color-snack)" />
                <Bar dataKey="breakfast" stackId="type" fill="var(--color-breakfast)" />
                <Bar
                  dataKey="drink"
                  stackId="type"
                  fill="var(--color-drink)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptySales />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function calculateHighlights(payments: AnalyticsOrder[]) {
  const gross = payments.reduce((sum, order) => sum + Number(order.amount), 0);
  const products = new Map<string, number>();
  const locations = new Map<string, { name: string; sales: number; orders: number }>();
  const days = new Map<string, { sales: number; orders: number }>();
  const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  for (const order of payments) {
    const locationName = order.locations?.name ?? "Unmapped";
    const location = locations.get(locationName) ?? {
      name: locationName,
      sales: 0,
      orders: 0,
    };
    location.sales += Number(order.amount);
    location.orders += 1;
    locations.set(locationName, location);

    const date = stockholmDate.format(new Date(order.ordered_at));
    const day = days.get(date) ?? { sales: 0, orders: 0 };
    day.sales += Number(order.amount);
    day.orders += 1;
    days.set(date, day);

    for (const item of order.order_items) {
      const productName = item.products?.name ?? "Unknown product";
      products.set(productName, (products.get(productName) ?? 0) + item.quantity);
    }
  }

  const productData = [...products]
    .map(([name, units]) => ({ name, units }))
    .sort((a, b) => b.units - a.units);
  const topLocation = [...locations.values()].sort((a, b) => b.sales - a.sales)[0];
  const locationProducts = new Map<string, number>();
  if (topLocation) {
    for (const order of payments) {
      if ((order.locations?.name ?? "Unmapped") !== topLocation.name) continue;
      for (const item of order.order_items) {
        const name = item.products?.name ?? "Unknown product";
        locationProducts.set(name, (locationProducts.get(name) ?? 0) + item.quantity);
      }
    }
  }

  return {
    gross,
    totalUnits: productData.reduce((sum, product) => sum + product.units, 0),
    topProduct: productData[0],
    topLocation,
    topLocationProduct: [...locationProducts]
      .map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units)[0],
    bestSalesDay: [...days]
      .map(([date, value]) => ({ date, ...value }))
      .sort((a, b) => b.sales - a.sales)[0],
  };
}

function HighlightsGrid({
  gross,
  totalUnits,
  topProduct,
  topLocation,
  topLocationProduct,
  bestSalesDay,
}: ReturnType<typeof calculateHighlights>) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <HighlightCard title="Most sold dish">
        <HighlightValue>{topProduct?.name ?? "No sales yet"}</HighlightValue>
        <p className="text-sm text-muted-foreground">
          {topProduct
            ? `${topProduct.units} of ${totalUnits} units sold across all dishes`
            : "No units sold this year"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <HighlightMetric label="All dishes" value={`${totalUnits} units`} />
          <HighlightMetric label="Total sales" value={money.format(gross)} />
        </div>
      </HighlightCard>

      <HighlightCard title="Best performing location">
        <HighlightValue>{topLocation?.name ?? "No sales yet"}</HighlightValue>
        <p className="text-sm text-muted-foreground">
          {topLocation
            ? `${topLocation.orders} orders · ${money.format(topLocation.sales)}`
            : "No location sales this year"}
        </p>
        <div className="mt-4 border-t border-border pt-4">
          <HighlightMetric
            label="Most sold dish here"
            value={
              topLocationProduct
                ? `${topLocationProduct.name} · ${topLocationProduct.units} units`
                : "—"
            }
          />
        </div>
      </HighlightCard>

      <HighlightCard title="Best sales day">
        <HighlightValue>
          {bestSalesDay ? formatAnalyticsDate(bestSalesDay.date) : "No sales yet"}
        </HighlightValue>
        <p className="text-sm text-muted-foreground">Highest-grossing day this year</p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <HighlightMetric
            label="Sales"
            value={bestSalesDay ? money.format(bestSalesDay.sales) : money.format(0)}
          />
          <HighlightMetric label="Orders" value={String(bestSalesDay?.orders ?? 0)} />
        </div>
      </HighlightCard>
    </div>
  );
}

function HighlightCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function HighlightValue({ children }: { children: React.ReactNode }) {
  return <p className="truncate text-xl font-semibold tracking-tight">{children}</p>;
}

function HighlightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums" title={value}>
        {value}
      </p>
    </div>
  );
}

function formatAnalyticsDate(date: string) {
  return new Intl.DateTimeFormat("en-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function analyticsCategory(
  product: { types: string[] | null; is_snack: boolean | null } | null,
): "food" | "snack" | "breakfast" | "drink" {
  const types = product?.types?.map((type) => type.trim().toUpperCase()) ?? [];
  if (types.includes("DRINK")) return "drink";
  if (types.includes("BREAKFAST")) return "breakfast";
  if (types.includes("SNACK") || product?.is_snack) return "snack";
  return "food";
}

function SalesStat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function EmptySales() {
  return (
    <p className="py-20 text-center text-sm text-muted-foreground">No sales in this period.</p>
  );
}

async function fetchAnalyticsOrders(start: string, end: string, signal: AbortSignal) {
  const orders: AnalyticsOrder[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("orders")
      .select(
        "id,ordered_at,transaction_type,amount,mapping_status,locations(name),order_items(quantity,products(name,types,is_snack))",
        { count: "exact" },
      )
      .gte("ordered_at", start)
      .lt("ordered_at", end)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + ANALYTICS_PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) throw error;
    const page = data as unknown as AnalyticsOrder[];
    orders.push(...page);
    if (count !== null && orders.length >= count) return orders;
    if (page.length === 0 || (count === null && page.length < ANALYTICS_PAGE_SIZE)) return orders;
    from += page.length;
  }
}
