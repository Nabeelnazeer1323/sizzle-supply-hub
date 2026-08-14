import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChefHat,
  ClipboardList,
  LogOut,
  PackageCheck,
  Split,
  Undo2,
  Utensils,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV: {
  to: string;
  label: string;
  short: string;
  icon: ComponentType<{ className?: string }>;
  roles: AppRole[];
}[] = [
  {
    to: "/requirements",
    label: "Requirements",
    short: "Needs",
    icon: ClipboardList,
    roles: ["admin"],
  },
  {
    to: "/production",
    label: "Production",
    short: "Cook",
    icon: Utensils,
    roles: ["admin", "kitchen"],
  },
  { to: "/allotment", label: "Allotment", short: "Split", icon: Split, roles: ["admin", "kitchen"] },
  {
    to: "/packing",
    label: "Packing",
    short: "Pack",
    icon: PackageCheck,
    roles: ["admin", "kitchen", "packer"],
  },
  { to: "/returns", label: "Returns", short: "Returns", icon: Undo2, roles: ["admin", "packer"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, roles, rolesConfigured, hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const items = NAV.filter((item) => hasRole(...item.roles));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link
            to="/requirements"
            search={{}}
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ChefHat className="size-4" />
            </span>
            <span className="hidden sm:inline">Sizzle Ops</span>
          </Link>
          <nav className="hidden flex-1 flex-wrap items-center gap-1 md:flex">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {roles.map((r) => (
              <Badge key={r} variant="secondary" className="hidden capitalize sm:inline-flex">
                {r}
              </Badge>
            ))}
            <span className="hidden text-sm text-muted-foreground lg:inline">{user?.email}</span>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
        {!rolesConfigured && (
          <div className="bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
            Staff roles are not set up yet — everyone signed in has full access.{" "}
            <Link to="/setup" className="underline">
              Finish setup
            </Link>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 md:py-6 print:max-w-none print:px-0 print:py-0">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur md:hidden print:hidden">
        <div className="flex">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <item.icon className="size-5" />
              {item.short}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
