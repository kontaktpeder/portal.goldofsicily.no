import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { PrimaryButton } from "@/components/field";

export type PartnerOption = {
  id: string;
  name: string;
  kind: "distributor" | "direct" | string;
  active?: boolean;
};

export type VenueOption = {
  id: string;
  name: string;
  partnerId: string | null;
  partnerName?: string | null;
  city?: string | null;
  location?: string | null;
  detail?: string;
};

export function partnerKindLabel(
  t: (key: "kind_direct" | "kind_distributor") => string,
  kind: string,
) {
  return kind === "direct" ? t("kind_direct") : t("kind_distributor");
}

export function partnerOptionLabel(
  partner: PartnerOption,
  t: (key: "kind_direct" | "kind_distributor" | "inactive") => string,
) {
  const kind = partnerKindLabel(t, partner.kind);
  return partner.active === false
    ? `${partner.name} · ${kind} (${t("inactive")})`
    : `${partner.name} · ${kind}`;
}

export async function setVenuePartner(venueId: string, partnerId: string | null) {
  const { error } = await supabase.from("venues").update({ partner_id: partnerId }).eq("id", venueId);
  if (error) throw error;
}

export async function createGoldPartnerForVenue(venue: { id: string; name: string }) {
  const { data: partner, error } = await supabase
    .from("partners")
    .insert({ name: venue.name, kind: "direct", active: true })
    .select("id, name, kind")
    .single();
  if (error || !partner) throw new Error(error?.message ?? "Could not create partner");
  await setVenuePartner(venue.id, partner.id);
  return partner;
}

const selectClass =
  "h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary";

export function VenuePartnerCard({
  venueId,
  venueName,
  partnerId,
  partners,
  onChanged,
}: {
  venueId: string;
  venueName: string;
  partnerId: string | null;
  partners: PartnerOption[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(partnerId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(partnerId ?? "");
  }, [partnerId]);

  const current = partners.find((partner) => partner.id === partnerId) ?? null;
  const dirty = selected !== (partnerId ?? "");

  async function saveLink() {
    setBusy(true);
    try {
      await setVenuePartner(venueId, selected || null);
      toast.success(selected ? t("link_saved") : t("link_removed"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("create_customer_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await setVenuePartner(venueId, null);
      setSelected("");
      toast.success(t("link_removed"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("create_customer_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function makeGoldPartner() {
    setBusy(true);
    try {
      await createGoldPartnerForVenue({ id: venueId, name: venueName });
      toast.success(t("link_saved"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("create_customer_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <div>
        <p className="eyebrow">{t("partner")}</p>
        <p className="mt-1 text-xl font-semibold">
          {current ? current.name : t("unassigned_partner")}
        </p>
        {current ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {partnerKindLabel(t, current.kind)}
            {current.active === false ? ` · ${t("inactive")}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("partner_link_intro")}</p>
        )}
      </div>

      {current ? (
        <Link
          to="/admin/partners/$partnerId"
          params={{ partnerId: current.id }}
          className="inline-flex text-sm font-semibold text-primary"
        >
          {t("open_partner")}
        </Link>
      ) : null}

      <label className="block">
        <span className="eyebrow mb-2 block">{t("choose_partner")}</span>
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className={selectClass}
        >
          <option value="">{t("unassigned_partner")}</option>
          {partners.map((partner) => (
            <option key={partner.id} value={partner.id}>
              {partnerOptionLabel(partner, t)}
            </option>
          ))}
        </select>
      </label>

      <PrimaryButton onClick={saveLink} disabled={busy || !dirty}>
        {busy ? "…" : selected ? t("link_partner") : t("unlink_partner")}
      </PrimaryButton>

      {partnerId ? (
        <button
          type="button"
          onClick={unlink}
          disabled={busy}
          className="text-sm font-semibold text-muted-foreground underline disabled:opacity-50"
        >
          {t("unlink_partner")}
        </button>
      ) : (
        <div>
          <button
            type="button"
            onClick={makeGoldPartner}
            disabled={busy}
            className="text-sm font-semibold text-primary disabled:opacity-50"
          >
            {t("make_gold_partner")}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{t("make_gold_partner_hint")}</p>
        </div>
      )}
    </section>
  );
}

export function PartnerVenuesPanel({
  partnerId,
  venues,
  onChanged,
}: {
  partnerId: string;
  venues: VenueOption[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const [busy, setBusy] = useState(false);

  const linked = venues.filter((venue) => venue.partnerId === partnerId);
  const available = venues.filter((venue) => venue.partnerId !== partnerId);

  async function attach() {
    if (!selectedVenueId) return;
    setBusy(true);
    try {
      await setVenuePartner(selectedVenueId, partnerId);
      toast.success(t("link_saved"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("create_customer_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(venueId: string) {
    setBusy(true);
    try {
      await setVenuePartner(venueId, null);
      toast.success(t("link_removed"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("create_customer_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="eyebrow">{t("linked_venues")}</h2>
      <div className="mt-3 space-y-3">
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_linked_venues")}</p>
        ) : (
          linked.map((venue) => (
            <div key={venue.id} className="surface-card flex items-center gap-3 p-4">
              <Link
                to="/admin/venues/$venueId"
                params={{ venueId: venue.id }}
                className="min-w-0 flex-1"
              >
                <p className="truncate font-semibold">{venue.name}</p>
                <p className="text-xs text-muted-foreground">
                  {venue.detail ?? (venue.city || venue.location || "—")}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => unlink(venue.id)}
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-muted-foreground underline disabled:opacity-50"
              >
                {t("unlink_venue")}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="surface-card mt-4 space-y-4 p-5">
        <div>
          <p className="eyebrow">{t("link_existing_venue")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("link_existing_venue_hint")}</p>
        </div>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("no_venues_to_link")}</p>
        ) : (
          <>
            <label className="block">
              <span className="eyebrow mb-2 block">{t("choose_venue")}</span>
              <select
                value={selectedVenueId}
                onChange={(event) => setSelectedVenueId(event.target.value)}
                className={selectClass}
              >
                <option value="">{t("choose_venue")}</option>
                {available.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.partnerName
                      ? `${venue.name} (${t("now_with")}: ${venue.partnerName})`
                      : `${venue.name} (${t("currently_unassigned")})`}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton onClick={attach} disabled={busy || !selectedVenueId}>
              {busy ? "…" : t("link_venue")}
            </PrimaryButton>
          </>
        )}
        <Link
          to="/admin/venues"
          search={{ partnerId }}
          className="inline-flex text-sm font-semibold text-primary"
        >
          {t("new_venue_under_partner")}
        </Link>
      </div>
    </section>
  );
}
