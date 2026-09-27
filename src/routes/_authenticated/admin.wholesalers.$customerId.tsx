import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRequireCommercial } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import { useAdminOverview } from "@/lib/admin-data";
import { formatDate } from "@/lib/sign-out";
import { partnershipLabel } from "@/components/customer-agreement";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import type { PartnershipLevel } from "@/lib/customer-domain";

export const Route = createFileRoute("/_authenticated/admin/wholesalers/$customerId")({
  head: () => ({
    meta: [
      { title: "Grossist — Gold of Sicily admin" },
      { name: "description", content: "Wholesaler supply, deliveries and handovers." },
    ],
  }),
  component: WholesalerDetail,
});

function WholesalerDetail() {
  const { customerId } = Route.useParams();
  const { t, lang } = useI18n();
  const { allowed, isLoading: sessionLoading } = useRequireCommercial();
  const overview = useAdminOverview();
  const queryClient = useQueryClient();
  const card = overview.data?.wholesalers.find((row) => row.id === customerId);

  const customer = useQuery({
    queryKey: ["wholesaler", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .eq("type", "wholesaler")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (sessionLoading || !allowed) return <main className="min-h-screen" />;

  const row = customer.data;
  const badge = partnershipLabel(row?.partnership_level ?? null, t);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <Link
        to="/admin/wholesalers"
        className="inline-flex items-center gap-1.5 pt-6 text-xs text-muted-foreground"
      >
        <ArrowLeft className="size-3.5" /> {t("wholesalers")}
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">{row?.name ?? "—"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("customer_type_wholesaler")}
        {badge ? ` · ${badge}` : ""}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t("supplies_venues")} value={String(card?.venueCount ?? 0)} />
        <Stat
          label={t("distributed_month")}
          value={`${(card?.distributedThisMonth ?? 0).toLocaleString(lang === "no" ? "nb-NO" : "en-GB")} ${t("pcs")}`}
        />
        <Stat
          label={t("latest_handover")}
          value={card?.latestHandoverAt ? formatDate(card.latestHandoverAt, lang) : t("never")}
        />
      </div>

      {row ? (
        <WholesalerForm
          customer={row}
          onSaved={() => {
            void customer.refetch();
            void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
          }}
        />
      ) : null}

      <h2 className="mt-10 text-xl font-semibold">{t("supplied_venues")}</h2>
      <div className="mt-3 space-y-2">
        {(card?.venues ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_supplied_venues")}</p>
        ) : (
          card?.venues.map((venue) => (
            <Link
              key={venue.id}
              to="/admin/venues/$venueId"
              params={{ venueId: venue.id }}
              className="surface-card flex items-center justify-between p-4"
            >
              <span className="font-semibold">{venue.name}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))
        )}
      </div>
      <Link
        to="/admin/venues"
        search={{ suppliedBy: customerId }}
        className="mt-4 inline-flex text-sm font-semibold text-primary"
      >
        {t("new_venue_supplied_by")}
      </Link>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="surface-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}

function WholesalerForm({
  customer,
  onSaved,
}: {
  customer: {
    id: string;
    name: string;
    active: boolean;
    partnership_level: PartnershipLevel;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
  };
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(customer.name);
  const [level, setLevel] = useState<PartnershipLevel>(customer.partnership_level);
  const [contact, setContact] = useState(customer.contact_name ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [active, setActive] = useState(customer.active);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(customer.name);
    setLevel(customer.partnership_level);
    setContact(customer.contact_name ?? "");
    setEmail(customer.email ?? "");
    setPhone(customer.phone ?? "");
    setNotes(customer.notes ?? "");
    setActive(customer.active);
  }, [customer]);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("customers")
      .update({
        name: name.trim(),
        partnership_level: level,
        contact_name: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        active,
        public_visible: false,
        public_profile: null,
        slug: null,
        supplied_by_customer_id: null,
      })
      .eq("id", customer.id)
      .eq("type", "wholesaler");
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    onSaved();
  }

  return (
    <form
      className="surface-card mt-6 space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
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
      <label className="block">
        <span className="eyebrow mb-2 block">{t("notes")}</span>
        <TextAreaField value={notes} onChange={setNotes} />
      </label>
      <button type="button" onClick={() => setActive((value) => !value)} className="text-sm font-semibold">
        {active ? t("active") : t("inactive")}
      </button>
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "…" : t("save")}
      </PrimaryButton>
    </form>
  );
}
