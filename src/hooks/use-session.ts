import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SessionInfo = {
  session: Session | null;
  isAdmin: boolean;
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
      isAdmin: false,
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

  return {
    session,
    isAdmin: (roles ?? []).some((r) => r.role === "admin"),
    username: profile?.username ?? null,
    customerId: profile?.venue_id ?? null,
    customerName: customer?.name ?? null,
    preferredLanguage: profile?.preferred_language === "en" ? "en" : "no",
  };
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
