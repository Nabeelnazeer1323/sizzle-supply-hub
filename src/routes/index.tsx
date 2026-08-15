import { createFileRoute, redirect } from "@tanstack/react-router";

import { defaultWeekSearch } from "@/lib/week";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", search: defaultWeekSearch() });
  },
  component: () => null,
});
