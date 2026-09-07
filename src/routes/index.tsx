import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { identifierToEmailCandidates } from "@/lib/username";
import { portalHomePath } from "@/lib/staff";
import { LanguageToggle, Wordmark } from "@/components/brand";
import { PrimaryButton, TextField } from "@/components/field";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Gold of Sicily Partner Portal" },
      {
        name: "description",
        content:
          "Partner sign-in for Gold of Sicily: submit your shift report in under 60 seconds.",
      },
      { property: "og:title", content: "Sign in — Gold of Sicily Partner Portal" },
      {
        property: "og:description",
        content: "Partner sign-in for Gold of Sicily shift reporting.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id);
      const roleNames = (roles ?? []).map((row) => row.role);
      void navigate({ to: portalHomePath(roleNames), replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError(t("login_missing"));
      return;
    }
    setBusy(true);
    let session: Session | null = null;
    for (const email of identifierToEmailCandidates(username)) {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!signInError && data.session) {
        session = data.session;
        break;
      }
    }
    if (!session) {
      setBusy(false);
      setError(t("login_failed"));
      return;
    }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const roleNames = (roles ?? []).map((row) => row.role);
    try {
      await navigate({ to: portalHomePath(roleNames), replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col px-6 pt-10 pb-12 sm:justify-center">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-center justify-between">
          <Wordmark size="sm" />
          <LanguageToggle />
        </div>

        <div className="mt-14 text-center">
          <p className="eyebrow">{t("login_sub")}</p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold">
            {lang === "no" ? "Velkommen" : "Welcome"}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 space-y-4">
          <TextField
            label={t("username")}
            value={username}
            onChange={setUsername}
            placeholder="oslobar"
          />
          <TextField
            label={t("password")}
            value={password}
            onChange={setPassword}
            type="password"
          />
          {error ? (
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <PrimaryButton type="submit" disabled={busy} className="mt-2">
            {busy ? t("signing_in") : t("sign_in")}
          </PrimaryButton>
        </form>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          <Link to="/setup" className="underline decoration-primary/60 underline-offset-4">
            Gold of Sicily
          </Link>
        </p>
      </div>
    </main>
  );
}
