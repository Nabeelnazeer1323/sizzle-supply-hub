import { shiftDate, todayIso } from "@/lib/week";

/** One delivery of one snack to one location. Expiry lives on the batch. */
export type SnackBatch = {
  id: string;
  product_id: string;
  location_id: string;
  delivered_on: string;
  quantity: number;
  unit_cost: number | null;
  best_before: string | null;
  note: string | null;
};

export const ADJUSTMENT_REASONS = ["EXPIRED", "DAMAGED", "RECOUNT", "TRANSFER", "OTHER"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export function reasonLabel(reason: string): string {
  switch (reason.toUpperCase()) {
    case "EXPIRED":
      return "Expired / thrown away";
    case "DAMAGED":
      return "Damaged or missing";
    case "RECOUNT":
      return "Count correction";
    case "TRANSFER":
      return "Moved to another location";
    default:
      return "Other";
  }
}

/**
 * Manual correction. `quantity_delta` is signed against stock:
 * negative removes units (waste), positive adds them back (recount up).
 */
export type SnackAdjustment = {
  id: string;
  product_id: string;
  location_id: string;
  batch_id: string | null;
  occurred_on: string;
  quantity_delta: number;
  reason: string;
  note: string | null;
};

/** A unit of a snack leaving the fridge because someone bought it. */
export type SnackSale = {
  product_id: string;
  location_id: string;
  ordered_at: string;
  quantity: number;
};

export type BatchState = SnackBatch & {
  /** Units of this batch still on the shelf, after FIFO consumption. */
  remaining: number;
  expired: boolean;
  daysLeft: number | null;
};

export type StockLine = {
  key: string;
  product_id: string;
  location_id: string;
  delivered: number;
  sold: number;
  adjusted: number;
  onHand: number;
  soldLast7: number;
  /** Average units sold per day over the last 7 days. */
  dailyRate: number;
  /** Days of cover at the recent rate, null when nothing is selling. */
  daysOfCover: number | null;
  value: number;
  earliestBestBefore: string | null;
  expiringUnits: number;
  expiredUnits: number;
  batches: BatchState[];
};

export function stockKey(locationId: string, productId: string) {
  return `${locationId}|${productId}`;
}

export function daysUntil(date: string, today = todayIso()): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

/**
 * Real-time stock: every delivery minus everything bought since it landed,
 * minus manual write-offs. Nothing is stored, so re-running an order import
 * can never double-count.
 */
export function buildStock(
  batches: SnackBatch[],
  sales: SnackSale[],
  adjustments: SnackAdjustment[],
  options: { today?: string; expiringWithinDays?: number } = {},
): StockLine[] {
  const today = options.today ?? todayIso();
  const expiringWithin = options.expiringWithinDays ?? 7;
  const weekAgo = shiftDate(today, -7);

  const lines = new Map<string, StockLine>();

  const ensure = (location_id: string, product_id: string): StockLine => {
    const key = stockKey(location_id, product_id);
    let line = lines.get(key);
    if (!line) {
      line = {
        key,
        product_id,
        location_id,
        delivered: 0,
        sold: 0,
        adjusted: 0,
        onHand: 0,
        soldLast7: 0,
        dailyRate: 0,
        daysOfCover: null,
        value: 0,
        earliestBestBefore: null,
        expiringUnits: 0,
        expiredUnits: 0,
        batches: [],
      };
      lines.set(key, line);
    }
    return line;
  };

  for (const batch of batches) {
    const line = ensure(batch.location_id, batch.product_id);
    line.delivered += batch.quantity;
    line.batches.push({ ...batch, remaining: batch.quantity, expired: false, daysLeft: null });
  }

  for (const sale of sales) {
    const key = stockKey(sale.location_id, sale.product_id);
    const line = lines.get(key);
    if (!line) continue;
    // Only count sales from the moment the first batch landed.
    const firstDelivery = line.batches
      .map((b) => b.delivered_on)
      .sort()[0];
    if (firstDelivery && sale.ordered_at.slice(0, 10) < firstDelivery) continue;
    line.sold += sale.quantity;
    if (sale.ordered_at.slice(0, 10) >= weekAgo) line.soldLast7 += sale.quantity;
  }

  for (const adjustment of adjustments) {
    const line = lines.get(stockKey(adjustment.location_id, adjustment.product_id));
    if (!line) continue;
    line.adjusted += adjustment.quantity_delta;
  }

  for (const line of lines.values()) {
    line.onHand = Math.max(0, line.delivered - line.sold + line.adjusted);

    // FIFO: the oldest batch is eaten first.
    line.batches.sort(
      (a, b) => a.delivered_on.localeCompare(b.delivered_on) || a.id.localeCompare(b.id),
    );
    let toConsume = line.delivered - line.onHand;
    for (const batch of line.batches) {
      const taken = Math.min(batch.quantity, Math.max(0, toConsume));
      batch.remaining = batch.quantity - taken;
      toConsume -= taken;
      if (batch.best_before) {
        batch.daysLeft = daysUntil(batch.best_before, today);
        batch.expired = batch.daysLeft < 0;
      }
      if (batch.remaining > 0 && batch.best_before) {
        if (batch.expired) line.expiredUnits += batch.remaining;
        else if (batch.daysLeft !== null && batch.daysLeft <= expiringWithin)
          line.expiringUnits += batch.remaining;
      }
    }

    const live = line.batches.filter((b) => b.remaining > 0);
    line.value = live.reduce((sum, b) => sum + b.remaining * (b.unit_cost ?? 0), 0);
    line.earliestBestBefore =
      live
        .map((b) => b.best_before)
        .filter((d): d is string => Boolean(d))
        .sort()[0] ?? null;

    line.dailyRate = line.soldLast7 / 7;
    line.daysOfCover = line.dailyRate > 0 ? line.onHand / line.dailyRate : null;
  }

  return [...lines.values()];
}

export type StockTone = "out" | "expired" | "expiring" | "low" | "ok";

export function stockTone(line: StockLine): StockTone {
  if (line.onHand <= 0) return "out";
  if (line.expiredUnits > 0) return "expired";
  if (line.expiringUnits > 0) return "expiring";
  if (line.daysOfCover !== null && line.daysOfCover < 7) return "low";
  return "ok";
}

export const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});
