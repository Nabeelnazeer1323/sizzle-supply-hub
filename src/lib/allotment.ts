/**
 * Distribute `total` whole units across weights using the largest-remainder
 * method so the parts always sum exactly to `total`.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return new Array(n).fill(0);
  if (sum <= 0) {
    // No demand signal — spread evenly.
    const base = Math.floor(total / n);
    const out = new Array(n).fill(base);
    let rest = total - base * n;
    for (let i = 0; rest > 0; i = (i + 1) % n, rest--) out[i] += 1;
    return out;
  }
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let remaining = total - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k = (k + 1) % n, remaining--) {
    out[order[k]!.i] = (out[order[k]!.i] ?? 0) + 1;
  }
  return out;
}

export type AllotInput = {
  products: { id: string; isVegan: boolean; produced: number }[];
  locations: { id: string; required: number; veganPct: number }[];
};

export type AllotResult = {
  /** cells[productId][locationId] = quantity */
  cells: Record<string, Record<string, number>>;
  needs: Record<string, { vegan: number; nonVegan: number; total: number }>;
};

/**
 * Proportional (pro-rata) allotment with a soft vegan target: vegan products
 * are shared out against each location's vegan need, non-vegan products
 * against the rest. Shortfalls are reported, never blocked.
 */
export function computeAllotment({ products, locations }: AllotInput): AllotResult {
  const needs: AllotResult["needs"] = {};
  for (const loc of locations) {
    const vegan = Math.round((loc.required * clampPct(loc.veganPct)) / 100);
    needs[loc.id] = { vegan, nonVegan: Math.max(0, loc.required - vegan), total: loc.required };
  }

  const cells: AllotResult["cells"] = {};
  for (const product of products) {
    const weights = locations.map((loc) => {
      const need = needs[loc.id]!;
      const w = product.isVegan ? need.vegan : need.nonVegan;
      // Soft target: if a category has no demand at all, fall back to total
      // requirement so production still gets placed somewhere.
      return w;
    });
    const anyWeight = weights.some((w) => w > 0);
    const finalWeights = anyWeight ? weights : locations.map((l) => l.required);
    const parts = largestRemainder(product.produced, finalWeights);
    cells[product.id] = {};
    locations.forEach((loc, i) => {
      cells[product.id]![loc.id] = parts[i] ?? 0;
    });
  }

  return { cells, needs };
}

export function clampPct(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function locationTotals(
  cells: Record<string, Record<string, number>>,
  products: { id: string; isVegan: boolean }[],
  locationId: string,
) {
  let vegan = 0;
  let nonVegan = 0;
  for (const p of products) {
    const q = cells[p.id]?.[locationId] ?? 0;
    if (p.isVegan) vegan += q;
    else nonVegan += q;
  }
  return { vegan, nonVegan, total: vegan + nonVegan };
}
