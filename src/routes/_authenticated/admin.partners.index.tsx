import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { useAdminOverview } from "@/lib/admin-data";
import { errorMessage } from "@/lib/utils";
import { PrimaryButton, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/partners/")({
  head: () => ({
    meta: [
      { title: "Partners — Gold of Sicily admin" },
      { name: "description", content: "Trade partners and distributors Gold of Sicily sells to." },
    ],
  }),
  component: AdminPartners,
});

function AdminPartners() {
  const { t, lang } = useI18n();
  const { allowed, isLoading: sessionLoading } = useRequireCommercial();
  const { data } = useAdminOverview();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"distributor" | "direct">("distributor");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const unassigned = data?.unassigned ?? [];

  function toggleVenue(id: string) {
    setVenueIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error(t("partner_name"));
      return;
    }
    setBusy(true);
    const { data: created, error } = await supabase
      .from("partners")
      .insert({
        name: name.trim(),
        kind,
        contact_name: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        active: true,
      })
      .select("id")
      .single();
    if (error || !created) {
      setBusy(false);
      toast.error(errorMessage(error, t("create_customer_failed")));
      return;
    }
    if (venueIds.length > 0) {
      const { error: linkError } = await supabase
        .from("venues")
        .update({ partner_id: created.id })
        .in("id", venueIds);
      if (linkError) {
        setBusy(false);
        toast.error(linkError.message);
        return;
      }
    }
    setBusy(false);
    toast.success(`${name.trim()} ${t("create_customer_created")}`);
    setOpen(false);
    setName("");
    setContact("");
    setEmail("");
    setPhone("");
    setVenueIds([]);
    await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
  }

  if (sessionLoading || !allowed) {
    return <main className="min-h-screen" />;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("partners")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_partner")}
        </button>
      </div>

      {open ? (
        <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
          <TextField label={t("partner_name")} value={name} onChange={setName} />
          <div>
            <span className="eyebrow mb-2 block">{t("partner_kind")}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(["distributor", "direct"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${
                    kind === option
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  <span className="block">
                    {option === "distributor" ? t("kind_distributor") : t("kind_direct")}
                  </span>
                  <span className={`mt-1 block text-xs font-normal ${kind === option ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {option === "distributor" ? t("kind_distributor_hint") : t("kind_direct_hint")}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <TextField label={t("contact_name")} value={contact} onChange={setContact} />
          <TextField label={t("email")} value={email} onChange={setEmail} />
          <TextField label={t("phone")} value={phone} onChange={setPhone} />
          {unassigned.length > 0 ? (
            <div>
              <span className="eyebrow mb-2 block">{t("attach_venues_hint")}</span>
              <div className="space-y-2">
                {unassigned.map((venue) => (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => toggleVenue(venue.id)}
                    className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold ${
                      venueIds.includes(venue.id)
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    <span>{venue.name}</span>
                    <span className="text-xs font-normal">{venue.city || venue.location || ""}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("create")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 space-y-3">
        {(data?.partners ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_partners")}</p>
        ) : (
          data?.partners.map((partner) => (
            <Link
              key={partner.id}
              to="/admin/partners/$partnerId"
              params={{ partnerId: partner.id }}
              className="surface-card flex items-center gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{partner.name}</p>
                <p className="text-xs text-muted-foreground">
                  {partner.kind === "direct" ? t("kind_direct") : t("kind_distributor")}
                  {" · "}
                  {partner.venueCount} {t("venues_under")}
                  {" · "}
                  {partner.distributedThisMonth.toLocaleString(
                    lang === "no" ? "nb-NO" : "en-GB",
                  )}{" "}
                  {t("pcs")}
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
