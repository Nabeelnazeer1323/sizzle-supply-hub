import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { isPantryProduct, PANTRY_CATEGORIES, productCategory } from "@/lib/category";
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

/** Every product, used to resolve names for batches whatever their category. */
export function useAllProducts() {
  return useQuery({
    queryKey: ["all-products-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .order("name");
      if (error) throw error;
      return data as unknown as Product[];
    },
  });
}

/** Every pantry product (snack, breakfast or drink), regardless of week. */
export function useSnackProducts() {
  const all = useAllProducts();
  const data = useMemo(() => {
    const list = (all.data ?? []).filter(isPantryProduct);
    return list.sort(
      (a, b) =>
        PANTRY_CATEGORIES.indexOf(productCategory(a) as never) -
          PANTRY_CATEGORIES.indexOf(productCategory(b) as never) ||
        a.name.localeCompare(b.name),
    );
  }, [all.data]);
  return { ...all, data };
}

export function useSnackBatches() {
  return useQuery({
    queryKey: ["snack-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("snack_batches")
        .select(
          "id,product_id,location_id,delivered_on,quantity,unit_cost,best_before,note,closed_on,closed_quantity,close_reason",
        )
        .order("delivered_on", { ascending: true });
      if (error) throw error;
      return (data as SnackBatch[]).map((b) => ({
        ...b,
        quantity: Number(b.quantity),
        unit_cost: b.unit_cost === null ? null : Number(b.unit_cost),
        closed_quantity: b.closed_quantity === null ? null : Number(b.closed_quantity),
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
  const allProductsQuery = useAllProducts();
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

  /** Names resolve across every product, so a batch never renders as "unknown". */
  const productById = useMemo(
    () => new Map((allProductsQuery.data ?? []).map((p) => [p.id, p])),
    [allProductsQuery.data],
  );

  return {
    locations: locationsQuery.data ?? [],
    products: productsQuery.data ?? [],
    allProducts: allProductsQuery.data ?? [],
    productById,
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
