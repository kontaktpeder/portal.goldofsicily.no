import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { statusToken, useAdminOverview } from "@/lib/admin-data";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";

export const Route = createFileRoute("/_authenticated/admin/partners/$partnerId")({
  head: () => ({
    meta: [{ title: "Partner — Gold of Sicily admin" }],
  }),
  component: PartnerDetail,
});

function PartnerDetail() {
  const { partnerId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const overview = useAdminOverview();
  const partnerCard = overview.data?.partners.find((row) => row.id === partnerId);

  const { data: partner } = useQuery({
    queryKey: ["partner", partnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partners")
        .select("*")
        .eq("id", partnerId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [name, setName] = useState("");
  const [kind, setKind] = useState<"distributor" | "direct">("distributor");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!partner) return;
    setName(partner.name);
    setKind(partner.kind);
    setContact(partner.contact_name ?? "");
    setEmail(partner.email ?? "");
    setPhone(partner.phone ?? "");
    setNotes(partner.notes ?? "");
    setActive(partner.active);
  }, [partner]);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("partners")
      .update({
        name: name.trim(),
        kind,
        contact_name: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        active,
      })
      .eq("id", partnerId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    await queryClient.invalidateQueries();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="pt-6">
        <Link
          to="/admin/partners"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("partners")}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">{partner?.name ?? "—"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {partnerCard?.venueCount ?? 0} {t("venues_under")}
          {" · "}
          {(partnerCard?.distributedThisMonth ?? 0).toLocaleString(
            lang === "no" ? "nb-NO" : "en-GB",
          )}{" "}
          {t("pcs")} {t("distributed_month").toLowerCase()}
        </p>
      </div>

      <div className="surface-card mt-6 space-y-4 p-5">
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
                <span
                  className={`mt-1 block text-xs font-normal ${
                    kind === option ? "text-primary-foreground/80" : "text-muted-foreground"
                  }`}
                >
                  {option === "distributor" ? t("kind_distributor_hint") : t("kind_direct_hint")}
                </span>
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
        <button
          type="button"
          onClick={() => setActive((value) => !value)}
          className="flex items-center gap-3 text-sm font-medium"
        >
          <span
            className={`flex h-7 w-12 items-center rounded-full p-1 ${active ? "bg-success" : "bg-muted"}`}
          >
            <span
              className={`size-5 rounded-full bg-card transition-transform ${active ? "translate-x-5" : ""}`}
            />
          </span>
          {active ? t("active") : t("inactive")}
        </button>
        <PrimaryButton onClick={save} disabled={busy}>
          {t("save")}
        </PrimaryButton>
      </div>

      <h2 className="eyebrow mt-10">{t("customers")}</h2>
      <div className="mt-3 space-y-3">
        {(partnerCard?.venues ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_customers")}</p>
        ) : (
          partnerCard?.venues.map((row) => (
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
                  {row.city || row.location || "—"} · {t("sold")}: {row.soldThisWeek} · {t("stock")}
                  : {row.estimatedStock}
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
