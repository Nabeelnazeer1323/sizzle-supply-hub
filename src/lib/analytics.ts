import { stockholmLocalToIso } from "@/lib/order-import";
import { shiftDate } from "@/lib/week";

export type AnalyticsPeriod = "day" | "week" | "month" | "year";

const stockholmMonthDay = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  month: "2-digit",
  day: "2-digit",
});

export function analyticsRange(
  period: AnalyticsPeriod,
  date: string,
  fromYear: number,
  toYear: number,
  yearToDate: boolean,
) {
  let startDate: string;
  let endDate: string;
  if (period === "day") {
    startDate = date;
    endDate = shiftDate(date, 1);
  } else if (period === "week") {
    const anchor = new Date(`${date}T00:00:00Z`);
    const weekday = anchor.getUTCDay() || 7;
    startDate = shiftDate(date, 1 - weekday);
    endDate = shiftDate(startDate, 7);
  } else if (period === "month") {
    startDate = `${date.slice(0, 7)}-01`;
    const nextMonth = new Date(`${startDate}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    endDate = nextMonth.toISOString().slice(0, 10);
  } else {
    startDate = `${fromYear}-01-01`;
    if (yearToDate) {
      const today = Object.fromEntries(
        stockholmMonthDay.formatToParts(new Date()).map((part) => [part.type, part.value]),
      );
      const monthDay = `${today["month"]}-${today["day"]}`;
      endDate = shiftDate(`${toYear}-${monthDay}`, 1);
    } else {
      endDate = `${toYear + 1}-01-01`;
    }
  }

  return {
    start: stockholmLocalToIso(startDate, "00:00:00"),
    end: stockholmLocalToIso(endDate, "00:00:00"),
    label: `${startDate} – ${shiftDate(endDate, -1)}`,
  };
}
