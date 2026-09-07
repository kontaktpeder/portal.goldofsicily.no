import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { canManageCommercial, canManageOperations } from "@/lib/access";
import { portalHomePath } from "@/lib/staff";

export type SessionInfo = {
  session: Session | null;
  roles: string[];
  isAdmin: boolean;
  canManageOperations: boolean;
  canManageCommercial: boolean;
  username: string | null;
  customerId: string | null;
  customerName: string | null;
  preferredLanguage: "no" | "en";
};

async function loadSessionInfo(): Promise<SessionInfo> {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  if (!session) {
    return {
      session: null,
      roles: [],
      isAdmin: false,
      canManageOperations: false,
      canManageCommercial: false,
      username: null,
      customerId: null,
      customerName: null,
      preferredLanguage: "no",
    };
  }

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, venue_id, preferred_language, venues(name)")
      .eq("id", session.user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", session.user.id),
  ]);

  const customer = (profile?.venues as { name: string } | null) ?? null;
  const roleNames = (roles ?? []).map((row) => row.role);

  return {
    session,
    roles: roleNames,
    isAdmin: canManageCommercial(roleNames),
    canManageOperations: canManageOperations(roleNames),
    canManageCommercial: canManageCommercial(roleNames),
    username: profile?.username ?? null,
    customerId: profile?.venue_id ?? null,
    customerName: customer?.name ?? null,
    preferredLanguage: profile?.preferred_language === "en" ? "en" : "no",
  };
}

export function sessionHomePath(roles: readonly string[]): "/admin" | "/report" {
  return portalHomePath(roles);
}

export function useSessionInfo() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const query = useQuery({
    queryKey: ["session-info"],
    queryFn: loadSessionInfo,
    enabled: ready,
    staleTime: 30_000,
  });

  return {
    ...query,
    isLoading: !ready || query.isPending,
  };
}

/** Redirect Drift away from Eier-only pages (partnere, produkter, ansatte). */
export function useRequireCommercial() {
  const navigate = useNavigate();
  const session = useSessionInfo();
  const allowed = Boolean(session.data?.canManageCommercial);

  useEffect(() => {
    if (!session.isLoading && session.data && !session.data.canManageCommercial) {
      void navigate({ to: "/admin", replace: true });
    }
  }, [navigate, session.data, session.isLoading]);

  return { ...session, allowed };
}
