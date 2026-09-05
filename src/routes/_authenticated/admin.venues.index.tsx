import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { statusToken, useAdminOverview } from "@/lib/admin-data";
import { createCustomerAccount } from "@/lib/admin.functions";
import { isValidUsername, parseLoginIdentifier } from "@/lib/username";
import { errorMessage } from "@/lib/utils";
import { PrimaryButton, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/venues/")({
  head: () => ({
    meta: [
      { title: "Serveringssteder — Gold of Sicily admin" },
      { name: "description", content: "Create and manage Gold of Sicily serving venues." },
      { property: "og:title", content: "Serveringssteder — Gold of Sicily admin" },
      { property: "og:description", content: "Create and manage partner venues and their logins." },
    ],
  }),
  component: AdminCustomers,
});

function AdminCustomers() {
  const { t } = useI18n();
  const { data, error: loadError } = useAdminOverview();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useServerFn(createCustomerAccount);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [directPartner, setDirectPartner] = useState(false);
  const [publicVisible, setPublicVisible] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<"no" | "en">("no");
  const [busy, setBusy] = useState(false);
  const loginPreview = parseLoginIdentifier(username)?.username;

  const { data: partners } = useQuery({
    queryKey: ["partners-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("partners")
        .select("id, name, kind")
        .eq("active", true)
        .order("name");
      return data ?? [];
    },
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || username.trim().length < 3 || password.length < 6) {
      toast.error(t("create_customer_missing"));
      return;
    }
    if (!isValidUsername(username)) {
      toast.error(t("create_customer_username"));
      return;
    }
    setBusy(true);
    try {
      const created = await create({
        data: {
          name,
          location,
          city,
          partnerId: partnerId || null,
          directPartner,
          publicVisible,
          username,
          password,
          language,
          active: true,
        },
      });
      toast.success(
        `${name.trim()} ${t("create_customer_created")} (${loginPreview ?? username.trim()})`,
      );
      setOpen(false);
      setName("");
      setLocation("");
      setUsername("");
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      if (created?.customerId) {
        void navigate({
          to: "/admin/venues/$venueId",
          params: { venueId: created.customerId },
        });
      }
    } catch (error) {
      const message = errorMessage(error, t("create_customer_failed"));
      const lower = message.toLowerCase();
      if (lower.includes("already") || lower.includes("opptatt")) {
        toast.error(t("create_customer_username_taken"));
      } else if (
        lower.includes("weak") ||
        lower.includes("pwned") ||
        lower.includes("easy to guess")
      ) {
        toast.error(t("create_customer_weak_password"));
      } else if (lower.includes("invalid format") || lower.includes("23505")) {
        toast.error(t("create_customer_username"));
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("customers")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_customer")}
        </button>
      </div>

      {open ? (
        <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
          <TextField label={t("customer_name")} value={name} onChange={setName} />
          <TextField label={t("city")} value={city} onChange={setCity} />
          <TextField label={t("location")} value={location} onChange={setLocation} />
          <label className="block">
            <span className="eyebrow mb-2 block">{t("partner")}</span>
            <select
              value={partnerId}
              onChange={(event) => setPartnerId(event.target.value)}
              disabled={directPartner}
              className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary disabled:opacity-50"
            >
              <option value="">—</option>
              {partners?.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setDirectPartner((value) => !value);
              if (!directPartner) setPartnerId("");
            }}
            className="flex items-center gap-3 text-left text-sm"
          >
            <span
              className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 ${directPartner ? "bg-success" : "bg-muted"}`}
            >
              <span
                className={`size-5 rounded-full bg-card transition-transform ${directPartner ? "translate-x-5" : ""}`}
              />
            </span>
            {t("direct_partner_hint")}
          </button>
          <button
            type="button"
            onClick={() => setPublicVisible((value) => !value)}
            className="flex items-center gap-3 text-left text-sm"
          >
            <span
              className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 ${publicVisible ? "bg-success" : "bg-muted"}`}
            >
              <span
                className={`size-5 rounded-full bg-card transition-transform ${publicVisible ? "translate-x-5" : ""}`}
              />
            </span>
            {publicVisible ? t("public_yes") : t("public_no")}
          </button>
          <div>
            <TextField label={t("username")} value={username} onChange={setUsername} />
            {loginPreview && loginPreview !== username.trim().toLowerCase() ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("create_customer_login_as")}: <strong>{loginPreview}</strong>
              </p>
            ) : null}
          </div>
          <TextField
            label={t("password")}
            value={password}
            onChange={setPassword}
            type="password"
          />
          <div>
            <span className="eyebrow mb-2 block">{t("language")}</span>
            <div className="flex gap-2">
              {(["no", "en"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLanguage(option)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold uppercase ${
                    language === option
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("create")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 space-y-3">
        {loadError ? (
          <p className="text-sm text-destructive">
            {errorMessage(loadError, t("create_customer_failed"))}
          </p>
        ) : (data?.rows ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_customers")}</p>
        ) : (
          data?.rows.map((row) => (
            <Link
              key={row.id}
              to="/admin/venues/$venueId"
              params={{ venueId: row.id }}
              className="surface-card flex items-center gap-4 p-4"
            >
              <span className={`size-3 shrink-0 rounded-full ${statusToken(row.status)}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.location ?? row.city ?? "—"} · {row.active ? t("active") : t("inactive")}
                  {row.publicVisible ? ` · ${t("public_yes")}` : ""}
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
