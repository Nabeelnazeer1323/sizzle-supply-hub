import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { WEEKDAYS, type Weekday, formatDate, isoWeekDate, weeksInYear } from "@/lib/week";
import { Button } from "@/components/ui/button";

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
  disabled = false,
}: {
  year: number;
  week: number;
  day: Weekday;
  showDay?: boolean;
  label?: string;
  disabled?: boolean;
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
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, year: y, week: w }),
    });
  }

  return (
    <div
      className={`space-y-3 rounded-xl border border-border bg-card p-3 print:hidden ${disabled ? "opacity-50" : ""}`}
      aria-disabled={disabled}
    >
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Previous week"
          disabled={disabled}
          onClick={() => setWeek(-1)}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex-1 text-center">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label ?? "Week"}
          </div>
          <div className="text-base font-semibold tabular-nums">
            Week {week} · {year}
          </div>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Next week"
          disabled={disabled}
          onClick={() => setWeek(1)}
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      {showDay && (
        <>
          <div className="grid grid-cols-5 gap-1">
            {WEEKDAYS.map((d) => (
              <Button
                key={d}
                size="sm"
                className="h-10"
                variant={d === day ? "default" : "outline"}
                disabled={disabled}
                onClick={() =>
                  void navigate({
                    to: ".",
                    search: (prev: Record<string, unknown>) => ({ ...prev, day: d }),
                  })
                }
              >
                {d.slice(0, 3)}
              </Button>
            ))}
          </div>
          <div className="text-center text-xs text-muted-foreground">
            {formatDate(isoWeekDate(year, week, day))}
          </div>
        </>
      )}
    </div>
  );
}
