import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { currentWeek, isoWeekDate } from "@/lib/week";
import { WeekBar, normalizeDay } from "@/components/WeekBar";
import { ReturnsAnalytics } from "@/components/ReturnsAnalytics";
import type { AnalyticsPeriod } from "@/components/OrderAnalytics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type Search = { year: number; week: number; day: string };

export const Route = createFileRoute("/_authenticated/returns-dashboard")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const now = currentWeek();
    return {
      year: Number(search["year"]) || now.year,
      week: Number(search["week"]) || now.week,
      day: typeof search["day"] === "string" ? search["day"] : "Monday",
    };
  },
  head: () => ({
    meta: [
      { title: "Returns dashboard — Sizzle Ops" },
      {
        name: "description",
        content:
          "Dish and location performance based on what was delivered and what came back unsold.",
      },
      { property: "og:title", content: "Returns dashboard — Sizzle Ops" },
      {
        property: "og:description",
        content: "Sell-through and waste per dish and per location, from delivery records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReturnsDashboardPage,
});

function ReturnsDashboardPage() {
  const { year, week, day: rawDay } = Route.useSearch();
  const day = normalizeDay(rawDay);
  const date = isoWeekDate(year, week, day);

  const [period, setPeriod] = useState<AnalyticsPeriod>("week");
  const [anchorDate, setAnchorDate] = useState(date);
  const [fromYear, setFromYear] = useState(year);
  const [toYear, setToYear] = useState(year);
  const [yearToDate, setYearToDate] = useState(true);
  const activeDate = period === "day" || period === "week" ? date : anchorDate;

  function changePeriod(next: AnalyticsPeriod) {
    if (next === "month") setAnchorDate(date);
    if (next === "year") {
      setFromYear(year);
      setToYear(year);
    }
    setPeriod(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Returns dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Performance of dishes and locations from delivered and returned quantities.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["day", "week", "month", "year"] as const).map((value) => (
              <Button
                key={value}
                className="h-11"
                variant={period === value ? "default" : "outline"}
                onClick={() => changePeriod(value)}
              >
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </div>

          {period === "month" ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Month
              </label>
              <Input
                type="month"
                aria-label="Returns analytics month"
                className="h-12 w-full text-base sm:max-w-sm"
                value={anchorDate.slice(0, 7)}
                onChange={(event) => {
                  if (event.target.value) setAnchorDate(`${event.target.value}-01`);
                }}
              />
            </div>
          ) : null}

          {period === "year" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  From year
                  <Input
                    type="number"
                    aria-label="From year"
                    className="mt-1.5 h-12 text-base"
                    min="2000"
                    max={toYear}
                    value={fromYear}
                    onChange={(event) => setFromYear(Number(event.target.value))}
                  />
                </label>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  To year
                  <Input
                    type="number"
                    aria-label="To year"
                    className="mt-1.5 h-12 text-base"
                    min={fromYear}
                    max="2100"
                    value={toYear}
                    onChange={(event) => setToYear(Number(event.target.value))}
                  />
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={yearToDate}
                  onCheckedChange={(checked) => setYearToDate(checked === true)}
                />
                Year to date
              </label>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <WeekBar
        year={year}
        week={week}
        day={day}
        showDay={period === "day"}
        label={period === "day" ? "Day" : "Week"}
        disabled={period === "month" || period === "year"}
      />

      <ReturnsAnalytics
        period={period}
        anchorDate={activeDate}
        fromYear={fromYear}
        toYear={toYear}
        yearToDate={yearToDate}
      />
    </div>
  );
}
