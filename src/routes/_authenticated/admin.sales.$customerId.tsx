import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { listStaffAccounts } from "@/lib/admin.functions";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { partnershipLabel } from "@/components/customer-agreement";
import { formatDate } from "@/lib/sign-out";
import { errorMessage } from "@/lib/utils";
import {
  CRM_ACTIVITY_KINDS,
  CUSTOMER_SEGMENTS,
  SALES_STATUSES,
  activationChannel,
  activationGaps,
  commercialReadyPatch,
  purchasingContactOwner,
  salesStatusPatch,
  withCommercialReady,
  type CrmActivityKind,
  type CustomerSegment,
  type DeliverySiteState,
  type SalesStatus,
} from "@/lib/crm";

const fieldClass =
  "h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary";

const STATUS_KEY: Record<SalesStatus, TranslationKey> = {
  prospect: "sales_status_prospect",
  contacted: "sales_status_contacted",
  interested: "sales_status_interested",
  tasting: "sales_status_tasting",
  pilot_order: "sales_status_pilot_order",
  active_customer: "sales_status_active_customer",
  waiting: "sales_status_waiting",
  not_relevant: "sales_status_not_relevant",
};

const SEGMENT_KEY: Record<CustomerSegment, TranslationKey> = {
  restaurant: "sales_segment_restaurant",
  hotel: "sales_segment_hotel",
  event: "sales_segment_event",
  bar: "sales_segment_bar",
};

const ACTIVITY_KEY: Record<CrmActivityKind, TranslationKey> = {
  call: "sales_activity_call",
  email: "sales_activity_email",
  meeting: "sales_activity_meeting",
  tasting: "sales_activity_tasting",
  note: "sales_activity_note",
};

const GAP_KEY: Record<"delivery_address" | "invoice_recipient", TranslationKey> = {
  delivery_address: "sales_gap_delivery_address",
  invoice_recipient: "sales_gap_invoice_recipient",
};

export const Route = createFileRoute("/_authenticated/admin/sales/$customerId")({
  head: () => ({
    meta: [
      { title: "Salg — Gold of Sicily" },
      { name: "description", content: "Sales profile for one delivery site." },
    ],
  }),
  component: SalesProfile,
});

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function SalesProfile() {
  const { customerId } = Route.useParams();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: session } = useSessionInfo();
  const listStaff = useServerFn(listStaffAccounts);
  const commercial = Boolean(session?.canManageCommercial);

  const profile = useQuery({
    queryKey: ["sales-profile", customerId],
    queryFn: async () => {
      const customerRes = await supabase
        .from("customers")
        .select(
          "id, name, type, segment, city, location, address, delivery_address, notes, active, partnership_level, supplied_by_customer_id, sales_status, sales_owner_id, next_follow_up_on, sales_status_changed_at, commercial_ready_at, legal_entity_id, billing_legal_entity_id, contact_name, email, phone",
        )
        .eq("id", customerId)
        .maybeSingle();
      if (customerRes.error) throw customerRes.error;
      const loaded = customerRes.data;
      if (!loaded) return null;
      const supplierRes = loaded.supplied_by_customer_id
        ? await supabase
            .from("customers")
            .select("name")
            .eq("id", loaded.supplied_by_customer_id)
            .maybeSingle()
        : null;
      if (supplierRes?.error) throw supplierRes.error;
      const customer = {
        ...loaded,
        supplier: supplierRes?.data ? { name: supplierRes.data.name } : null,
      };

      const entityIds = [customer.legal_entity_id, customer.billing_legal_entity_id].filter(
        (id): id is string => Boolean(id),
      );
      const [entities, siteContacts, logins, deliveries, activities] = await Promise.all([
        entityIds.length
          ? supabase
              .from("legal_entities")
              .select("id, legal_name, organization_number, parent_legal_entity_id")
              .in("id", entityIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("customer_contacts")
          .select("id, name, email, phone, role")
          .eq("customer_id", customerId)
          .order("created_at"),
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customerId),
        supabase
          .from("deliveries")
          .select(
            "id, delivered_at, commercial_route, delivery_lines(quantity, gold_lot_id, product_name_snapshot, gold_lots(lot_code)), wholesaler:customers!deliveries_wholesaler_customer_id_fkey(name)",
          )
          .eq("customer_id", customerId)
          .order("delivered_at", { ascending: false }),
        supabase
          .from("crm_activities")
          .select("id, kind, body, happened_at")
          .eq("customer_id", customerId)
          .order("happened_at", { ascending: false }),
      ]);
      if (entities.error) throw entities.error;
      if (siteContacts.error) throw siteContacts.error;
      if (logins.error) throw logins.error;
      if (deliveries.error) throw deliveries.error;
      if (activities.error) throw activities.error;

      const linked =
        (entities.data ?? []).find((entity) => entity.id === customer.legal_entity_id) ?? null;
      const parentId = linked?.parent_legal_entity_id ?? null;
      const parentRes = parentId
        ? await supabase
            .from("legal_entities")
            .select("id, legal_name, organization_number, parent_legal_entity_id")
            .eq("id", parentId)
            .maybeSingle()
        : { data: null, error: null };
      if (parentRes.error) throw parentRes.error;
      const groupIds = [linked?.id, parentRes.data?.id].filter((id): id is string => Boolean(id));
      const groupContacts = groupIds.length
        ? await supabase
            .from("customer_contacts")
            .select("id, name, email, phone, role, legal_entity_id")
            .in("legal_entity_id", groupIds)
            .order("created_at")
        : { data: [], error: null };
      if (groupContacts.error) throw groupContacts.error;

      return {
        customer,
        linked,
        parent: parentRes.data,
        siteContacts: siteContacts.data ?? [],
        groupContacts: groupContacts.data ?? [],
        loginCount: logins.count ?? 0,
        deliveries: deliveries.data ?? [],
        activities: activities.data ?? [],
      };
    },
  });

  const staff = useQuery({
    queryKey: ["sales-staff"],
    queryFn: () => listStaff(),
    enabled: commercial,
  });

  const data = profile.data;
  const customer = data?.customer;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["sales-profile", customerId] });
    await queryClient.invalidateQueries({ queryKey: ["sales-list"] });
  }

  async function setStatus(status: SalesStatus) {
    const { error } = await supabase
      .from("customers")
      .update(salesStatusPatch(status))
      .eq("id", customerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="pt-6">
        <Link
          to="/admin/sales"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("sales_title")}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">{customer?.name ?? "—"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {customer?.city || customer?.location || "—"}
          {customer?.segment ? ` · ${t(SEGMENT_KEY[customer.segment])}` : ""}
        </p>
      </div>

      {!customer ? (
        profile.isLoading ? null : (
          <p className="mt-6 text-sm text-muted-foreground">{t("sales_empty")}</p>
        )
      ) : (
        <div className="mt-6 space-y-4">
          <section className="surface-card space-y-4 p-5">
            <div>
              <h2 className="text-lg font-semibold">{t("sales_status")}</h2>
              <p className="text-sm text-muted-foreground">{t("sales_intro")}</p>
            </div>
            {customer.sales_status ? (
              <label className="block">
                <span className="eyebrow mb-2 block">{t("sales_status")}</span>
                <select
                  className={fieldClass}
                  value={customer.sales_status}
                  disabled={!commercial}
                  onChange={(event) => void setStatus(event.target.value as SalesStatus)}
                >
                  {SALES_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {t(STATUS_KEY[option])}
                    </option>
                  ))}
                </select>
              </label>
            ) : commercial ? (
              <PrimaryButton onClick={() => void setStatus("prospect")}>
                {t("sales_start")}
              </PrimaryButton>
            ) : null}
            <FollowUp
              customer={customer}
              staff={staff.data?.staff ?? []}
              disabled={!commercial}
              onSaved={refresh}
            />
          </section>

          <Operations
            customer={customer}
            supplierName={one(customer.supplier)?.name ?? null}
            loginCount={data.loginCount}
            parentName={data.parent?.legal_name ?? data.linked?.legal_name ?? null}
            onReady={refresh}
            disabled={!commercial}
          />

          <Contacts
            customerId={customerId}
            siteContacts={data.siteContacts}
            groupContacts={data.groupContacts}
            legalEntityId={customer.legal_entity_id}
            parentLegalEntityId={data.parent?.id ?? null}
            parentName={data.parent?.legal_name ?? data.linked?.legal_name ?? null}
            legacyContact={customer.contact_name}
            legacyEmail={customer.email}
            legacyPhone={customer.phone}
            disabled={!commercial}
            onSaved={refresh}
          />

          <Activity
            customerId={customerId}
            authorId={session?.session?.user.id ?? null}
            rows={data.activities}
            disabled={!commercial}
            onSaved={refresh}
          />

          <Deliveries rows={data.deliveries} />

          <Link
            to="/admin/venues/$venueId"
            params={{ venueId: customerId }}
            className="inline-block text-sm font-semibold"
          >
            {t("sales_open_venue")} →
          </Link>
        </div>
      )}
    </main>
  );
}

function FollowUp({
  customer,
  staff,
  disabled,
  onSaved,
}: {
  customer: {
    segment: CustomerSegment | null;
    sales_owner_id: string | null;
    next_follow_up_on: string | null;
    notes: string | null;
    address: string | null;
    delivery_address: string | null;
    city: string | null;
  };
  staff: { id: string; fullName: string; username: string }[];
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const { customerId } = Route.useParams();
  const { t } = useI18n();
  const [segment, setSegment] = useState<CustomerSegment | "">(customer.segment ?? "");
  const [owner, setOwner] = useState(customer.sales_owner_id ?? "");
  const [followUp, setFollowUp] = useState(customer.next_follow_up_on ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [deliveryAddress, setDeliveryAddress] = useState(customer.delivery_address ?? "");
  const [city, setCity] = useState(customer.city ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSegment(customer.segment ?? "");
    setOwner(customer.sales_owner_id ?? "");
    setFollowUp(customer.next_follow_up_on ?? "");
    setNotes(customer.notes ?? "");
    setAddress(customer.address ?? "");
    setDeliveryAddress(customer.delivery_address ?? "");
    setCity(customer.city ?? "");
  }, [customer]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    const { error } = await supabase
      .from("customers")
      .update({
        segment: segment || null,
        sales_owner_id: owner || null,
        next_follow_up_on: followUp || null,
        notes: notes.trim() || null,
        address: address.trim() || null,
        delivery_address: deliveryAddress.trim() || null,
        city: city.trim() || null,
      })
      .eq("id", customerId);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    await onSaved();
  }

  return (
    <form className="space-y-4" onSubmit={save}>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("sales_segment")}</span>
        <select
          className={fieldClass}
          value={segment}
          disabled={disabled}
          onChange={(event) => setSegment(event.target.value as CustomerSegment | "")}
        >
          <option value="">{t("sales_segment_none")}</option>
          {CUSTOMER_SEGMENTS.map((option) => (
            <option key={option} value={option}>
              {t(SEGMENT_KEY[option])}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("sales_owner")}</span>
        <select
          className={fieldClass}
          value={owner}
          disabled={disabled}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="">—</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName || person.username}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("sales_next_followup")}</span>
        <input
          className={fieldClass}
          type="date"
          value={followUp}
          disabled={disabled}
          onChange={(event) => setFollowUp(event.target.value)}
        />
      </label>
      <TextField label={t("city")} value={city} onChange={setCity} />
      <TextField label={t("address")} value={address} onChange={setAddress} />
      <TextField
        label={t("delivery_address")}
        value={deliveryAddress}
        onChange={setDeliveryAddress}
      />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("notes")}</span>
        <TextAreaField value={notes} onChange={setNotes} />
      </label>
      {disabled ? null : (
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "…" : t("sales_follow_up")}
        </PrimaryButton>
      )}
    </form>
  );
}

function Operations({
  customer,
  supplierName,
  loginCount,
  parentName,
  onReady,
  disabled,
}: {
  customer: {
    active: boolean;
    partnership_level: "gold_partner" | "gold_supply" | null;
    supplied_by_customer_id: string | null;
    sales_status: SalesStatus | null;
    commercial_ready_at: string | null;
    delivery_address: string | null;
    address: string | null;
    legal_entity_id: string | null;
    billing_legal_entity_id: string | null;
  };
  supplierName: string | null;
  loginCount: number;
  parentName: string | null;
  onReady: () => Promise<void>;
  disabled: boolean;
}) {
  const { customerId } = Route.useParams();
  const { t, lang } = useI18n();
  const site = toSite(customer, loginCount > 0);
  const gaps = activationGaps(site);
  const channel = activationChannel(site);

  async function markReady() {
    const next = withCommercialReady(site, new Date().toISOString());
    if ("gaps" in next) return;
    const { error } = await supabase
      .from("customers")
      .update(commercialReadyPatch(next.commercialReadyAt))
      .eq("id", customerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await onReady();
  }

  async function clearReady() {
    const { error } = await supabase
      .from("customers")
      .update(commercialReadyPatch(null))
      .eq("id", customerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await onReady();
  }

  return (
    <section className="surface-card space-y-3 p-5">
      <h2 className="text-lg font-semibold">{t("sales_ready")}</h2>
      <p className="text-sm text-muted-foreground">{t("sales_ready_hint")}</p>
      <p className="text-sm">
        {t("sales_operations")}: {customer.active ? t("active") : t("inactive")}
        {" · "}
        {partnershipLabel(customer.partnership_level, t) ?? t("partnership_none")}
        {" · "}
        {channel === "via_wholesaler"
          ? `${t("supplied_via")} ${supplierName ?? "—"}`
          : t("sales_channel_direct")}
      </p>
      <p className="text-sm">
        {t("sales_login")}: {loginCount > 0 ? t("sales_login_yes") : t("sales_login_no")}.{" "}
        {t("sales_login_separate")}
      </p>
      {parentName ? (
        <p className="text-sm text-muted-foreground">
          {t("legal_entity")}: {parentName}
        </p>
      ) : null}
      {customer.commercial_ready_at ? (
        <p className="text-sm">
          {t("sales_ready_since")} {formatDate(customer.commercial_ready_at, lang)}
        </p>
      ) : null}
      {gaps.length > 0 ? (
        <ul className="text-sm">
          {gaps.map((gap) => (
            <li key={gap}>{t(GAP_KEY[gap])}</li>
          ))}
        </ul>
      ) : null}
      {disabled ? null : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <PrimaryButton onClick={() => void markReady()} disabled={gaps.length > 0}>
            {t("sales_ready_mark")}
          </PrimaryButton>
          {customer.commercial_ready_at ? (
            <button
              type="button"
              onClick={() => void clearReady()}
              className="text-sm font-semibold"
            >
              {t("sales_ready_clear")}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Contacts({
  customerId,
  siteContacts,
  groupContacts,
  legalEntityId,
  parentLegalEntityId,
  parentName,
  legacyContact,
  legacyEmail,
  legacyPhone,
  disabled,
  onSaved,
}: {
  customerId: string;
  siteContacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
  }[];
  groupContacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    legal_entity_id: string | null;
  }[];
  legalEntityId: string | null;
  parentLegalEntityId: string | null;
  parentName: string | null;
  legacyContact: string | null;
  legacyEmail: string | null;
  legacyPhone: string | null;
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const owner = purchasingContactOwner({ legalEntityId, parentLegalEntityId });

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const { error } = await supabase.from("customer_contacts").insert({
      customer_id: customerId,
      legal_entity_id: null,
      name,
      email: String(form.get("email") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      role: String(form.get("role") ?? "").trim() || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    event.currentTarget.reset();
    await onSaved();
  }

  async function addGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ("gap" in owner) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const { error } = await supabase.from("customer_contacts").insert({
      customer_id: null,
      legal_entity_id: owner.legalEntityId,
      name,
      email: String(form.get("email") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      role: String(form.get("role") ?? "").trim() || "purchasing",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    event.currentTarget.reset();
    await onSaved();
  }

  async function copyLegacy() {
    if (!legacyContact?.trim()) return;
    const { error } = await supabase.from("customer_contacts").insert({
      customer_id: customerId,
      legal_entity_id: null,
      name: legacyContact.trim(),
      email: legacyEmail,
      phone: legacyPhone,
      role: "site",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await onSaved();
  }

  return (
    <section className="surface-card space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">{t("sales_site_contacts")}</h2>
        {siteContacts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("sales_no_contact")}</p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {siteContacts.map((contact) => (
            <li key={contact.id} className="text-sm">
              <span className="font-semibold">{contact.name}</span>
              {contact.role ? ` · ${contact.role}` : ""}
              {contact.email ? ` · ${contact.email}` : ""}
              {contact.phone ? ` · ${contact.phone}` : ""}
            </li>
          ))}
        </ul>
        {legacyContact && siteContacts.length === 0 ? (
          <div className="mt-3 text-sm">
            <p className="text-muted-foreground">
              {t("sales_legacy_contact")}: {legacyContact}
            </p>
            {disabled ? null : (
              <button
                type="button"
                className="mt-2 font-semibold"
                onClick={() => void copyLegacy()}
              >
                {t("sales_copy_contact")}
              </button>
            )}
          </div>
        ) : null}
        {disabled ? null : <ContactForm onSubmit={addSite} />}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{t("sales_group_contacts")}</h2>
        {"gap" in owner ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("sales_group_contact_needs_entity")}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("sales_group_contact_target")} {parentName ?? owner.legalEntityId}
          </p>
        )}
        <ul className="mt-2 space-y-2">
          {groupContacts.map((contact) => (
            <li key={contact.id} className="text-sm">
              <span className="font-semibold">{contact.name}</span>
              {contact.role ? ` · ${contact.role}` : ""}
              {contact.email ? ` · ${contact.email}` : ""}
              {contact.phone ? ` · ${contact.phone}` : ""}
            </li>
          ))}
        </ul>
        {disabled || "gap" in owner ? null : <ContactForm onSubmit={addGroup} />}
      </div>
    </section>
  );
}

function ContactForm({
  onSubmit,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void onSubmit(event)}>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("contact_name")}</span>
        <input name="name" className={fieldClass} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("sales_role")}</span>
        <input name="role" className={fieldClass} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("email")}</span>
        <input name="email" type="email" className={fieldClass} />
      </label>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("phone")}</span>
        <input name="phone" className={fieldClass} />
      </label>
      <div className="sm:col-span-2">
        <PrimaryButton type="submit">{t("sales_add_contact")}</PrimaryButton>
      </div>
    </form>
  );
}

function Activity({
  customerId,
  authorId,
  rows,
  disabled,
  onSaved,
}: {
  customerId: string;
  authorId: string | null;
  rows: { id: string; kind: CrmActivityKind; body: string; happened_at: string }[];
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<CrmActivityKind>("note");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("crm_activities").insert({
      customer_id: customerId,
      kind,
      body: body.trim(),
      created_by: authorId,
    });
    setBusy(false);
    if (error) {
      toast.error(errorMessage(error, t("sales_log")));
      return;
    }
    setBody("");
    await onSaved();
  }

  return (
    <section className="surface-card space-y-4 p-5">
      <h2 className="text-lg font-semibold">{t("sales_log")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sales_no_activity")}</p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <p className="text-xs text-muted-foreground">
              {t(ACTIVITY_KEY[row.kind])} · {formatDate(row.happened_at, lang)}
            </p>
            <p className="text-sm">{row.body}</p>
          </li>
        ))}
      </ul>
      {disabled ? null : (
        <form className="space-y-3" onSubmit={save}>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("sales_activity")}</span>
            <select
              className={fieldClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as CrmActivityKind)}
            >
              {CRM_ACTIVITY_KINDS.map((option) => (
                <option key={option} value={option}>
                  {t(ACTIVITY_KEY[option])}
                </option>
              ))}
            </select>
          </label>
          <TextAreaField value={body} onChange={setBody} />
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "…" : t("save")}
          </PrimaryButton>
        </form>
      )}
    </section>
  );
}

function Deliveries({
  rows,
}: {
  rows: {
    id: string;
    delivered_at: string;
    commercial_route: "direct" | "via_wholesaler";
    delivery_lines:
      | {
          quantity: number;
          gold_lot_id: string | null;
          product_name_snapshot: string;
          gold_lots: { lot_code: string } | { lot_code: string }[] | null;
        }[]
      | null;
    wholesaler: { name: string } | { name: string }[] | null;
  }[];
}) {
  const { t } = useI18n();
  return (
    <section className="surface-card space-y-3 p-5">
      <h2 className="text-lg font-semibold">{t("sales_deliveries")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sales_no_deliveries")}</p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((delivery) => {
          const wholesaler = one(delivery.wholesaler);
          return (
            <li key={delivery.id} className="text-sm">
              <p className="font-semibold">
                {delivery.delivered_at}
                {delivery.commercial_route === "via_wholesaler"
                  ? ` · ${t("supplied_via")} ${wholesaler?.name ?? "—"}`
                  : ""}
              </p>
              <ul className="mt-1 space-y-1">
                {(delivery.delivery_lines ?? []).map((line, index) => {
                  const lot = one(line.gold_lots);
                  return (
                    <li key={`${delivery.id}-${index}`}>
                      {line.product_name_snapshot} · {line.quantity} {t("pcs")} ·{" "}
                      {line.gold_lot_id && lot?.lot_code ? lot.lot_code : t("sales_missing_lot")}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function toSite(
  customer: {
    active: boolean;
    partnership_level: string | null;
    supplied_by_customer_id: string | null;
    sales_status: SalesStatus | null;
    commercial_ready_at: string | null;
    delivery_address: string | null;
    address: string | null;
    legal_entity_id: string | null;
    billing_legal_entity_id: string | null;
  },
  hasPortalLogin: boolean,
): DeliverySiteState {
  return {
    active: customer.active,
    partnershipLevel: customer.partnership_level,
    suppliedByCustomerId: customer.supplied_by_customer_id,
    salesStatus: customer.sales_status,
    commercialReadyAt: customer.commercial_ready_at,
    hasPortalLogin,
    deliveryAddress: customer.delivery_address,
    visitAddress: customer.address,
    legalEntityId: customer.legal_entity_id,
    billingLegalEntityId: customer.billing_legal_entity_id,
  };
}
