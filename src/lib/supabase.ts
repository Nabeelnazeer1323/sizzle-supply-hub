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
  "id,name,translated_name,week_number,delivery_day,is_vegan,is_vegetarian,is_snack,types,image_url";

export type Location = {
  id: string;
  name: string;
  vegan_target: number | null;
  delivery_days: string[] | null;
  is_active: boolean | null;
};

export type Product = {
  id: string;
  name: string;
  translated_name: string | null;
  week_number: number | null;
  delivery_day: string | null;
  is_vegan: boolean | null;
  is_vegetarian: boolean | null;
  is_snack: boolean | null;
  /** Product category tags, e.g. ["FOOD"], ["SNACK"], ["BREAKFAST"], ["DRINK"]. */
  types: string[] | null;
  image_url: string | null;
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
};
