import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChefHat, LogOut } from "lucide-react";
import type { ReactNode } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV: { to: string; label: string; roles: AppRole[] }[] = [
  { to: "/requirements", label: "Requirements", roles: ["admin"] },
  { to: "/production", label: "Production", roles: ["admin", "kitchen"] },
  { to: "/allotment", label: "Allotment", roles: ["admin", "kitchen"] },
  { to: "/packing", label: "Packing", roles: ["admin", "kitchen", "packer"] },
  { to: "/returns", label: "Returns", roles: ["admin", "packer"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, roles, rolesConfigured, hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/requirements" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ChefHat className="size-4" />
            </span>
            Sizzle Ops
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            {NAV.filter((item) => hasRole(...item.roles)).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {roles.map((r) => (
              <Badge key={r} variant="secondary" className="capitalize">
                {r}
              </Badge>
            ))}
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" />
              Sign out
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
      <main className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        {children}
      </main>
    </div>
  );
}
