import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { analyticsRange, type AnalyticsPeriod } from "@/lib/analytics";
import { supabase, type Location } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type HeatmapOrder = {
  id: string;
  ordered_at: string;
  location_id: string | null;
  locations: { name: string } | null;
};

const STOCKHOLM_TIME_ZONE = "Europe/Stockholm";
const PAGE_SIZE = 500;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
] as const;
const weekdayIndex: ReadonlyMap<string, number> = new Map(
  WEEKDAYS.map((day, index) => [day.short, index]),
);
const stockholmWeekdayAndHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: STOCKHOLM_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});
const intensityClasses = [
  "bg-muted/50 text-muted-foreground",
  "bg-sizzle-orange/10 text-foreground",
  "bg-sizzle-orange/25 text-foreground",
  "bg-sizzle-orange/45 text-foreground",
  "bg-sizzle-orange/70 text-slate-950",
  "bg-sizzle-orange text-slate-950",
] as const;

export function PurchaseHeatmap({
  period,
  anchorDate,
  fromYear,
  toYear,
  yearToDate,
  locations,
}: {
  period: AnalyticsPeriod;
  anchorDate: string;
  fromYear: number;
  toYear: number;
  yearToDate: boolean;
  locations: Pick<Location, "id" | "name">[];
}) {
  const [selectedLocation, setSelectedLocation] = useState("all");
  const range = useMemo(
    () => analyticsRange(period, anchorDate, fromYear, toYear, yearToDate),
    [period, anchorDate, fromYear, toYear, yearToDate],
  );

  const ordersQuery = useQuery({
    queryKey: ["purchase-heatmap", range.start, range.end],
    queryFn: ({ signal }) => fetchPayments(range.start, range.end, signal),
  });

  const locationOptions = useMemo(() => {
    const names = new Map(locations.map((location) => [location.id, location.name]));
    for (const order of ordersQuery.data ?? []) {
      if (order.location_id && order.locations?.name) {
        names.set(order.location_id, order.locations.name);
      }
    }
    return [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locations, ordersQuery.data]);

  const activeLocation =
    selectedLocation === "all" ||
    locationOptions.some((location) => location.id === selectedLocation)
      ? selectedLocation
      : "all";

  useEffect(() => {
    if (activeLocation !== selectedLocation) setSelectedLocation(activeLocation);
  }, [activeLocation, selectedLocation]);

  const filteredOrders = useMemo(
    () =>
      (ordersQuery.data ?? []).filter(
        (order) => activeLocation === "all" || order.location_id === activeLocation,
      ),
    [activeLocation, ordersQuery.data],
  );

  const { cells, busiest, maximum, visibleHours } = useMemo(
    () => buildHeatmap(filteredOrders),
    [filteredOrders],
  );
  const selectedLocationName =
    activeLocation === "all"
      ? "All locations"
      : (locationOptions.find((location) => location.id === activeLocation)?.name ?? "Location");
  const unmappedCount =
    activeLocation === "all"
      ? filteredOrders.filter((order) => order.location_id === null).length
      : 0;
  const purchaseScope =
    activeLocation === "all" && unmappedCount > 0
      ? "across all locations, including unmapped payments"
      : activeLocation === "all"
        ? "across all locations"
        : `at ${selectedLocationName}`;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Purchase times</h2>
        <p className="text-sm text-muted-foreground">
          {range.label} · Stockholm time · payments only
        </p>
      </div>

      {ordersQuery.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load purchase times</AlertTitle>
          <AlertDescription>{ordersQuery.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Purchases by weekday and hour</CardTitle>
            <p className="text-sm text-muted-foreground">
              Stronger color shows when more purchases happen.
            </p>
          </div>
          <div className="w-full sm:max-w-xs">
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Location
            </label>
            <Select value={activeLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="h-11" aria-label="Filter purchase times by location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {locationOptions.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {ordersQuery.isPending ? (
            <div
              role="status"
              aria-busy="true"
              aria-live="polite"
              aria-label="Loading purchase times"
            >
              <Skeleton className="h-48 w-full" />
              <span className="sr-only">Loading purchase times…</span>
            </div>
          ) : ordersQuery.error ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              The purchase heatmap is unavailable until the data can be loaded.
            </p>
          ) : (
            <>
              <div
                aria-live="polite"
                className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3 text-sm"
              >
                <p>
                  <span className="font-semibold tabular-nums">{filteredOrders.length}</span>{" "}
                  {filteredOrders.length === 1 ? "purchase" : "purchases"} {purchaseScope}
                </p>
                <p className="text-muted-foreground">
                  {busiest
                    ? `Showing ${formatHour(visibleHours[0] ?? busiest.hour)}–${formatHour(visibleHours.at(-1) ?? busiest.hour)} · Busiest: ${WEEKDAYS[busiest.day]?.long} at ${formatHour(busiest.hour)} · ${busiest.count}`
                    : "No purchases in this period"}
                </p>
              </div>

              {visibleHours.length > 0 ? (
                <div
                  role="region"
                  aria-label={`Purchase heatmap from ${formatHour(visibleHours[0] ?? 0)} to ${formatHour(visibleHours.at(-1) ?? 0)}; scroll horizontally to see every weekday`}
                  tabIndex={0}
                  className="overflow-x-auto rounded-sm pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <table className="w-full min-w-[30rem] table-fixed border-separate border-spacing-1">
                    <caption className="sr-only">
                      Payment count by weekday and hour in the Europe/Stockholm time zone
                    </caption>
                    <thead className="sticky top-0 z-20 bg-card">
                      <tr>
                        <th
                          scope="col"
                          className="sticky left-0 z-10 w-14 bg-card pr-1 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          Time
                        </th>
                        {WEEKDAYS.map((day) => (
                          <th
                            key={day.short}
                            scope="col"
                            title={day.long}
                            className="pb-1 text-center text-xs font-medium text-muted-foreground"
                          >
                            {day.short}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHours.map((hour) => (
                        <tr key={hour}>
                          <th
                            scope="row"
                            className="sticky left-0 z-10 bg-card pr-1 text-right text-[11px] font-normal tabular-nums text-muted-foreground"
                          >
                            {formatHour(hour)}
                          </th>
                          {WEEKDAYS.map((day, dayIndex) => {
                            const count = cells[hour]?.[dayIndex] ?? 0;
                            const level = intensityLevel(count, maximum);
                            const description = `${day.long}, ${formatHour(hour)}–${formatHourEnd(hour)}: ${count} ${count === 1 ? "purchase" : "purchases"}`;
                            return (
                              <td
                                key={day.short}
                                aria-label={description}
                                title={description}
                                className="p-0"
                              >
                                <div
                                  className={cn(
                                    "flex h-6 items-center justify-center rounded-sm text-[10px] font-medium tabular-nums transition-colors sm:text-xs",
                                    intensityClasses[level],
                                  )}
                                >
                                  {count}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p role="status" className="py-16 text-center text-sm text-muted-foreground">
                  No purchase hours to display for this selection.
                </p>
              )}

              {visibleHours.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <p>
                    Each cell is one hour. Empty hours before the first purchase and after the last
                    are hidden; all times use Stockholm local time.
                    {unmappedCount > 0
                      ? ` The all-locations view includes ${unmappedCount} ${unmappedCount === 1 ? "payment" : "payments"} not mapped to a location.`
                      : ""}
                  </p>
                  <div
                    role="img"
                    className="flex items-center gap-1.5"
                    aria-label={`Heat scale from zero to ${maximum} purchases`}
                  >
                    <span>Fewer</span>
                    {intensityClasses.slice(1).map((className) => (
                      <span
                        key={className}
                        aria-hidden="true"
                        className={cn("h-3 w-5 rounded-sm", className.split(" ")[0])}
                      />
                    ))}
                    <span>More</span>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

async function fetchPayments(start: string, end: string, signal: AbortSignal) {
  const orders: HeatmapOrder[] = [];
  let from = 0;

  while (true) {
    const { data, error, count } = await supabase
      .from("orders")
      .select("id,ordered_at,location_id,locations(name)", { count: "exact" })
      .eq("transaction_type", "PAYMENT")
      .gte("ordered_at", start)
      .lt("ordered_at", end)
      .order("ordered_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) throw error;
    const page = data as unknown as HeatmapOrder[];
    orders.push(...page);
    if (count !== null && orders.length >= count) return orders;
    if (page.length === 0 || (count === null && page.length < PAGE_SIZE)) return orders;
    from += page.length;
  }
}

function buildHeatmap(orders: HeatmapOrder[]): {
  cells: number[][];
  busiest: { day: number; hour: number; count: number } | null;
  maximum: number;
  visibleHours: number[];
} {
  const cells = Array.from({ length: HOURS.length }, () => Array<number>(WEEKDAYS.length).fill(0));

  for (const order of orders) {
    const parts = Object.fromEntries(
      stockholmWeekdayAndHour
        .formatToParts(new Date(order.ordered_at))
        .map((part) => [part.type, part.value]),
    );
    const day = weekdayIndex.get(parts["weekday"] ?? "");
    const hour = Number(parts["hour"]);
    if (day === undefined || !Number.isInteger(hour) || hour < 0 || hour >= HOURS.length) continue;
    const row = cells[hour];
    if (row) row[day] = (row[day] ?? 0) + 1;
  }

  let busiest: { day: number; hour: number; count: number } | null = null;
  for (const hour of HOURS) {
    for (let day = 0; day < WEEKDAYS.length; day += 1) {
      const count = cells[hour]?.[day] ?? 0;
      if (!busiest || count > busiest.count) busiest = { day, hour, count };
    }
  }
  if (busiest?.count === 0) busiest = null;

  const firstHour = cells.findIndex((row) => row.some((count) => count > 0));
  let lastHour = -1;
  for (let hour = cells.length - 1; hour >= 0; hour -= 1) {
    if (cells[hour]?.some((count) => count > 0)) {
      lastHour = hour;
      break;
    }
  }

  return {
    cells,
    busiest,
    maximum: busiest?.count ?? 0,
    visibleHours: firstHour === -1 ? [] : HOURS.slice(firstHour, lastHour + 1),
  };
}

function intensityLevel(count: number, maximum: number) {
  if (count === 0 || maximum === 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil(Math.sqrt(count / maximum) * 5)));
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatHourEnd(hour: number) {
  return `${String(hour).padStart(2, "0")}:59`;
}
