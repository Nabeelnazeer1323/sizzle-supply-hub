import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import { supabase, type OrderMappingStatus, type OrderTransactionType } from "@/lib/supabase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Orders — Sizzle Ops" },
      { name: "description", content: "Review imported orders and mapping status." },
    ],
  }),
  component: OrdersPage,
});

type OrderListRow = {
  id: string;
  payment_method: string;
  external_reference: string | null;
  transaction_type: OrderTransactionType;
  ordered_at: string;
  amount: number;
  currency: string;
  message: string;
  source_status: string | null;
  mapping_status: OrderMappingStatus;
  locations: { name: string } | null;
  order_items: {
    id: string;
    raw_product_numeric_id: number;
    quantity: number;
    products: { name: string; numeric_id: number | null } | null;
  }[];
};

const money = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
const dateTime = new Intl.DateTimeFormat("sv-SE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Stockholm",
});

function OrdersPage() {
  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,payment_method,external_reference,transaction_type,ordered_at,amount,currency,message,source_status,mapping_status,locations(name),order_items(id,raw_product_numeric_id,quantity,products(name,numeric_id))",
        )
        .order("ordered_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as unknown as OrderListRow[];
    },
  });

  const orders = ordersQuery.data ?? [];
  const mapped = orders.filter((order) => order.mapping_status === "MAPPED").length;
  const refunds = orders.filter((order) => order.transaction_type !== "PAYMENT").length;
  const net = orders.reduce((sum, order) => sum + Number(order.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Imported payments, refunds and transactions requiring mapping.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => ordersQuery.refetch()}
          disabled={ordersQuery.isFetching}
        >
          <RefreshCw className={`size-4 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load orders</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Orders" value={String(orders.length)} />
        <Stat label="Mapped" value={String(mapped)} />
        <Stat
          label="Unmapped"
          value={String(orders.length - mapped)}
          warn={orders.length > mapped}
        />
        <Stat label={`Net · ${refunds} refunds`} value={money.format(net)} />
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {dateTime.format(new Date(order.ordered_at))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={order.transaction_type === "PAYMENT" ? "secondary" : "outline"}>
                      {order.transaction_type}
                    </Badge>
                  </TableCell>
                  <TableCell>{order.locations?.name ?? "—"}</TableCell>
                  <TableCell className="min-w-56">
                    {order.order_items.length
                      ? order.order_items
                          .map((item) =>
                            item.products
                              ? `${item.quantity > 1 ? `${item.quantity}× ` : ""}${item.products.name}`
                              : `#${item.raw_product_numeric_id} (unknown)`,
                          )
                          .join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell className="min-w-48">{order.message}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {order.external_reference ?? "—"}
                  </TableCell>
                  <TableCell>
                    {order.mapping_status === "MAPPED" ? (
                      <Badge variant="secondary">
                        <CheckCircle2 className="size-3" /> Mapped
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <AlertCircle className="size-3" /> Unmapped
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                    {money.format(Number(order.amount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!ordersQuery.isPending && orders.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No orders have been imported yet.
            </p>
          ) : null}
          {ordersQuery.isPending ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Loading orders…</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
