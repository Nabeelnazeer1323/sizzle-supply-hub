import { describe, expect, it } from "vitest";

import { buildStock, type SnackAdjustment, type SnackBatch } from "@/lib/snacks";

const base = {
  location_id: "loc",
  product_id: "keso",
  unit_cost: null,
  note: null,
  close_reason: null,
  closed_on: null,
  closed_quantity: null,
} satisfies Partial<SnackBatch>;

const oldBatch: SnackBatch = {
  ...base,
  id: "old",
  delivered_on: "2026-08-08",
  quantity: 3,
  best_before: "2026-08-29",
  closed_on: "2026-09-03",
  closed_quantity: 0,
  close_reason: "COLLECTED",
};

const newBatch: SnackBatch = {
  ...base,
  id: "new",
  delivered_on: "2026-09-03",
  quantity: 3,
  best_before: "2026-09-25",
};

function adjustment(over: Partial<SnackAdjustment>): SnackAdjustment {
  return {
    id: "adj",
    product_id: "keso",
    location_id: "loc",
    batch_id: null,
    occurred_on: "2026-09-02",
    quantity_delta: -3,
    reason: "EXPIRED",
    note: null,
    ...over,
  };
}

const today = "2026-09-03";

describe("buildStock adjustment attribution", () => {
  it("keeps a correction dated before a new delivery off that delivery", () => {
    const [line] = buildStock([oldBatch, newBatch], [], [adjustment({})], { today });
    expect(line!.onHand).toBe(3);
    expect(line!.batches.find((b) => b.id === "new")!.adjusted).toBe(0);
    expect(line!.batches.find((b) => b.id === "old")!.adjusted).toBe(-3);
  });

  it("does not double count a correction inside a closed batch's window", () => {
    const [line] = buildStock([oldBatch, newBatch], [], [adjustment({})], { today });
    expect(line!.batches.find((b) => b.id === "old")!.remaining).toBe(0);
    expect(line!.onHand).toBe(3);
  });

  it("honours an explicit batch_id", () => {
    const [line] = buildStock(
      [oldBatch, newBatch],
      [],
      [adjustment({ batch_id: "new", occurred_on: "2026-09-03", quantity_delta: -1 })],
      { today },
    );
    expect(line!.batches.find((b) => b.id === "new")!.remaining).toBe(2);
  });

  it("applies a correction dated inside the open batch's window to it", () => {
    const [line] = buildStock(
      [oldBatch, newBatch],
      [],
      [adjustment({ occurred_on: "2026-09-03", quantity_delta: -2 })],
      { today },
    );
    expect(line!.onHand).toBe(1);
  });

  it("never pushes a batch below zero", () => {
    const [line] = buildStock([newBatch], [], [adjustment({ occurred_on: "2026-09-03", quantity_delta: -9 })], {
      today,
    });
    expect(line!.onHand).toBe(0);
  });
});
