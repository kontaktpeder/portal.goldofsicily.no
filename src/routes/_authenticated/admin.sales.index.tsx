import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSessionInfo } from "@/hooks/use-session";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { listStaffAccounts } from "@/lib/admin.functions";
import { BrregSearch } from "@/components/brreg-search";
import { PrimaryButton, TextField } from "@/components/field";
import { errorMessage } from "@/lib/utils";
import {
  CUSTOMER_SEGMENTS,
  SALES_STATUSES,
  findDuplicateSite,
  matchesSalesFilter,
  newDeliverySiteRow,
  salesOverview,
  type CustomerSegment,
  type SalesStatus,
} from "@/lib/crm";

const fieldClass =
  "h-11 w-full rounded-2xl border-2 border-border bg-card px-3 text-sm outline-none focus:border-primary";

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

export const Route = createFileRoute("/_authenticated/admin/sales/")({
  head: () => ({
    meta: [
      { title: "Salg — Gold of Sicily" },
      { name: "description", content: "Sales follow-up for delivery sites." },
    ],
  }),
  component: SalesList,
});

function todayStamp() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return { today: `${now.getFullYear()}-${month}-${day}`, month: `${now.getFullYear()}-${month}` };
}

function SalesList() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSessionInfo();
  const listStaff = useServerFn(listStaffAccounts);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<CustomerSegment | "">("");
  const [status, setStatus] = useState<SalesStatus | "">("");
  const [ownerId, setOwnerId] = useState("");
  const [followUp, setFollowUp] = useState<"" | "due" | "none">("");

  const { today, month } = todayStamp();
  const sales = useQuery({
    queryKey: ["sales-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, name, city, segment, sales_status, sales_owner_id, next_follow_up_on, sales_status_changed_at, contact_name",
        )
        .eq("type", "venue")
        .not("sales_status", "is", null)
        .order("name");
      if (error) throw error;
      const ids = (data ?? []).map((row) => row.id);
      const contacts = ids.length
        ? await supabase
            .from("customer_contacts")
            .select("customer_id, name")
            .in("customer_id", ids)
            .order("created_at")
        : { data: [], error: null };
      if (contacts.error) throw contacts.error;
      const contactBySite = new Map<string, string>();
      for (const contact of contacts.data ?? []) {
        if (contact.customer_id && !contactBySite.has(contact.customer_id)) {
          contactBySite.set(contact.customer_id, contact.name);
        }
      }
      return (data ?? []).map((row) => ({
        ...row,
        contact: contactBySite.get(row.id) ?? row.contact_name,
      }));
    },
  });
  const staff = useQuery({
    queryKey: ["sales-staff"],
    queryFn: () => listStaff(),
  });

  const rows = useMemo(() => {
    return (sales.data ?? []).flatMap((row) => {
      if (!row.sales_status) return [];
      const contact = row.contact;
      return [
        {
          id: row.id,
          name: row.name,
          city: row.city,
          segment: row.segment,
          salesStatus: row.sales_status,
          salesOwnerId: row.sales_owner_id,
          nextFollowUpOn: row.next_follow_up_on,
          salesStatusChangedAt: row.sales_status_changed_at,
          contact,
        },
      ];
    });
  }, [sales.data]);

  const counts = salesOverview(rows, today, month);
  const visible = rows.filter((row) =>
    matchesSalesFilter(row, { query, segment, status, ownerId, followUp, today }),
  );
  const ownerName = new Map(
    (staff.data?.staff ?? []).map((person) => [person.id, person.fullName || person.username]),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="flex items-center justify-between pt-8">
        <h1 className="text-3xl font-semibold">{t("sales_title")}</h1>
        {session?.canManageCommercial ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="size-4" />
            {t("sales_add")}
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("sales_intro")}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Count label={t("sales_open_prospects")} value={counts.openProspects} />
        <Count label={t("sales_followups_due")} value={counts.followUpsDue} />
        <Count label={t("sales_tastings")} value={counts.tastings} />
        <Count label={t("sales_new_customers")} value={counts.newCustomersThisMonth} />
      </div>

      {open && session?.canManageCommercial ? (
        <AddSite
          ownerId={session.session?.user.id ?? null}
          onCreated={async (customerId) => {
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["sales-list"] });
            void navigate({ to: "/admin/sales/$customerId", params: { customerId } });
          }}
        />
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label={t("sales_search")} value={query} onChange={setQuery} />
        <Filter label={t("sales_filter_segment")} value={segment} onChange={setSegment}>
          <option value="">{t("sales_all")}</option>
          {CUSTOMER_SEGMENTS.map((option) => (
            <option key={option} value={option}>
              {t(SEGMENT_KEY[option])}
            </option>
          ))}
        </Filter>
        <Filter label={t("sales_filter_status")} value={status} onChange={setStatus}>
          <option value="">{t("sales_all")}</option>
          {SALES_STATUSES.map((option) => (
            <option key={option} value={option}>
              {t(STATUS_KEY[option])}
            </option>
          ))}
        </Filter>
        <Filter label={t("sales_filter_owner")} value={ownerId} onChange={setOwnerId}>
          <option value="">{t("sales_all")}</option>
          {(staff.data?.staff ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {person.fullName || person.username}
            </option>
          ))}
        </Filter>
        <Filter label={t("sales_filter_followup")} value={followUp} onChange={setFollowUp}>
          <option value="">{t("sales_followup_all")}</option>
          <option value="due">{t("sales_followup_due")}</option>
          <option value="none">{t("sales_followup_none")}</option>
        </Filter>
      </div>

      <div className="mt-6 space-y-3">
        {sales.error ? (
          <p className="text-sm text-destructive">{errorMessage(sales.error, t("sales_empty"))}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sales_empty")}</p>
        ) : (
          visible.map((row) => (
            <Link
              key={row.id}
              to="/admin/sales/$customerId"
              params={{ customerId: row.id }}
              className="surface-card flex items-center gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.segment ? t(SEGMENT_KEY[row.segment]) : t("sales_segment_none")}
                  {" · "}
                  {row.contact ?? "—"}
                  {" · "}
                  {t(STATUS_KEY[row.salesStatus])}
                  {" · "}
                  {row.nextFollowUpOn ?? "—"}
                  {row.salesOwnerId ? ` · ${ownerName.get(row.salesOwnerId) ?? ""}` : ""}
                  {row.city ? ` · ${row.city}` : ""}
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

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Filter<T extends string>({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-2 block">{label}</span>
      <select
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {children}
      </select>
    </label>
  );
}

function AddSite({
  ownerId,
  onCreated,
}: {
  ownerId: string | null;
  onCreated: (customerId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<CustomerSegment | "">("");
  const [city, setCity] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [active, setActive] = useState(false);
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  const [siblingCount, setSiblingCount] = useState<number | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { data: existing, error: existingError } = await supabase
        .from("customers")
        .select("id, name, city")
        .eq("type", "venue");
      if (existingError) throw existingError;
      const match = findDuplicateSite({ name, city }, existing ?? []);
      if (match && !confirmDuplicate) {
        setDuplicate({ id: match.id, name: match.name });
        setBusy(false);
        return;
      }
      const { data, error } = await supabase
        .from("customers")
        .insert(
          newDeliverySiteRow({
            name,
            segment: segment || null,
            city,
            deliveryAddress: "",
            active,
            salesOwnerId: ownerId,
            nextFollowUpOn: followUp || null,
            legalEntityId,
          }),
        )
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Could not create delivery site");
      if (contact.trim()) {
        const { error: contactError } = await supabase.from("customer_contacts").insert({
          customer_id: data.id,
          legal_entity_id: null,
          name: contact.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          role: "site",
        });
        if (contactError) throw contactError;
      }
      toast.success(name.trim());
      await onCreated(data.id);
    } catch (error) {
      toast.error(errorMessage(error, t("sales_empty")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface-card mt-5 space-y-4 p-5" onSubmit={submit}>
      <BrregSearch
        onPicked={async ({ legalEntityId: pickedId, hit }) => {
          setLegalEntityId(pickedId);
          if (!name.trim()) setName(hit.legalName);
          if (!city.trim() && hit.city) setCity(hit.city);
          const { count } = await supabase
            .from("customers")
            .select("id", { count: "exact", head: true })
            .eq("legal_entity_id", pickedId);
          setSiblingCount(count ?? 0);
        }}
      />
      {siblingCount ? (
        <p className="text-sm text-muted-foreground">{t("sales_same_legal_entity")}</p>
      ) : null}
      <TextField
        label={t("customer_name")}
        value={name}
        onChange={(value) => {
          setName(value);
          setDuplicate(null);
          setConfirmDuplicate(false);
        }}
      />
      <Filter label={t("sales_segment")} value={segment} onChange={setSegment}>
        <option value="">{t("sales_segment_none")}</option>
        {CUSTOMER_SEGMENTS.map((option) => (
          <option key={option} value={option}>
            {t(SEGMENT_KEY[option])}
          </option>
        ))}
      </Filter>
      <TextField
        label={t("city")}
        value={city}
        onChange={(value) => {
          setCity(value);
          setDuplicate(null);
          setConfirmDuplicate(false);
        }}
      />
      <TextField label={t("contact_name")} value={contact} onChange={setContact} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("phone")} value={phone} onChange={setPhone} />
        <TextField label={t("email")} value={email} onChange={setEmail} />
      </div>
      <label className="block">
        <span className="eyebrow mb-2 block">{t("sales_next_followup")}</span>
        <input
          className={fieldClass}
          type="date"
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
        />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        <span>
          <span className="font-semibold">{t("sales_in_operation")}</span>
          <span className="mt-1 block text-muted-foreground">{t("sales_in_operation_hint")}</span>
        </span>
      </label>
      {duplicate ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmDuplicate}
            onChange={(event) => setConfirmDuplicate(event.target.checked)}
          />
          <span>
            <span className="font-semibold">{t("sales_duplicate")}</span>
            <span className="mt-1 block text-muted-foreground">
              {duplicate.name}. {t("sales_duplicate_confirm")}
            </span>
          </span>
        </label>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? "…" : t("sales_add")}
      </PrimaryButton>
    </form>
  );
}
