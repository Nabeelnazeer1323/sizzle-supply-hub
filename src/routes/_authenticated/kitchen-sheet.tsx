import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Printer } from "lucide-react";

import {
  supabase,
  PRODUCT_COLUMNS,
  type AllocationRow,
  type Location,
  type Product,
  type ProductionRow,
  type RequirementRow,
} from "@/lib/supabase";
import { WEEKDAYS, currentWeek, formatDate, isoWeekDate, type Weekday } from "@/lib/week";
import { DEFAULT_CATEGORY, productCategory } from "@/lib/category";
import { deliveryDaysOf, isPlantBased, productsForDay, servesOn } from "@/lib/serving";
import { suggestForDay } from "@/lib/suggest";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/kitchen-sheet")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const now = currentWeek();
    return {
      year: Number(search['year']) || now.year,
      week: Number(search['week']) || now.week,
      day: typeof search['day'] === "string" ? search['day'] : "Monday",
    };
  },
  head: () => ({
    meta: [
      { title: "Kitchen sheet — Sizzle Ops" },
      {
        name: "description",
        content:
          "One printable A4 sheet with what the kitchen cooks today and how each dish splits across locations and delivery days.",
      },
      { property: "og:title", content: "Kitchen sheet — Sizzle Ops" },
      {
        property: "og:description",
        content: "Printable cook-and-split sheet for the day's production.",
      },
    ],
  }),
  component: KitchenSheetPage,
});

function KitchenSheetPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const cookDay = normalizeDay(rawDay);
  const cookDate = isoWeekDate(year, week, cookDay);

  const weekDates = useMemo(
    () => WEEKDAYS.map((d) => ({ day: d, date: isoWeekDate(year, week, d) })),
    [year, week],
  );
  const rangeStart = weekDates[0]!.date;
  const rangeEnd = weekDates[weekDates.length - 1]!.date;

  const productsQuery = useQuery({
    queryKey: ["products-week", week],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("week_number", week)
        .order("name");
      if (error) throw error;
      return data as unknown as Product[];
    },
  });

  const locationsQuery = useQuery({
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

  const requirementsQuery = useQuery({
    queryKey: ["requirements-week", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("requirements")
        .select("*")
        .gte("delivery_date", rangeStart)
        .lte("delivery_date", rangeEnd);
      if (error) throw error;
      return data as RequirementRow[];
    },
  });

  const productionQuery = useQuery({
    queryKey: ["production-week", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production")
        .select("*")
        .gte("production_date", rangeStart)
        .lte("production_date", rangeEnd);
      if (error) throw error;
      return data as ProductionRow[];
    },
  });

  const allocationsQuery = useQuery({
    queryKey: ["allocations-week", rangeStart, rangeEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .gte("delivery_date", rangeStart)
        .lte("delivery_date", rangeEnd);
      if (error) throw error;
      return data as AllocationRow[];
    },
  });

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const allProducts = useMemo(
    () => (productsQuery.data ?? []).filter((p) => productCategory(p) === DEFAULT_CATEGORY),
    [productsQuery.data],
  );

  /** Per weekday: the numbers we show — saved allocations, else the suggestion. */
  const perDay = useMemo(() => {
    const map = new Map<
      Weekday,
      { date: string; cells: Record<string, Record<string, number>> }
    >();
    for (const { day, date } of weekDates) {
      const dayProducts = productsForDay(allProducts, locations, day);
      const dayLocations = locations.map((l) => ({
        ...l,
        required:
          (requirementsQuery.data ?? []).find(
            (r) => r.location_id === l.id && r.delivery_date === date,
          )?.total_required ?? 0,
      }));
      const suggestion = suggestForDay({ products: dayProducts, locations: dayLocations, weekday: day });

      const saved = (allocationsQuery.data ?? []).filter((a) => a.delivery_date === date);
      const cells: Record<string, Record<string, number>> = {};
      for (const p of dayProducts) {
        cells[p.id] = {};
        const savedRows = saved.filter((a) => a.product_id === p.id);
        for (const l of dayLocations) {
          if (!servesOn(p, l, day)) continue;
          const row = savedRows.find((a) => a.location_id === l.id);
          cells[p.id]![l.id] =
            row?.quantity_allocated ?? (savedRows.length > 0 ? 0 : suggestion.cells[p.id]?.[l.id] ?? 0);
        }
      }
      map.set(day, { date, cells });
    }
    return map;
  }, [weekDates, allProducts, locations, requirementsQuery.data, allocationsQuery.data]);

  /**
   * Dishes cooked today: everything whose first delivery day of the week is
   * the selected day. Multi-day dishes (Storytel Mon+Tue) are cooked once, so
   * they show up on their first day only, with both days on the sheet.
   */
  const rows = useMemo(() => {
    return allProducts
      .map((p) => {
        const days = deliveryDaysOf(p, locations, WEEKDAYS) as Weekday[];
        return { product: p, days };
      })
      .filter((r) => r.days.length > 0 && r.days[0] === cookDay);
  }, [allProducts, locations, cookDay]);

  /** Columns: every (delivery day, location) pair used by the dishes shown. */
  const columns = useMemo(() => {
    const list: { day: Weekday; location: Location; key: string }[] = [];
    for (const d of WEEKDAYS) {
      for (const l of locations) {
        const used = rows.some(
          (r) => r.days.includes(d) && (perDay.get(d)?.cells[r.product.id]?.[l.id] ?? 0) > 0,
        );
        if (used) list.push({ day: d, location: l, key: `${d}-${l.id}` });
      }
    }
    return list;
  }, [rows, locations, perDay]);

  function cell(productId: string, day: Weekday, locationId: string) {
    return perDay.get(day)?.cells[productId]?.[locationId] ?? 0;
  }

  function productionFor(productId: string, day: Weekday) {
    const date = weekDates.find((w) => w.day === day)?.date;
    return (
      (productionQuery.data ?? []).find(
        (r) => r.product_id === productId && r.production_date === date,
      )?.quantity_produced ?? 0
    );
  }

  const dayGroups = useMemo(() => {
    const groups: { day: Weekday; span: number }[] = [];
    for (const c of columns) {
      const last = groups[groups.length - 1];
      if (last && last.day === c.day) last.span += 1;
      else groups.push({ day: c.day, span: 1 });
    }
    return groups;
  }, [columns]);

  const totals = rows.map((r) => {
    const perDayTotals = r.days.map((d) => ({
      day: d,
      allotted: columns
        .filter((c) => c.day === d)
        .reduce((s, c) => s + cell(r.product.id, d, c.location.id), 0),
      produced: productionFor(r.product.id, d),
    }));
    const cook = perDayTotals.reduce((s, t) => s + Math.max(t.allotted, t.produced), 0);
    return { ...r, perDayTotals, cook };
  });

  const grandTotal = totals.reduce((s, t) => s + t.cook, 0);

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Kitchen sheet</h1>
        <p className="text-sm text-muted-foreground">
          Everything cooked on {cookDay} — including dishes delivered again later in the week — with
          the split per location. Fits one A4 page.
        </p>
      </div>

      <WeekBar year={year} week={week} day={cookDay} label="Cook week" />

      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print sheet
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing to cook on {cookDay}, week {week}.
          </CardContent>
        </Card>
      ) : (
        <div className="kitchen-sheet rounded-lg border border-border bg-card p-4 print:rounded-none print:border-0 print:p-0">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Production — {formatDate(cookDate)}</h2>
              <p className="text-xs text-muted-foreground">
                Week {week} · delivered{" "}
                {Array.from(new Set(totals.flatMap((t) => t.days))).join(", ")}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total portions
              </div>
              <div className="text-2xl font-bold tabular-nums">{grandTotal}</div>
            </div>
          </div>

          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="border border-border p-1 text-left align-bottom font-semibold"
                  >
                    Dish
                  </th>
                  {dayGroups.map((g) => (
                    <th
                      key={g.day}
                      colSpan={g.span}
                      className="border border-border bg-muted p-1 text-center font-semibold"
                    >
                      {g.day}
                    </th>
                  ))}
                  <th
                    rowSpan={2}
                    className="border border-border p-1 text-center align-bottom font-semibold"
                  >
                    COOK
                  </th>
                </tr>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="border border-border p-1 text-center font-medium">
                      {c.location.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.product.id}>
                    <td className="border border-border p-1">
                      <span className="font-medium">{t.product.name}</span>
                      {isPlantBased(t.product) && (
                        <span className="ml-1 rounded bg-primary/15 px-1 text-[9px] font-semibold uppercase text-primary">
                          {t.product.is_vegan ? "Vegan" : "Veg"}
                        </span>
                      )}
                    </td>
                    {columns.map((c) => {
                      const v = cell(t.product.id, c.day, c.location.id);
                      return (
                        <td
                          key={c.key}
                          className="border border-border p-1 text-center tabular-nums"
                        >
                          {v > 0 ? v : "·"}
                        </td>
                      );
                    })}
                    <td className="border border-border bg-muted p-1 text-center text-sm font-bold tabular-nums">
                      {t.cook}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="border border-border p-1 font-semibold">Total</td>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="border border-border p-1 text-center font-semibold tabular-nums"
                    >
                      {totals.reduce((s, t) => s + cell(t.product.id, c.day, c.location.id), 0)}
                    </td>
                  ))}
                  <td className="border border-border bg-muted p-1 text-center text-sm font-bold tabular-nums">
                    {grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-2 text-[10px] text-muted-foreground">
            Dishes delivered on more than one day are cooked in full today; the per-day columns show
            what leaves the kitchen on each delivery.
          </p>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .kitchen-sheet { font-size: 10px; }
          .kitchen-sheet table { page-break-inside: auto; }
          .kitchen-sheet tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
