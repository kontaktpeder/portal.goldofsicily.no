import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { parseGuestPriceOre } from "@/lib/slug";
import { isUniqueMenuItemConflict, nextAvailableProductId } from "@/lib/venue-menu-item";
import { formatDate } from "@/lib/sign-out";
import { errorMessage } from "@/lib/utils";
import { resetCustomerPassword } from "@/lib/admin.functions";
import { PrimaryButton, TextAreaField, TextField } from "@/components/field";
import { MenuFileUpload } from "@/components/menu-file-upload";
import { DeliveryFlavorBreakdown, FlavorBreakdown } from "@/components/flavor-lines";
import { VenuePartnerCard } from "@/components/partner-venue-link";
import type { StoredDeliveryLine, StoredFlavorLine } from "@/lib/flavors";

export const Route = createFileRoute("/_authenticated/admin/venues/$venueId")({
  head: () => ({
    meta: [
      { title: "Serveringssted — Gold of Sicily admin" },
      {
        name: "description",
        content: "Stock, sales, feedback, deliveries and account settings for one partner venue.",
      },
      { property: "og:title", content: "Customer detail — Gold of Sicily admin" },
      {
        property: "og:description",
        content: "Stock, sales, feedback, deliveries and account settings for a partner venue.",
      },
    ],
  }),
  component: CustomerDetail,
});

type Tab = "overview" | "reports" | "deliveries" | "profile" | "menu" | "account";

function CustomerDetail() {
  const { venueId } = Route.useParams();
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const { data } = useQuery({
    queryKey: ["venue-detail", venueId],
    queryFn: async () => {
      const [customer, reports, deliveriesRes, profile, menu, products, partners] = await Promise.all([
        supabase
          .from("venues")
          .select("*, partners(id, name)")
          .eq("id", venueId)
          .maybeSingle(),
        supabase
          .from("shift_reports")
          .select(
            "*, shift_report_lines(product_id, sold, remaining_stock, next_required_quantity, products(name_no, name_en))",
          )
          .eq("venue_id", venueId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("deliveries")
          .select("*, delivery_lines(product_id, quantity, products(name_no, name_en))")
          .eq("venue_id", venueId)
          .order("delivered_at", { ascending: false })
          .limit(100),
        supabase
          .from("profiles")
          .select("id, username, preferred_language")
          .eq("venue_id", venueId)
          .maybeSingle(),
        supabase
          .from("venue_menu_items")
          .select("*, products(*)")
          .eq("venue_id", venueId)
          .order("sort_order"),
        supabase.from("products").select("*").eq("active", true).order("sort_order"),
        supabase.from("partners").select("id, name, kind, active").order("name"),
      ]);
      const deliveries = deliveriesRes.error
        ? await supabase
            .from("deliveries")
            .select("*")
            .eq("venue_id", venueId)
            .order("delivered_at", { ascending: false })
            .limit(100)
        : deliveriesRes;
      return {
        customer: customer.data,
        reports: reports.data ?? [],
        deliveries: deliveries.data ?? [],
        profile: profile.data,
        menu: menu.data ?? [],
        products: products.data ?? [],
        partners: partners.data ?? [],
      };
    },
  });

  const linkedPartner =
    data?.partners.find((partner) => partner.id === data.customer?.partner_id) ?? null;
  const latest = data?.reports[0] ?? null;
  const weekStart = (() => {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - day);
    return monday.toISOString();
  })();
  const soldThisWeek = (data?.reports ?? [])
    .filter((report) => report.created_at >= weekStart)
    .reduce((sum, report) => sum + report.sold_this_shift, 0);
  const deliveredSince = (data?.deliveries ?? [])
    .filter((delivery) => !latest || delivery.created_at > latest.created_at)
    .reduce((sum, delivery) => sum + delivery.quantity, 0);
  const estimated = (latest?.remaining_stock ?? 0) + deliveredSince;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-16">
      <div className="pt-6">
        <Link
          to="/admin/venues"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("customers")}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold">{data?.customer?.name ?? "—"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {linkedPartner?.name ?? t("unassigned_partner")} ·{" "}
          {data?.customer?.city || data?.customer?.location || "—"} ·{" "}
          {data?.customer?.active ? t("active") : t("inactive")}
          {data?.customer?.public_visible ? ` · ${t("public_yes")}` : ""}
          {data?.customer?.public_profile === "partner"
            ? ` · ${t("public_profile_partner")}`
            : ""}
        </p>
      </div>

      <div className="mt-6 flex gap-1 overflow-x-auto">
        {(["overview", "reports", "deliveries", "profile", "menu", "account"] as Tab[]).map(
          (option) => (
            <button
              key={option}
              onClick={() => setTab(option)}
              className={`rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap ${
                tab === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(option)}
            </button>
          ),
        )}
      </div>

      {tab === "overview" && data?.customer ? (
        <div className="mt-5 space-y-4">
          <VenuePartnerCard
            venueId={venueId}
            venueName={data.customer.name}
            partnerId={data.customer.partner_id}
            partners={data.partners}
            onChanged={() => queryClient.invalidateQueries()}
          />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Info label={t("est_stock")} value={`${estimated} ${t("pcs")}`} />
            <Info label={t("stock")} value={`${latest?.remaining_stock ?? 0} ${t("pcs")}`} />
            <Info label={t("sales_this_week")} value={`${soldThisWeek} ${t("pcs")}`} />
            <Info
              label={t("latest_feedback")}
              value={latest?.guest_feedback_rating ? t(latest.guest_feedback_rating) : t("none")}
              detail={latest?.guest_feedback_text ?? undefined}
            />
            <Info
              label={t("latest_prep_issue")}
              value={latest?.preparation_issue ? t("yes") : t("none")}
              detail={latest?.preparation_issue_text ?? undefined}
            />
            <Info
              label={t("requested_next")}
              value={`${latest?.next_required_quantity ?? 0} ${t("pcs")}`}
            />
            <Info
              label={t("last_report")}
              value={latest ? formatDate(latest.created_at, lang) : t("never")}
            />
          </div>
        </div>
      ) : null}

      {tab === "reports" ? (
        <div className="mt-5 space-y-3">
          {(data?.reports ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
          ) : (
            data?.reports.map((report) => (
              <article key={report.id} className="surface-card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">{formatDate(report.created_at, lang)}</p>
                  {report.guest_feedback_rating ? (
                    <span className="text-xs text-muted-foreground">
                      {t(report.guest_feedback_rating)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <span>
                    {t("sold")}: <strong className="tabular-nums">{report.sold_this_shift}</strong>
                  </span>
                  <span>
                    {t("stock")}: <strong className="tabular-nums">{report.remaining_stock}</strong>
                  </span>
                  <span>
                    {t("next_need")}:{" "}
                    <strong className="tabular-nums">{report.next_required_quantity ?? "—"}</strong>
                  </span>
                </div>
                <FlavorBreakdown lines={report.shift_report_lines as StoredFlavorLine[] | null} />
                {report.needs_review ? (
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/15 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      <strong>{t("needs_review")}.</strong> {report.review_note}
                    </span>
                  </p>
                ) : null}
              </article>
            ))
          )}
        </div>
      ) : null}

      {tab === "deliveries" ? (
        <div className="mt-5 space-y-3">
          {(data?.deliveries ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
          ) : (
            data?.deliveries.map((delivery) => (
              <article key={delivery.id} className="surface-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{formatDate(delivery.delivered_at, lang)}</p>
                    {delivery.note ? (
                      <p className="text-xs text-muted-foreground">{delivery.note}</p>
                    ) : null}
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {delivery.quantity} <span className="text-xs font-normal">{t("pcs")}</span>
                  </p>
                </div>
                <DeliveryFlavorBreakdown
                  lines={
                    "delivery_lines" in delivery
                      ? (delivery.delivery_lines as StoredDeliveryLine[])
                      : null
                  }
                />
              </article>
            ))
          )}
        </div>
      ) : null}

      {tab === "profile" && data?.customer ? (
        <div className="mt-5 space-y-4">
          <VenuePartnerCard
            venueId={venueId}
            venueName={data.customer.name}
            partnerId={data.customer.partner_id}
            partners={data.partners}
            onChanged={() => queryClient.invalidateQueries()}
          />
          <ProfileTab
            customer={data.customer}
            onSaved={() => queryClient.invalidateQueries()}
          />
        </div>
      ) : null}

      {tab === "menu" && data?.customer ? (
        <MenuTab
          customerId={venueId}
          menu={data.menu}
          products={data.products}
          menuMaterialPath={data.customer.menu_material_path ?? null}
          menuMaterialUrl={data.customer.menu_material_url ?? null}
          onSaved={() => queryClient.invalidateQueries()}
        />
      ) : null}

      {tab === "account" && data?.customer ? (
        <AccountTab
          customer={data.customer}
          profile={data.profile ?? null}
          onSaved={() => queryClient.invalidateQueries()}
        />
      ) : null}
    </main>
  );
}

function Info({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="surface-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">“{detail}”</p> : null}
    </div>
  );
}

function AccountTab({
  customer,
  profile,
  onSaved,
}: {
  customer: {
    id: string;
    name: string;
    location: string | null;
    active: boolean;
    default_language: string;
  };
  profile: { id: string; username: string; preferred_language: string } | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const resetPassword = useServerFn(resetCustomerPassword);
  const [name, setName] = useState(customer.name);
  const [location, setLocation] = useState(customer.location ?? "");
  const [active, setActive] = useState(customer.active);
  const [language, setLanguage] = useState<"no" | "en">(
    customer.default_language === "en" ? "en" : "no",
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(customer.name);
    setLocation(customer.location ?? "");
    setActive(customer.active);
  }, [customer]);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("venues")
      .update({
        name,
        location: location.trim() || null,
        active,
        default_language: language,
      })
      .eq("id", customer.id);
    if (!error && profile) {
      await supabase.from("profiles").update({ preferred_language: language }).eq("id", profile.id);
    }
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    onSaved();
  }

  async function changePassword() {
    if (!profile || password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ data: { userId: profile.id, password } });
      toast.success(t("reset_password"));
      setPassword("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not change password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="surface-card space-y-4 p-5">
        <TextField label={t("customer_name")} value={name} onChange={setName} />
        <TextField label={t("location")} value={location} onChange={setLocation} />
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
        <button
          type="button"
          onClick={() => setActive((value) => !value)}
          className="flex items-center gap-3 text-sm font-medium"
        >
          <span
            className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${
              active ? "bg-success" : "bg-muted"
            }`}
          >
            <span
              className={`size-5 rounded-full bg-card transition-transform ${
                active ? "translate-x-5" : ""
              }`}
            />
          </span>
          {active ? t("active") : t("inactive")}
        </button>
        <PrimaryButton onClick={save} disabled={busy}>
          {t("save")}
        </PrimaryButton>
      </div>

      <div className="surface-card space-y-4 p-5">
        <div>
          <span className="eyebrow block">{t("username")}</span>
          <p className="mt-1 text-lg font-semibold">{profile?.username ?? "—"}</p>
        </div>
        <TextField label={t("new_password")} value={password} onChange={setPassword} />
        <PrimaryButton onClick={changePassword} disabled={busy || !profile}>
          {t("reset_password")}
        </PrimaryButton>
      </div>
    </div>
  );
}

type VenueProfile = {
  id: string;
  name: string;
  location: string | null;
  city: string | null;
  address: string | null;
  slug: string | null;
  partner_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website_url: string | null;
  instagram: string | null;
  image_url: string | null;
  logo_url: string | null;
  serving_method: string | null;
  menu_intro: string | null;
  latitude: number | null;
  longitude: number | null;
  public_visible: boolean;
  public_profile?: "partner" | "listing" | null;
  collaboration_text?: string | null;
  serving_story?: string | null;
  video_url?: string | null;
  menu_material_path?: string | null;
  menu_material_url?: string | null;
  gallery_urls?: string[] | null;
};

function ProfileTab({
  customer,
  onSaved,
}: {
  customer: VenueProfile;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: customer.name,
    city: customer.city ?? "",
    address: customer.address ?? "",
    location: customer.location ?? "",
    slug: customer.slug ?? "",
    contact: customer.contact_name ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    website: customer.website_url ?? "",
    instagram: customer.instagram ?? "",
    imageUrl: customer.image_url ?? "",
    logoUrl: customer.logo_url ?? "",
    servingMethod: customer.serving_method ?? "",
    menuIntro: customer.menu_intro ?? "",
    latitude: customer.latitude?.toString() ?? "",
    longitude: customer.longitude?.toString() ?? "",
    publicVisible: customer.public_visible,
    publicProfile: customer.public_profile === "partner" ? "partner" : "listing",
    collaborationText: customer.collaboration_text ?? "",
    servingStory: customer.serving_story ?? "",
    videoUrl: customer.video_url ?? "",
    galleryUrls: (customer.gallery_urls ?? []).join("\n"),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: customer.name,
      city: customer.city ?? "",
      address: customer.address ?? "",
      location: customer.location ?? "",
      slug: customer.slug ?? "",
      contact: customer.contact_name ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      website: customer.website_url ?? "",
      instagram: customer.instagram ?? "",
      imageUrl: customer.image_url ?? "",
      logoUrl: customer.logo_url ?? "",
      servingMethod: customer.serving_method ?? "",
      menuIntro: customer.menu_intro ?? "",
      latitude: customer.latitude?.toString() ?? "",
      longitude: customer.longitude?.toString() ?? "",
      publicVisible: customer.public_visible,
      publicProfile: customer.public_profile === "partner" ? "partner" : "listing",
      collaborationText: customer.collaboration_text ?? "",
      servingStory: customer.serving_story ?? "",
      videoUrl: customer.video_url ?? "",
      galleryUrls: (customer.gallery_urls ?? []).join("\n"),
    });
  }, [customer]);

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("venues")
      .update({
        name: form.name.trim(),
        city: form.city.trim() || null,
        address: form.address.trim() || null,
        location: form.location.trim() || form.city.trim() || null,
        slug: form.slug.trim() || null,
        contact_name: form.contact.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        website_url: form.website.trim() || null,
        instagram: form.instagram.trim() || null,
        image_url: form.imageUrl.trim() || null,
        logo_url: form.logoUrl.trim() || null,
        serving_method: form.servingMethod.trim() || null,
        menu_intro: form.menuIntro.trim() || null,
        latitude: form.latitude.trim() ? Number(form.latitude) : null,
        longitude: form.longitude.trim() ? Number(form.longitude) : null,
        public_visible: form.publicVisible,
        public_profile: form.publicProfile === "partner" ? "partner" : "listing",
        collaboration_text: form.collaborationText.trim() || null,
        serving_story: form.servingStory.trim() || null,
        video_url: form.videoUrl.trim() || null,
        gallery_urls: form.galleryUrls
          .split("\n")
          .map((url) => url.trim())
          .filter(Boolean),
      })
      .eq("id", customer.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("save"));
    onSaved();
  }

  return (
    <div className="surface-card space-y-4 p-5">
      <TextField
        label={t("customer_name")}
        value={form.name}
        onChange={(value) => patch("name", value)}
      />
      <TextField label={t("city")} value={form.city} onChange={(value) => patch("city", value)} />
      <TextField
        label={t("address")}
        value={form.address}
        onChange={(value) => patch("address", value)}
      />
      <TextField label={t("slug")} value={form.slug} onChange={(value) => patch("slug", value)} />
      <TextField
        label={t("contact_name")}
        value={form.contact}
        onChange={(value) => patch("contact", value)}
      />
      <TextField
        label={t("phone")}
        value={form.phone}
        onChange={(value) => patch("phone", value)}
      />
      <TextField
        label={t("email")}
        value={form.email}
        onChange={(value) => patch("email", value)}
      />
      <TextField
        label={t("website")}
        value={form.website}
        onChange={(value) => patch("website", value)}
      />
      <TextField
        label={t("instagram")}
        value={form.instagram}
        onChange={(value) => patch("instagram", value)}
      />
      <TextField
        label={t("image_url")}
        value={form.imageUrl}
        onChange={(value) => patch("imageUrl", value)}
      />
      <TextField
        label={t("logo_url")}
        value={form.logoUrl}
        onChange={(value) => patch("logoUrl", value)}
      />
      <TextField
        label={t("serving_method")}
        value={form.servingMethod}
        onChange={(value) => patch("servingMethod", value)}
      />
      <label className="block">
        <span className="eyebrow mb-2 block">{t("menu_intro")}</span>
        <TextAreaField value={form.menuIntro} onChange={(value) => patch("menuIntro", value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={t("latitude")}
          value={form.latitude}
          onChange={(value) => patch("latitude", value)}
        />
        <TextField
          label={t("longitude")}
          value={form.longitude}
          onChange={(value) => patch("longitude", value)}
        />
      </div>
      <button
        type="button"
        onClick={() => patch("publicVisible", !form.publicVisible)}
        className="flex items-center gap-3 text-sm font-medium"
      >
        <span
          className={`flex h-7 w-12 items-center rounded-full p-1 ${form.publicVisible ? "bg-success" : "bg-muted"}`}
        >
          <span
            className={`size-5 rounded-full bg-card transition-transform ${form.publicVisible ? "translate-x-5" : ""}`}
          />
        </span>
        {form.publicVisible ? t("public_yes") : t("public_no")}
      </button>
      <div>
        <span className="eyebrow mb-2 block">{t("public_profile")}</span>
        <p className="mb-3 text-sm text-muted-foreground">{t("public_profile_hint")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(["partner", "listing"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => patch("publicProfile", option)}
              className={`rounded-2xl px-4 py-3 text-left text-sm font-semibold ${
                form.publicProfile === option
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {option === "partner" ? t("public_profile_partner") : t("public_profile_listing")}
            </button>
          ))}
        </div>
      </div>
      {form.publicProfile === "partner" ? (
        <>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("collaboration_text")}</span>
            <TextAreaField
              value={form.collaborationText}
              onChange={(value) => patch("collaborationText", value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("serving_story")}</span>
            <TextAreaField
              value={form.servingStory}
              onChange={(value) => patch("servingStory", value)}
            />
          </label>
          <TextField
            label={t("video_url")}
            value={form.videoUrl}
            onChange={(value) => patch("videoUrl", value)}
          />
          <p className="text-sm text-muted-foreground">{t("menu_file_profile_hint")}</p>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("gallery_urls")}</span>
            <TextAreaField
              value={form.galleryUrls}
              onChange={(value) => patch("galleryUrls", value)}
            />
          </label>
        </>
      ) : null}
      <PrimaryButton onClick={save} disabled={busy}>
        {t("save")}
      </PrimaryButton>
    </div>
  );
}

type MenuRow = {
  id: string;
  product_id: string;
  display_name: string | null;
  description: string | null;
  price_ore: number | null;
  available: boolean;
  products: { name_no: string; slug: string } | null;
};

function MenuTab({
  customerId,
  menu,
  products,
  menuMaterialPath,
  menuMaterialUrl,
  onSaved,
}: {
  customerId: string;
  menu: MenuRow[];
  products: { id: string; name_no: string }[];
  menuMaterialPath: string | null;
  menuMaterialUrl: string | null;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const used = new Set(menu.map((item) => item.product_id));
  const availableProducts = products.filter((product) => !used.has(product.id));
  const [productId, setProductId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProductId((current) =>
      nextAvailableProductId(
        products,
        menu.map((item) => item.product_id),
        current,
      ),
    );
  }, [menu, products]);

  async function addItem() {
    if (!productId) return;
    setBusy(true);
    const payload = {
      display_name: displayName.trim() || null,
      price_ore: parseGuestPriceOre(price),
      available: true,
    };
    const existing = menu.find((item) => item.product_id === productId);
    let error = existing
      ? (
          await supabase.from("venue_menu_items").update(payload).eq("id", existing.id)
        ).error
      : (
          await supabase.from("venue_menu_items").insert({
            venue_id: customerId,
            product_id: productId,
            ...payload,
            sort_order: menu.length * 10,
          })
        ).error;

    if (!existing && isUniqueMenuItemConflict(error)) {
      const updated = await supabase
        .from("venue_menu_items")
        .update(payload)
        .eq("venue_id", customerId)
        .eq("product_id", productId);
      error = updated.error;
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(t("menu_item_updated"));
      setDisplayName("");
      setPrice("");
      onSaved();
      return;
    }

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDisplayName("");
    setPrice("");
    onSaved();
  }

  return (
    <div className="mt-5 space-y-4">
      <MenuFileUpload
        venueId={customerId}
        path={menuMaterialPath}
        url={menuMaterialUrl}
        onChanged={onSaved}
      />
      {menu.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("history_empty")}</p>
      ) : null}
      {menu.map((item) => (
        <MenuItemCard key={item.id} item={item} onSaved={onSaved} />
      ))}

      {availableProducts.length > 0 ? (
        <div className="surface-card space-y-4 p-5">
          <p className="font-semibold">{t("add_to_menu")}</p>
          <label className="block">
            <span className="eyebrow mb-2 block">{t("products")}</span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="h-13 w-full rounded-2xl border-2 border-border bg-card px-4 text-base outline-none focus:border-primary"
            >
              {availableProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name_no}
                </option>
              ))}
            </select>
          </label>
          <TextField label={t("dish_name")} value={displayName} onChange={setDisplayName} />
          <TextField
            label={t("price_guest")}
            value={price}
            onChange={setPrice}
            placeholder={t("price_guest_placeholder")}
          />
          <p className="text-sm text-muted-foreground">{t("price_guest_hint")}</p>
          <PrimaryButton onClick={addItem} disabled={busy || !productId}>
            {t("add_to_menu")}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}

function MenuItemCard({ item, onSaved }: { item: MenuRow; onSaved: () => void }) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(item.display_name ?? "");
  const [price, setPrice] = useState(item.price_ore == null ? "" : String(item.price_ore / 100));

  useEffect(() => {
    setDisplayName(item.display_name ?? "");
    setPrice(item.price_ore == null ? "" : String(item.price_ore / 100));
  }, [item]);

  async function save() {
    const { error } = await supabase
      .from("venue_menu_items")
      .update({
        display_name: displayName.trim() || null,
        price_ore: parseGuestPriceOre(price),
      })
      .eq("id", item.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("save"));
      onSaved();
    }
  }

  async function toggle() {
    const { error } = await supabase
      .from("venue_menu_items")
      .update({ available: !item.available })
      .eq("id", item.id);
    if (error) toast.error(error.message);
    else onSaved();
  }

  async function removeItem() {
    const { error } = await supabase.from("venue_menu_items").delete().eq("id", item.id);
    if (error) toast.error(error.message);
    else onSaved();
  }

  return (
    <article className="surface-card space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{item.display_name || item.products?.name_no}</p>
        <button
          type="button"
          onClick={toggle}
          className="text-xs font-semibold text-muted-foreground"
        >
          {item.available ? t("available") : t("unavailable")}
        </button>
      </div>
      <TextField label={t("dish_name")} value={displayName} onChange={setDisplayName} />
      <TextField
        label={t("price_guest")}
        value={price}
        onChange={setPrice}
        placeholder={t("price_guest_placeholder")}
      />
      <p className="text-sm text-muted-foreground">{t("price_guest_hint")}</p>
      <div className="flex gap-3">
        <PrimaryButton onClick={save}>{t("save")}</PrimaryButton>
      </div>
      <button type="button" onClick={removeItem} className="text-xs text-destructive">
        {t("remove")}
      </button>
    </article>
  );
}
