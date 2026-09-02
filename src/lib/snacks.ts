import { shiftDate, todayIso } from "@/lib/week";

/** Lifecycle of one delivery of one product to one location. */
export const BATCH_STATUSES = ["ACTIVE", "SOLD_OUT", "EXPIRED", "CLOSED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const CLOSE_REASONS = ["COLLECTED", "THROWN", "MOVED", "OTHER"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export function closeReasonLabel(reason: string | null): string {
  switch ((reason ?? "").toUpperCase()) {
    case "COLLECTED":
      return "Picked back up";
    case "THROWN":
      return "Thrown away";
    case "MOVED":
      return "Moved to another location";
    default:
      return "Closed";
  }
}

export function batchStatusLabel(status: BatchStatus): string {
  switch (status) {
    case "SOLD_OUT":
      return "Sold out";
    case "EXPIRED":
      return "Expired";
    case "CLOSED":
      return "Closed";
    default:
      return "On the shelf";
  }
}

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
  /** Set when the batch was picked back up / written off. */
  closed_on: string | null;
  /** Units taken back when the batch was closed. */
  closed_quantity: number | null;
  close_reason: string | null;
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
  status: BatchStatus;
  /** Units bought while this batch was the one on the shelf. */
  sold: number;
  /** Manual corrections attributed to this batch (signed). */
  adjusted: number;
  /** Units of this batch still on the shelf. Zero once closed. */
  remaining: number;
  expired: boolean;
  daysLeft: number | null;
  /** Last day sales count towards this batch (exclusive of the next delivery). */
  windowEnd: string | null;
};

export type StockStatus = "expired" | "out" | "expiring" | "low" | "ok";

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
  /** Units taken back off the shelf on closed batches. */
  wastedUnits: number;
  status: StockStatus;
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

type Options = { today?: string; expiringWithinDays?: number; lowCoverDays?: number };

/**
 * Stock, batch by batch. Sales at a location are cut into windows: a batch owns
 * every unit bought between its delivery and the next delivery (or the day it was
 * picked back up). Overflow spills into the next batch, so a late delivery never
 * rewrites the previous batch's history and a closed batch stops counting.
 */
export function buildStock(
  batches: SnackBatch[],
  sales: SnackSale[],
  adjustments: SnackAdjustment[],
  options: Options = {},
): StockLine[] {
  const today = options.today ?? todayIso();
  const expiringWithin = options.expiringWithinDays ?? 7;
  const lowCover = options.lowCoverDays ?? 7;
  const weekAgo = shiftDate(today, -7);

  const grouped = new Map<string, SnackBatch[]>();
  for (const batch of batches) {
    const key = stockKey(batch.location_id, batch.product_id);
    const list = grouped.get(key);
    if (list) list.push(batch);
    else grouped.set(key, [batch]);
  }

  const salesByKey = new Map<string, SnackSale[]>();
  for (const sale of sales) {
    const key = stockKey(sale.location_id, sale.product_id);
    const list = salesByKey.get(key);
    if (list) list.push(sale);
    else salesByKey.set(key, [sale]);
  }

  const adjustmentsByKey = new Map<string, SnackAdjustment[]>();
  for (const adjustment of adjustments) {
    const key = stockKey(adjustment.location_id, adjustment.product_id);
    const list = adjustmentsByKey.get(key);
    if (list) list.push(adjustment);
    else adjustmentsByKey.set(key, [adjustment]);
  }

  const lines: StockLine[] = [];

  for (const [key, rawBatches] of grouped) {
    const first = rawBatches[0]!;
    const ordered = [...rawBatches].sort(
      (a, b) => a.delivered_on.localeCompare(b.delivered_on) || a.id.localeCompare(b.id),
    );
    const keySales = (salesByKey.get(key) ?? []).slice().sort((a, b) =>
      a.ordered_at.localeCompare(b.ordered_at),
    );
    const keyAdjustments = adjustmentsByKey.get(key) ?? [];

    const states: BatchState[] = ordered.map((batch, index) => {
      const nextDelivery = ordered[index + 1]?.delivered_on ?? null;
      let windowEnd = nextDelivery;
      if (batch.closed_on && (!windowEnd || batch.closed_on < windowEnd)) {
        // Sales stop counting the day after the batch was taken back.
        windowEnd = shiftDate(batch.closed_on, 1);
      }
      return {
        ...batch,
        status: "ACTIVE",
        sold: 0,
        adjusted: 0,
        remaining: batch.quantity,
        expired: false,
        daysLeft: batch.best_before ? daysUntil(batch.best_before, today) : null,
        windowEnd,
      };
    });

    // Attribute sales to the batch that owned the shelf that day; anything the
    // batch cannot absorb spills forward to the next one.
    let spill = 0;
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index]!;
      const from = state.delivered_on;
      const to = state.windowEnd;
      let sold = spill;
      for (const sale of keySales) {
        const day = sale.ordered_at.slice(0, 10);
        if (day < from) continue;
        if (to && day >= to) continue;
        sold += sale.quantity;
      }
      const capacity = state.quantity;
      const taken = Math.max(0, Math.min(capacity, sold));
      spill = Math.max(0, sold - capacity);
      state.sold = taken;
    }

    // Adjustments: tied to a batch when possible, otherwise applied to the
    // oldest open batch first.
    const openStates = states.filter((s) => !s.closed_on);
    for (const adjustment of keyAdjustments) {
      const direct = adjustment.batch_id
        ? states.find((s) => s.id === adjustment.batch_id)
        : undefined;
      if (direct) {
        direct.adjusted += adjustment.quantity_delta;
        continue;
      }
      const target = openStates[openStates.length - 1] ?? states[states.length - 1];
      if (target) target.adjusted += adjustment.quantity_delta;
    }

    let delivered = 0;
    let sold = 0;
    let adjusted = 0;
    let onHand = 0;
    let value = 0;
    let expiringUnits = 0;
    let expiredUnits = 0;
    let wastedUnits = 0;
    let earliestBestBefore: string | null = null;

    for (const state of states) {
      delivered += state.quantity;
      sold += state.sold;
      adjusted += state.adjusted;
      state.expired = state.daysLeft !== null && state.daysLeft < 0;

      if (state.closed_on) {
        state.remaining = 0;
        state.status = "CLOSED";
        wastedUnits += state.closed_quantity ?? 0;
        continue;
      }

      state.remaining = Math.max(0, state.quantity - state.sold + state.adjusted);
      state.status = state.remaining <= 0 ? "SOLD_OUT" : state.expired ? "EXPIRED" : "ACTIVE";

      if (state.remaining > 0) {
        onHand += state.remaining;
        value += state.remaining * (state.unit_cost ?? 0);
        if (state.best_before) {
          if (state.expired) expiredUnits += state.remaining;
          else if (state.daysLeft !== null && state.daysLeft <= expiringWithin)
            expiringUnits += state.remaining;
          if (!earliestBestBefore || state.best_before < earliestBestBefore)
            earliestBestBefore = state.best_before;
        }
      }
    }

    let soldLast7 = 0;
    for (const sale of keySales) {
      if (sale.ordered_at.slice(0, 10) >= weekAgo) soldLast7 += sale.quantity;
    }
    const dailyRate = soldLast7 / 7;
    const daysOfCover = dailyRate > 0 ? onHand / dailyRate : null;

    const status: StockStatus =
      expiredUnits > 0
        ? "expired"
        : onHand <= 0
          ? "out"
          : expiringUnits > 0
            ? "expiring"
            : daysOfCover !== null && daysOfCover < lowCover
              ? "low"
              : "ok";

    lines.push({
      key,
      product_id: first.product_id,
      location_id: first.location_id,
      delivered,
      sold,
      adjusted,
      onHand,
      soldLast7,
      dailyRate,
      daysOfCover,
      value,
      earliestBestBefore,
      expiringUnits,
      expiredUnits,
      wastedUnits,
      status,
      batches: states,
    });
  }

  return lines;
}

export type StockTone = StockStatus;

export function stockTone(line: StockLine): StockTone {
  return line.status;
}

export const STATUS_ORDER: Record<StockStatus, number> = {
  expired: 0,
  out: 1,
  expiring: 2,
  low: 3,
  ok: 4,
};

export function statusLabel(status: StockStatus): string {
  switch (status) {
    case "expired":
      return "Expired";
    case "out":
      return "Sold out";
    case "expiring":
      return "Expiring soon";
    case "low":
      return "Running low";
    default:
      return "Fine";
  }
}

export const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});
