import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "no" | "en";

const STORAGE_KEY = "gos.lang";

const dict = {
  // Login
  login_title: { no: "Logg inn", en: "Sign in" },
  login_sub: {
    no: "Skiftrapportering for serveringssteder",
    en: "Shift reporting for serving venues",
  },
  username: { no: "Brukernavn", en: "Username" },
  password: { no: "Passord", en: "Password" },
  sign_in: { no: "LOGG INN", en: "SIGN IN" },
  signing_in: { no: "Logger inn …", en: "Signing in …" },
  login_failed: {
    no: "Feil brukernavn eller passord.",
    en: "Wrong username or password.",
  },
  login_missing: {
    no: "Fyll inn brukernavn og passord.",
    en: "Enter username and password.",
  },
  no_access: {
    no: "Kontoen din er ikke koblet til et serveringssted. Kontakt Gold of Sicily.",
    en: "Your account is not linked to a serving venue. Please contact Gold of Sicily.",
  },
  sign_out: { no: "Logg ut", en: "Sign out" },

  // Report
  report_title: { no: "60 SEKUNDERS SKIFTRAPPORT", en: "60 SECOND SHIFT REPORT" },
  q_delivery: { no: "Levering", en: "Delivery" },
  delivered_intro_1: { no: "Vi leverte", en: "We delivered" },
  delivered_intro_2: { no: "stk.", en: "pcs." },
  delivery_correct_q: {
    no: "Fikk dere riktig antall?",
    en: "Did you receive the correct quantity?",
  },
  no_delivery: {
    no: "Ingen levering registrert ennå.",
    en: "No delivery registered yet.",
  },
  yes: { no: "JA", en: "YES" },
  no: { no: "NEI", en: "NO" },
  actual_received_q: {
    no: "Hvor mange mottok dere faktisk?",
    en: "How many did you actually receive?",
  },
  q_sales: { no: "Salg", en: "Sales" },
  sold_q: { no: "Hvor mange ble solgt dette skiftet?", en: "How many were sold this shift?" },
  q_flavors: { no: "Smaker", en: "Flavors" },
  flavors_q: {
    no: "Hvor mange av hver smak ble solgt, og hva har dere igjen?",
    en: "How many of each flavor were sold, and how many are left?",
  },
  flavors_hint: {
    no: "Én linje per smak — som i pilotappen. Legg til smak om dere serverte flere.",
    en: "One line per flavor — same as the pilot app. Add a flavor if you served more.",
  },
  add_flavor: { no: "Legg til smak", en: "Add flavor" },
  remove_flavor: { no: "Fjern smak", en: "Remove flavor" },
  no_flavors_on_report: {
    no: "Ingen smaker valgt. Legg til minst én smak.",
    en: "No flavors selected. Add at least one flavor.",
  },
  flavors_this_week: { no: "Solgt per smak denne uken", en: "Sold per flavor this week" },
  flavors: { no: "Smaker", en: "Flavors" },
  total: { no: "Totalt", en: "Total" },
  q_stock: { no: "Lager nå", en: "Current stock" },
  stock_q: { no: "Hvor mange har dere igjen nå?", en: "How many are left now?" },
  q_feedback: { no: "Gjestenes tilbakemelding", en: "Guest feedback" },
  feedback_q: { no: "Hva sa gjestene?", en: "What did guests think?" },
  positive: { no: "Positivt", en: "Positive" },
  mixed: { no: "Blandet", en: "Mixed" },
  negative: { no: "Negativt", en: "Negative" },
  feedback_text_q: { no: "Noe vi burde vite?", en: "Anything we should know?" },
  optional: { no: "Valgfritt", en: "Optional" },
  q_prep: { no: "Tilberedning", en: "Preparation" },
  prep_q: { no: "Noen problemer med tilberedningen?", en: "Any preparation issues?" },
  prep_text_q: { no: "Hva skjedde?", en: "What happened?" },
  q_next: { no: "Neste behov", en: "Next requirement" },
  next_q: {
    no: "Hvor mange trenger dere til neste levering/helg?",
    en: "How many do you need for the next delivery/weekend?",
  },
  submit: { no: "SEND RAPPORT", en: "SUBMIT REPORT" },
  submitting: { no: "Sender …", en: "Sending …" },
  submit_error: {
    no: "Kunne ikke sende rapporten. Prøv igjen.",
    en: "Could not send the report. Please try again.",
  },
  success: { no: "Rapport mottatt. Takk.", en: "Report received. Thank you." },
  success_sub: {
    no: "Vi tar det videre herfra.",
    en: "We'll take it from here.",
  },
  new_report: { no: "Ny rapport", en: "New report" },

  // History
  history: { no: "Historikk", en: "History" },
  history_reports: { no: "Skiftrapporter", en: "Shift reports" },
  history_deliveries: { no: "Leveringer", en: "Deliveries" },
  history_empty: { no: "Ingenting registrert ennå.", en: "Nothing registered yet." },
  sold: { no: "Solgt", en: "Sold" },
  stock: { no: "Lager", en: "Stock" },
  next_need: { no: "Neste behov", en: "Next need" },
  pcs: { no: "stk", en: "pcs" },
  back_to_report: { no: "Til rapport", en: "To report" },

  // Admin
  dashboard: { no: "Oversikt", en: "Dashboard" },
  customers: { no: "Serveringssteder", en: "Venues" },
  reports: { no: "Rapporter", en: "Reports" },
  deliveries: { no: "Leveringer", en: "Deliveries" },
  sold_this_week: { no: "Solgt denne uken", en: "Sold this week" },
  stock_at_customers: { no: "Lager hos serveringssteder", en: "Stock at venues" },
  requested_next: { no: "Ønsket neste levering", en: "Requested next delivery" },
  awaiting_report: { no: "Venter på rapport", en: "Venues awaiting a report" },
  customer: { no: "Serveringssted", en: "Venue" },
  last_report: { no: "Siste rapport", en: "Last report" },
  current_stock: { no: "Lager nå", en: "Current stock" },
  next_requirement: { no: "Neste behov", en: "Next requirement" },
  status: { no: "Status", en: "Status" },
  overview: { no: "Oversikt", en: "Overview" },
  account: { no: "Konto", en: "Account" },
  new_customer: { no: "Nytt serveringssted", en: "New venue" },
  create_customer_missing: {
    no: "Navn på serveringssted, brukernavn (minst 3 tegn) og passord (minst 6 tegn) er påkrevd.",
    en: "Venue name, username (min 3) and password (min 6) are required.",
  },
  create_customer_username: {
    no: "Brukernavn må ha minst 3 bokstaver eller tall. Mellomrom og æøå blir gjort om automatisk.",
    en: "Username needs at least 3 letters or numbers. Spaces and æøå are converted automatically.",
  },
  create_customer_login_as: { no: "Innlogging som", en: "Signs in as" },
  create_customer_weak_password: {
    no: "Passordet er for vanlig. Velg et mer unikt passord.",
    en: "That password is too common. Choose a stronger one.",
  },
  create_customer_username_taken: {
    no: "Brukernavnet er opptatt.",
    en: "Username is already taken.",
  },
  create_customer_failed: {
    no: "Kunne ikke opprette serveringsstedet. Prøv igjen.",
    en: "Could not create the venue. Please try again.",
  },
  create_customer_created: { no: "opprettet", en: "created" },
  customer_name: { no: "Navn på serveringssted", en: "Venue name" },
  location: { no: "Sted", en: "Location" },
  language: { no: "Språk", en: "Language" },
  active: { no: "Aktiv", en: "Active" },
  inactive: { no: "Inaktiv", en: "Inactive" },
  save: { no: "Lagre", en: "Save" },
  create: { no: "Opprett", en: "Create" },
  cancel: { no: "Avbryt", en: "Cancel" },
  quantity: { no: "Antall", en: "Quantity" },
  date: { no: "Dato", en: "Date" },
  note: { no: "Notat", en: "Note" },
  register_delivery: { no: "Registrer levering", en: "Register delivery" },
  new_password: { no: "Nytt passord", en: "New password" },
  reset_password: { no: "Bytt passord", en: "Reset password" },
  needs_review: { no: "Til gjennomgang", en: "Needs review" },
  never: { no: "Aldri", en: "Never" },
  est_stock: { no: "Estimert lager", en: "Estimated stock" },
  latest_feedback: { no: "Siste tilbakemelding", en: "Latest guest feedback" },
  latest_prep_issue: { no: "Siste tilberedningsproblem", en: "Latest preparation issue" },
  none: { no: "Ingen", en: "None" },
  sales_this_week: { no: "Salg denne uken", en: "Sales this week" },
  no_customers: { no: "Ingen serveringssteder ennå.", en: "No venues yet." },
  today: { no: "I dag", en: "Today" },
  partners: { no: "Partnere", en: "Partners" },
  partner: { no: "Partner", en: "Partner" },
  new_partner: { no: "Ny partner", en: "New partner" },
  no_partners: { no: "Ingen partnere ennå.", en: "No partners yet." },
  partner_name: { no: "Partnernavn", en: "Partner name" },
  partner_kind: { no: "Type", en: "Type" },
  kind_distributor: { no: "Gold Supply", en: "Gold Supply" },
  kind_direct: { no: "Gold Partner", en: "Gold Partner" },
  kind_distributor_hint: {
    no: "Handelspartner / distributør — vi leverer, de forsyner serveringssteder.",
    en: "Trade partner / distributor — we supply them, they supply venues.",
  },
  kind_direct_hint: {
    no: "Direkte partner som også er serveringssted (f.eks. Oslo Bar).",
    en: "Direct partner that is also a serving venue (e.g. Oslo Bar).",
  },
  contact_name: { no: "Kontaktperson", en: "Contact" },
  email: { no: "E-post", en: "Email" },
  phone: { no: "Telefon", en: "Phone" },
  notes: { no: "Notat", en: "Notes" },
  venues_count: { no: "Aktive serveringssteder", en: "Active venues" },
  distributed_month: { no: "Distribuert denne måneden", en: "Distributed this month" },
  unassigned_partner: { no: "Uten partner", en: "No partner" },
  direct_partner_hint: {
    no: "Opprett som Gold Partner — både partner og serveringssted (f.eks. Oslo Bar).",
    en: "Create as a Gold Partner — both partner and serving venue (e.g. Oslo Bar).",
  },
  city: { no: "By / område", en: "City / area" },
  address: { no: "Adresse", en: "Address" },
  public_visible: { no: "Offentlig synlig på goldofsicily.no", en: "Public on goldofsicily.no" },
  public_yes: { no: "Ja, vis på Finn oss", en: "Yes, show on Find us" },
  public_no: { no: "Nei, kun internt", en: "No, internal only" },
  profile: { no: "Profil", en: "Profile" },
  menu: { no: "Meny", en: "Menu" },
  products: { no: "Smaker", en: "Flavors" },
  new_product: { no: "Ny smak", en: "New flavor" },
  no_products: { no: "Ingen smaker ennå.", en: "No flavors yet." },
  products_intro: {
    no: "Smakene som vises i skiftrapporten og på serveringsstedets meny. De rapporterer antall av hver.",
    en: "Flavors shown in the shift report and on the venue menu. Staff report counts for each.",
  },
  product_name_no: { no: "Navn (norsk)", en: "Name (Norwegian)" },
  product_name_en: { no: "Navn (engelsk)", en: "Name (English)" },
  sku: { no: "SKU", en: "SKU" },
  description: { no: "Beskrivelse", en: "Description" },
  price_guest: { no: "Pris til gjest (kr)", en: "Guest price (NOK)" },
  serving_method: { no: "Serveringsmetode", en: "Serving method" },
  website: { no: "Nettside", en: "Website" },
  instagram: { no: "Instagram", en: "Instagram" },
  image_url: { no: "Bilde-URL", en: "Image URL" },
  logo_url: { no: "Logo-URL", en: "Logo URL" },
  latitude: { no: "Breddegrad", en: "Latitude" },
  longitude: { no: "Lengdegrad", en: "Longitude" },
  menu_intro: { no: "Menytekst", en: "Menu intro" },
  add_to_menu: { no: "Legg på menyen", en: "Add to menu" },
  available: { no: "Tilgjengelig", en: "Available" },
  unavailable: { no: "Ikke tilgjengelig", en: "Unavailable" },
  remove: { no: "Fjern", en: "Remove" },
  dish_name: { no: "Navn på retten", en: "Dish name" },
  active_partners: { no: "Aktive partnere", en: "Active partners" },
  active_venues: { no: "Aktive serveringssteder", en: "Active venues" },
  quality_issues: { no: "Kvalitetsavvik", en: "Quality issues" },
  new_venues: { no: "Nye serveringssteder", en: "New venues" },
  venues_under: { no: "serveringssteder", en: "venues" },
  slug: { no: "Offentlig adresse (slug)", en: "Public slug" },
  linked_venues: { no: "Knyttede serveringssteder", en: "Linked venues" },
  no_linked_venues: { no: "Ingen serveringssteder knyttet ennå.", en: "No venues linked yet." },
  link_existing_venue: { no: "Knytt eksisterende serveringssted", en: "Link an existing venue" },
  link_existing_venue_hint: {
    no: "Velg et serveringssted og knytt det til denne partneren. Et sted kan flyttes fra en annen partner.",
    en: "Choose a venue and link it to this partner. A venue can be moved from another partner.",
  },
  no_venues_to_link: {
    no: "Alle serveringssteder er allerede knyttet hit.",
    en: "All venues are already linked here.",
  },
  choose_venue: { no: "Velg serveringssted", en: "Choose a venue" },
  choose_partner: { no: "Velg partner", en: "Choose a partner" },
  link_venue: { no: "Knytt serveringssted", en: "Link venue" },
  link_partner: { no: "Knytt til partner", en: "Link to partner" },
  unlink_venue: { no: "Fjern knytning", en: "Unlink" },
  unlink_partner: { no: "Fjern partner", en: "Remove partner" },
  new_venue_under_partner: {
    no: "Nytt serveringssted under denne partneren",
    en: "New venue under this partner",
  },
  link_saved: { no: "Knytning lagret", en: "Link saved" },
  link_removed: { no: "Knytning fjernet", en: "Link removed" },
  open_partner: { no: "Åpne partner", en: "Open partner" },
  partner_link_intro: {
    no: "Knytt dette serveringsstedet til en Gold Supply eller Gold Partner.",
    en: "Link this venue to a Gold Supply or Gold Partner.",
  },
  make_gold_partner: { no: "Opprett som Gold Partner", en: "Create as Gold Partner" },
  make_gold_partner_hint: {
    no: "Lager en Gold Partner med samme navn og knytter dette serveringsstedet.",
    en: "Creates a Gold Partner with the same name and links this venue.",
  },
  now_with: { no: "nå", en: "now" },
  currently_unassigned: { no: "ikke knyttet", en: "unassigned" },
  attach_venues_hint: {
    no: "Knytt eksisterende serveringssteder (valgfritt)",
    en: "Link existing venues (optional)",
  },
  creating_under_partner: { no: "Knyttes til", en: "Will be linked to" },
} satisfies Record<string, Record<Lang, string>>;

export type TranslationKey = keyof typeof dict;

type Ctx = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("no");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "no" || stored === "en") setLangState(stored);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: TranslationKey) => dict[key][lang], [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
