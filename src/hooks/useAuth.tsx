import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "kitchen" | "packer";

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  /** false when the user_roles table has not been created yet */
  rolesConfigured: boolean;
  hasRole: (...roles: AppRole[]) => boolean;
  refreshRoles: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesConfigured, setRolesConfigured] = useState(true);

  async function loadRoles(userId: string | undefined) {
    if (!userId) {
      setRoles([]);
      return;
    }
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (error) {
      // Table not created yet — fall back to full access with a visible banner.
      setRolesConfigured(false);
      setRoles(["admin"]);
      return;
    }
    setRolesConfigured(true);
    const list = (data ?? []).map((r) => r.role as AppRole);
    setRoles(list.length > 0 ? list : ["packer"]);
  }

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadRoles(data.session?.user.id);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void loadRoles(next?.user.id);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      roles,
      rolesConfigured,
      hasRole: (...wanted: AppRole[]) => wanted.some((r) => roles.includes(r)),
      refreshRoles: () => loadRoles(session?.user.id),
    }),
    [loading, session, roles, rolesConfigured],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
