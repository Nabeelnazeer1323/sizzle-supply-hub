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
  image_url: string | null;
};

export type ProductionRow = {
  id: string;
  product_id: string;
  production_date: string;
  week_number: number;
  year: number;
  quantity_produced: number;
};

export type RequirementRow = {
  id: string;
  location_id: string;
  delivery_date: string;
  week_number: number;
  year: number;
  total_required: number;
  is_snack: boolean | null;
};

export type AllocationRow = {
  id: string;
  location_id: string;
  product_id: string;
  delivery_date: string;
  week_number: number;
  year: number;
  quantity_allocated: number;
};

export type ReturnRow = {
  id: string;
  location_id: string;
  product_id: string;
  delivery_date: string;
  week_number: number;
  year: number;
  quantity_returned: number;
};
