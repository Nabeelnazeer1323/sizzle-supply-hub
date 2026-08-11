import { useNavigate } from "@tanstack/react-router";

import { WEEKDAYS, type Weekday, formatDate, isoWeekDate, weeksInYear } from "@/lib/week";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type WeekSearch = { year: number; week: number; day: string };

export function normalizeDay(day: string): Weekday {
  const match = WEEKDAYS.find((d) => d.toLowerCase() === day.toLowerCase());
  return match ?? "Monday";
}

export function WeekBar({
  year,
  week,
  day,
  showDay = true,
  label,
}: {
  year: number;
  week: number;
  day: Weekday;
  showDay?: boolean;
  label?: string;
}) {
  const navigate = useNavigate();
  const total = weeksInYear(year);

  function setWeek(delta: number) {
    let w = week + delta;
    let y = year;
    if (w < 1) {
      y -= 1;
      w = weeksInYear(y);
    } else if (w > total) {
      y += 1;
      w = 1;
    }
    void navigate({ to: ".", search: (prev: WeekSearch) => ({ ...prev, year: y, week: w }) });
  }

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4 print:hidden">
      <div className="space-y-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {label ?? "Week"}
        </Label>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeek(-1)}>
            ‹
          </Button>
          <div className="min-w-32 text-center text-lg font-semibold tabular-nums">
            Week {week} · {year}
          </div>
          <Button variant="outline" size="sm" onClick={() => setWeek(1)}>
            ›
          </Button>
        </div>
      </div>

      {showDay && (
        <div className="space-y-1">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Delivery day
          </Label>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={d === day ? "default" : "outline"}
                onClick={() =>
                  void navigate({ to: ".", search: (prev: WeekSearch) => ({ ...prev, day: d }) })
                }
              >
                {d.slice(0, 3)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {showDay && (
        <div className="ml-auto text-sm text-muted-foreground">
          {formatDate(isoWeekDate(year, week, day))}
        </div>
      )}
    </div>
  );
}
