import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { useAdminOverview } from "@/lib/admin-data";
import { partnershipLabel } from "@/components/customer-agreement";
import { BrregSearch } from "@/components/brreg-search";
import { PrimaryButton, TextField } from "@/components/field";
import type { PartnershipLevel } from "@/lib/customer-domain";

export const Route = createFileRoute("/_authenticated/admin/wholesalers/")({
  head: () => ({
    meta: [
      { title: "Grossister — Gold of Sicily admin" },
      { name: "description", content: "Wholesalers Gold of Sicily supplies." },
    ],
  }),
  component: AdminWholesalers,
});

function AdminWholesalers() {
  const { t, lang } = useI18n();
  const { allowed, isLoading: sessionLoading } = useRequireCommercial();
  const { data } = useAdminOverview();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<PartnershipLevel>(null);
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error(t("customer_name"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("customers").insert({
      name: name.trim(),
      type: "wholesaler",
      partnership_level: level,
      contact_name: contact.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      active: true,
      public_visible: false,
      public_profile: null,
      slug: null,
      legal_entity_id: legalEntityId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${name.trim()} ${t("create_customer_created")}`);
    setOpen(false);
    setName("");
    setContact("");
    setEmail("");
    setPhone("");
    setLevel(null);
    setLegalEntityId(null);
    await queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
  }

  if (sessionLoading || !allowed) {
    return <main className="min-h-screen" />;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("wholesalers")}</h1>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          {t("new_wholesaler")}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("wholesalers_intro")}</p>

      {open ? (
        <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
          <BrregSearch
            onPicked={({ legalEntityId: pickedId, hit }) => {
              setLegalEntityId(pickedId);
              if (!name.trim()) setName(hit.legalName);
            }}
          />
          <TextField label={t("customer_name")} value={name} onChange={setName} />
          <div>
            <span className="eyebrow mb-2 block">{t("partnership_level")}</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(["gold_supply", "gold_partner", null] as const).map((option) => (
                <button
                  key={option ?? "none"}
                  type="button"
                  onClick={() => setLevel(option)}
                  className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${
                    level === option
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                >
                  {option === null ? t("partnership_none") : partnershipLabel(option, t)}
                </button>
              ))}
            </div>
          </div>
          <TextField label={t("contact_name")} value={contact} onChange={setContact} />
          <TextField label={t("email")} value={email} onChange={setEmail} />
          <TextField label={t("phone")} value={phone} onChange={setPhone} />
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("create")}
          </PrimaryButton>
        </form>
      ) : null}

      <div className="mt-6 space-y-3">
        {(data?.wholesalers ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_wholesalers")}</p>
        ) : (
          data?.wholesalers.map((wholesaler) => (
            <Link
              key={wholesaler.id}
              to="/admin/wholesalers/$customerId"
              params={{ customerId: wholesaler.id }}
              className="surface-card flex items-center gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{wholesaler.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("customer_type_wholesaler")}
                  {partnershipLabel(wholesaler.partnershipLevel, t)
                    ? ` · ${partnershipLabel(wholesaler.partnershipLevel, t)}`
                    : ""}
                  {" · "}
                  {wholesaler.venueCount} {t("venues_under")}
                  {" · "}
                  {wholesaler.distributedThisMonth.toLocaleString(lang === "no" ? "nb-NO" : "en-GB")}{" "}
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
