import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { productCategory } from "@/lib/category";
import { buildStock, type SnackAdjustment, type SnackBatch, type SnackSale } from "@/lib/snacks";
import { PRODUCT_COLUMNS, supabase, type Location, type Product } from "@/lib/supabase";

export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,vegan_target,delivery_days,is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });
}

/** Every product tagged as a snack, regardless of week. */
export function useSnackProducts() {
  return useQuery({
    queryKey: ["snack-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .order("name");
      if (error) throw error;
      return (data as unknown as Product[]).filter((p) => productCategory(p) === "SNACK");
    },
  });
}

export function useSnackBatches() {
  return useQuery({
    queryKey: ["snack-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snack_batches")
        .select("id,product_id,location_id,delivered_on,quantity,unit_cost,best_before,note")
        .order("delivered_on", { ascending: true });
      if (error) throw error;
      return (data as SnackBatch[]).map((b) => ({
        ...b,
        quantity: Number(b.quantity),
        unit_cost: b.unit_cost === null ? null : Number(b.unit_cost),
      }));
    },
  });
}

export function useSnackAdjustments() {
  return useQuery({
    queryKey: ["snack-adjustments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snack_adjustments")
        .select("id,product_id,location_id,batch_id,occurred_on,quantity_delta,reason,note")
        .order("occurred_on", { ascending: false });
      if (error) throw error;
      return data as SnackAdjustment[];
    },
  });
}

type SaleOrder = {
  ordered_at: string;
  transaction_type: string;
  location_id: string | null;
  order_items: { quantity: number; product_id: string | null }[];
};

/** Snack units bought, from mapped orders only. Refunds put stock back. */
export function useSnackSales(since: string | null) {
  return useQuery({
    queryKey: ["snack-sales", since],
    enabled: Boolean(since),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("ordered_at,transaction_type,location_id,order_items(quantity,product_id)")
        .eq("mapping_status", "MAPPED")
        .not("location_id", "is", null)
        .gte("ordered_at", `${since}T00:00:00Z`)
        .order("ordered_at", { ascending: true })
        .limit(5000);
      if (error) throw error;
      const sales: SnackSale[] = [];
      for (const order of (data ?? []) as unknown as SaleOrder[]) {
        if (!order.location_id) continue;
        const sign = order.transaction_type === "PAYMENT" ? 1 : -1;
        for (const item of order.order_items ?? []) {
          if (!item.product_id) continue;
          sales.push({
            product_id: item.product_id,
            location_id: order.location_id,
            ordered_at: order.ordered_at,
            quantity: sign * item.quantity,
          });
        }
      }
      return sales;
    },
  });
}

/** Everything the inventory screens need, wired together. */
export function useSnackInventory() {
  const locationsQuery = useLocations();
  const productsQuery = useSnackProducts();
  const batchesQuery = useSnackBatches();
  const adjustmentsQuery = useSnackAdjustments();

  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const since = batches.length ? batches.map((b) => b.delivered_on).sort()[0]! : null;
  const salesQuery = useSnackSales(since);

  const lines = useMemo(
    () => buildStock(batches, salesQuery.data ?? [], adjustmentsQuery.data ?? []),
    [batches, salesQuery.data, adjustmentsQuery.data],
  );

  return {
    locations: locationsQuery.data ?? [],
    products: productsQuery.data ?? [],
    batches,
    adjustments: adjustmentsQuery.data ?? [],
    lines,
    isPending:
      locationsQuery.isPending ||
      productsQuery.isPending ||
      batchesQuery.isPending ||
      (Boolean(since) && salesQuery.isPending),
    error:
      locationsQuery.error ??
      productsQuery.error ??
      batchesQuery.error ??
      adjustmentsQuery.error ??
      salesQuery.error ??
      null,
  };
}
