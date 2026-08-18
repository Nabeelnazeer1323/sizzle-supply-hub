import { createClient } from "@supabase/supabase-js";

// Sizzle's own Supabase project. The publishable key is safe in client code —
// all access is governed by row level security.
export const SUPABASE_URL = "https://bovopbgjrgjjratouilb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_6ByTKZacj1qA6yaTUaMG7w_VRFo2xUZ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const PRODUCT_COLUMNS =
  "id,numeric_id,name,translated_name,week_number,delivery_day,is_vegan,is_vegetarian,is_snack,types,image_url,storytel_delivery_days";

export type Location = {
  id: string;
  name: string;
  vegan_target: number | null;
  delivery_days: string[] | null;
  is_active: boolean | null;
};

export type Product = {
  id: string;
  numeric_id: number | null;
  name: string;
  translated_name: string | null;
  week_number: number | null;
  delivery_day: string | null;
  is_vegan: boolean | null;
  is_vegetarian: boolean | null;
  is_snack: boolean | null;
  /** Product category tags, e.g. ["FOOD"], ["SNACK"], ["BREAKFAST"], ["DRINK"]. */
  types: string[] | null;
  /** Weekdays this dish is part of Storytel's daily run. */
  storytel_delivery_days: string[] | null;
  image_url: string | null;
};

export type PaymentMethod = "SWISH_MANUAL" | "SWISH_API" | "STRIPE";
export type OrderTransactionType =
  "PAYMENT" | "REFUND" | "REFUND_CORRECTION" | "PAYOUT" | "UNKNOWN";
export type OrderMappingStatus = "MAPPED" | "UNMAPPED";

export type OrderRow = {
  id: string;
  user_id: string | null;
  payment_method: PaymentMethod;
  import_key: string;
  external_reference: string | null;
  transaction_type: OrderTransactionType;
  ordered_at: string;
  amount: number;
  currency: string;
  message: string;
  source_order_id: string | null;
  source_status: string | null;
  location_id: string | null;
  mapping_status: OrderMappingStatus;
  imported_at: string;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  raw_product_numeric_id: number;
  product_id: string | null;
  quantity: number;
  unit_amount: number | null;
  created_at: string;
};

/** Keyed by production_date — week/year are never written by this app. */
export type ProductionRow = {
  id: string;
  product_id: string;
  production_date: string;
  quantity_produced: number;
};

/** Keyed by delivery_date + category — week/year/is_snack are never written. */
export type RequirementRow = {
  id: string;
  location_id: string;
  delivery_date: string;
  total_required: number;
  category: string | null;
};

/** Keyed by delivery_date. quantity_returned is filled in by the returns flow. */
export type AllocationRow = {
  id: string;
  location_id: string;
  product_id: string;
  delivery_date: string;
  quantity_allocated: number;
  quantity_returned: number | null;
  /** Set when the driver logs the pickup — the real "counted" marker. */
  returned_at?: string | null;
};
