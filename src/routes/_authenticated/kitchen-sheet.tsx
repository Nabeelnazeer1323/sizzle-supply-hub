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


  function cell(productId: string, day: Weekday, locationId: string) {
    return perDay.get(day)?.cells[productId]?.[locationId] ?? 0;
  }

  /** Confirmed production for a dish on a delivery day, or null if not saved. */
  function productionFor(productId: string, day: Weekday): number | null {
    const date = weekDates.find((w) => w.day === day)?.date;
    const row = (productionQuery.data ?? []).find(
      (r) => r.product_id === productId && r.production_date === date,
    );
    return row ? row.quantity_produced : null;
  }

  /** Dish rows with per-day numbers; confirmed production always wins. */
  const totals = useMemo(
    () =>
      rows.map((r) => {
        const perDayTotals = r.days.map((d) => {
          const allotted = locations.reduce((s, l) => s + cell(r.product.id, d, l.id), 0);
          const produced = productionFor(r.product.id, d);
          return { day: d, allotted, produced, cook: produced ?? allotted };
        });
        const cook = perDayTotals.reduce((s, t) => s + t.cook, 0);
        return { ...r, perDayTotals, cook };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, locations, perDay, productionQuery.data, weekDates],
  );

  const grandTotal = totals.reduce((s, t) => s + t.cook, 0);

  const DAY_COLORS: Record<Weekday, { bg: string; text: string }> = {
    Monday: { bg: "#2563eb", text: "#ffffff" },
    Tuesday: { bg: "#16a34a", text: "#ffffff" },
    Wednesday: { bg: "#d97706", text: "#ffffff" },
    Thursday: { bg: "#9333ea", text: "#ffffff" },
    Friday: { bg: "#dc2626", text: "#ffffff" },
    Saturday: { bg: "#0891b2", text: "#ffffff" },
    Sunday: { bg: "#475569", text: "#ffffff" },
  };

  /** One card per (delivery day, location) that actually receives something. */
  const locationCards = useMemo(() => {
    const cards: {
      key: string;
      day: Weekday;
      location: Location;
      lines: { id: string; name: string; plant: boolean; qty: number }[];
      total: number;
    }[] = [];
    for (const d of WEEKDAYS) {
      for (const l of locations) {
        const lines = totals
          .filter((t) => t.days.includes(d))
          .map((t) => ({
            id: t.product.id,
            name: t.product.name,
            plant: isPlantBased(t.product),
            qty: cell(t.product.id, d, l.id),
          }))
          .filter((line) => line.qty > 0);
        if (lines.length === 0) continue;
        cards.push({
          key: `${d}-${l.id}`,
          day: d,
          location: l,
          lines,
          total: lines.reduce((s, line) => s + line.qty, 0),
        });
      }
    }
    return cards;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals, locations, perDay]);

  const coveredDays = Array.from(new Set(totals.flatMap((t) => t.days)));

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Kitchen sheet</h1>
        <p className="text-sm text-muted-foreground">
          Everything cooked on {cookDay} — including dishes delivered again later in the week — with
          the split per location. Fits one A4 page.
        </p>
      </div>

      <div className="print:hidden">
        <WeekBar year={year} week={week} day={cookDay} label="Cook week" />
      </div>

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
        <div className="kitchen-sheet rounded-lg border border-border bg-card p-5 print:rounded-none print:border-0 print:p-0">
          <header className="mb-4 flex items-end justify-between gap-4 border-b-2 border-foreground pb-2">
            <div>
              <h2 className="text-2xl font-bold leading-tight">Production — {formatDate(cookDate)}</h2>
              <p className="text-sm font-medium text-muted-foreground">
                Week {week} · delivered {coveredDays.join(" + ")}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Total portions
              </div>
              <div className="text-4xl font-black leading-none tabular-nums">{grandTotal}</div>
            </div>
          </header>

          <section className="mb-5">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Cook today</h3>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-muted">
                  <th className="border border-foreground/30 p-1.5 text-left font-bold">Dish</th>
                  <th className="border border-foreground/30 p-1.5 text-left font-bold">Type</th>
                  <th className="border border-foreground/30 p-1.5 text-left font-bold">
                    Delivery days
                  </th>
                  <th className="border border-foreground/30 p-1.5 text-right font-bold">Cook</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((t) => (
                  <tr key={t.product.id}>
                    <td className="border border-foreground/30 p-1.5 text-base font-semibold">
                      {t.product.name}
                    </td>
                    <td className="border border-foreground/30 p-1.5 font-medium">
                      {t.product.is_vegan
                        ? "Vegan"
                        : t.product.is_vegetarian
                          ? "Vegetarian"
                          : "Regular"}
                    </td>
                    <td className="border border-foreground/30 p-1.5">
                      {t.perDayTotals.map((d) => `${d.day.slice(0, 3)} ${d.cook}`).join(" · ")}
                    </td>
                    <td className="border border-foreground/30 p-1.5 text-right text-xl font-black tabular-nums">
                      {t.cook}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted">
                  <td className="border border-foreground/30 p-1.5 font-bold" colSpan={3}>
                    Total to cook
                  </td>
                  <td className="border border-foreground/30 p-1.5 text-right text-xl font-black tabular-nums">
                    {grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section>
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide">Delivery split</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 print:grid-cols-3">
              {locationCards.map((card) => (
                <div
                  key={card.key}
                  className="location-card break-inside-avoid rounded border border-foreground/40"
                >
                  <div
                    className="day-bar border-b border-foreground/30 px-2 py-1"
                    style={{
                      backgroundColor: DAY_COLORS[card.day]!.bg,
                      color: DAY_COLORS[card.day]!.text,
                    }}
                  >
                    <span className="text-[13px] font-black uppercase leading-tight tracking-wide">
                      {card.day.slice(0, 3)}
                    </span>
                  </div>
                  <div className="border-b border-foreground/30 px-2 py-1">
                    <span className="text-[13px] font-bold leading-tight">
                      {card.location.name}
                    </span>
                  </div>
                  <table className="w-full border-collapse text-[12px]">
                    <tbody>
                      {card.lines.map((line) => (
                        <tr key={line.id} className="border-b border-foreground/15">
                          <td className="px-2 py-1 leading-tight">
                            {line.name}
                            {line.plant && (
                              <span className="ml-1 text-[9px] font-bold uppercase text-muted-foreground">
                                pb
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right text-base font-bold tabular-nums">
                            {line.qty}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="px-2 py-1 font-semibold">Total</td>
                        <td className="px-2 py-1 text-right text-base font-black tabular-nums">
                          {card.total}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>

          <p className="mt-3 text-[10px] text-muted-foreground">
            Dishes delivered on more than one day are cooked in full today; each card shows what
            leaves the kitchen for that location on that delivery day.
          </p>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { background: #fff; }
          nav, header.app-header, .print\\:hidden { display: none !important; }
          .kitchen-sheet { font-size: 11px; }
          .kitchen-sheet table { page-break-inside: auto; }
          .kitchen-sheet tr { page-break-inside: avoid; }
          .location-card { break-inside: avoid; page-break-inside: avoid; }
          .day-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
