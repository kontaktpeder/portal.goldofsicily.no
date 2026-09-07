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
  dashboard: { no: "Drift", en: "Ops" },
  customers: { no: "Serveringssteder", en: "Venues" },
  nav_venues: { no: "Steder", en: "Venues" },
  nav_products: { no: "Produkter", en: "Products" },
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
  public_profile: { no: "Offentlig profil", en: "Public profile" },
  public_profile_partner: { no: "Gold Partner", en: "Gold Partner" },
  public_profile_listing: { no: "Her serveres Gold", en: "Gold is served here" },
  public_profile_hint: {
    no: "Styrer hvor rik stedssiden blir. Ikke det samme som hvem som faktureres.",
    en: "Controls how rich the public venue page is. Separate from who is billed.",
  },
  collaboration_text: { no: "Kort tekst om samarbeidet", en: "Short collaboration text" },
  serving_story: { no: "Slik serverer de Gold", en: "How they serve Gold" },
  video_url: { no: "Video-URL", en: "Video URL" },
  menu_material_url: { no: "Menymateriell (bilde eller PDF)", en: "Menu material (image or PDF)" },
  menu_file: { no: "Last opp meny", en: "Upload menu" },
  menu_file_hint: {
    no: "PDF eller bilde, maks 50 MB. Filen får en offentlig URL og vises på goldofsicily.no.",
    en: "PDF or image, 50 MB max. The file gets a public URL and appears on goldofsicily.no.",
  },
  menu_file_drop: {
    no: "Slipp filen her, eller velg fra filer",
    en: "Drop a file here, or choose from files",
  },
  menu_file_choose: { no: "Velg fil", en: "Choose file" },
  menu_file_too_large: { no: "Filen er over 50 MB.", en: "The file is larger than 50 MB." },
  menu_file_bad_type: {
    no: "Bruk PDF, JPG, PNG eller WEBP.",
    en: "Use PDF, JPG, PNG or WEBP.",
  },
  menu_file_uploading: { no: "Laster opp …", en: "Uploading …" },
  menu_file_uploaded: { no: "Meny lastet opp", en: "Menu uploaded" },
  menu_file_removed: { no: "Meny fjernet", en: "Menu removed" },
  menu_file_public_url: { no: "Offentlig URL", en: "Public URL" },
  menu_file_copy: { no: "Kopier URL", en: "Copy URL" },
  menu_file_copied: { no: "URL kopiert", en: "URL copied" },
  menu_file_open: { no: "Åpne meny", en: "Open menu" },
  menu_file_remove: { no: "Fjern menyfil", en: "Remove menu file" },
  menu_file_profile_hint: {
    no: "Last opp menyfil under fanen Meny. Den vises på goldofsicily.no.",
    en: "Upload the menu file in the Menu tab. It appears on goldofsicily.no.",
  },
  gallery_urls: { no: "Galleri (én bilde-URL per linje)", en: "Gallery (one image URL per line)" },
  profile: { no: "Profil", en: "Profile" },
  menu: { no: "Meny", en: "Menu" },
  products: { no: "Smaker", en: "Flavors" },
  new_product: { no: "Ny smak", en: "New flavor" },
  no_products: { no: "Ingen smaker ennå.", en: "No flavors yet." },
  products_intro: {
    no: "Hver smak må ha navn på både norsk og engelsk. De vises i skiftrapporten, på leveringer og på menyen.",
    en: "Every flavor needs a name in both Norwegian and English. They appear in shift reports, deliveries and menus.",
  },
  product_name_no: { no: "Navn (norsk)", en: "Name (Norwegian)" },
  product_name_en: { no: "Navn (engelsk)", en: "Name (English)" },
  product_both_names: {
    no: "Skriv inn smaksnavn på både norsk og engelsk.",
    en: "Enter the flavor name in both Norwegian and English.",
  },
  product_desc_no: { no: "Beskrivelse (norsk)", en: "Description (Norwegian)" },
  product_desc_en: { no: "Beskrivelse (engelsk)", en: "Description (English)" },
  edit_product: { no: "Rediger smak", en: "Edit flavor" },
  delivery_qty_per_flavor: {
    no: "Antall per smak",
    en: "Quantity per flavor",
  },
  delivery_qty_hint: {
    no: "Skriv antall. Systemet velger nyeste åpne LOT med nok beholdning.",
    en: "Enter quantity. The system picks the newest open LOT with enough remaining stock.",
  },
  delivery_missing: {
    no: "Velg serveringssted og sett antall for minst én smak.",
    en: "Choose a venue and set a quantity for at least one flavor.",
  },
  delivery_no_products: {
    no: "Ingen aktive smaker. Registrer smaker med norsk og engelsk navn først.",
    en: "No active flavors. Register flavors with Norwegian and English names first.",
  },
  sku: { no: "SKU", en: "SKU" },
  description: { no: "Beskrivelse", en: "Description" },
  price_guest: { no: "Pris til gjest (kr, valgfritt)", en: "Guest price (NOK, optional)" },
  price_guest_placeholder: { no: "Valgfritt", en: "Optional" },
  price_guest_hint: {
    no: "La feltet stå tomt hvis prisen ikke skal vises på nettsiden.",
    en: "Leave empty if the price should not appear on the website.",
  },
  serving_method: { no: "Serveringsmetode", en: "Serving method" },
  website: { no: "Nettside", en: "Website" },
  instagram: { no: "Instagram", en: "Instagram" },
  image_url: { no: "Bilde-URL", en: "Image URL" },
  logo_url: { no: "Logo-URL", en: "Logo URL" },
  latitude: { no: "Breddegrad", en: "Latitude" },
  longitude: { no: "Lengdegrad", en: "Longitude" },
  menu_intro: { no: "Menytekst", en: "Menu intro" },
  add_to_menu: { no: "Legg på menyen", en: "Add to menu" },
  menu_item_updated: {
    no: "Smaken var allerede på menyen. Vi oppdaterte den.",
    en: "That flavor was already on the menu. We updated it.",
  },
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

  lots: { no: "LOT", en: "LOT" },
  lots_title: { no: "Gold-LOT", en: "Gold LOT" },
  lots_intro: {
    no: "Produksjon lager LOT. Levering bruker LOT. Registeret forklarer hvor varen kom fra og hvor den gikk.",
    en: "Production creates the LOT. Delivery uses the LOT. The register explains where the product came from and where it went.",
  },
  new_lot: { no: "Ny produksjon", en: "New production" },
  no_lots: { no: "Ingen Gold-LOT ennå.", en: "No Gold LOTs yet." },
  lot_code: { no: "LOT-kode", en: "LOT code" },
  lot_letter: { no: "LOT-bokstav", en: "LOT letter" },
  lot_letter_hint: {
    no: "Én bokstav i koden, f.eks. T for trøffel og N for nduja.",
    en: "One letter in the code, e.g. T for truffle and N for nduja.",
  },
  production_date: { no: "Produksjonsdato", en: "Production date" },
  produced_qty: { no: "Antall produsert", en: "Quantity produced" },
  carton_count: { no: "Kartonger", en: "Cartons" },
  produced_by: { no: "Produsert av", en: "Produced by" },
  lot_status: { no: "Status", en: "Status" },
  lot_status_produced: { no: "Produsert", en: "Produced" },
  lot_status_packed: { no: "Pakket", en: "Packed" },
  lot_status_handed_over: { no: "Overlevert", en: "Handed over" },
  lot_status_closed: { no: "Lukket", en: "Closed" },
  lot_status_recalled: { no: "Tilbakekalt", en: "Recalled" },
  deviation_notes: { no: "Avvik", en: "Deviations" },
  lot_missing: {
    no: "Velg smak og sett antall produsert.",
    en: "Choose a flavor and set quantity produced.",
  },
  lot_letter_missing: {
    no: "Smaken mangler LOT-bokstav. Sett den under Smaker først.",
    en: "This flavor has no LOT letter. Set it under Flavors first.",
  },
  lot_created: { no: "Gold-LOT opprettet", en: "Gold LOT created" },
  remaining_gold: { no: "Igjen hos Gold", en: "Remaining at Gold" },
  ingredients: { no: "Råvarer", en: "Ingredients" },
  ingredients_hint: {
    no: "Nødvendig: råvare og leverandør. Leverandørens eget LOT er ikke minimumskrav, men gjør tilbaketrekking presis. Fyll det inn fra dag én.",
    en: "Required: ingredient and supplier. The supplier LOT is not the legal minimum, but it makes recall precise. Capture it from day one.",
  },
  ingredient_name: { no: "Råvare", en: "Ingredient" },
  ingredient_supplier: { no: "Leverandør", en: "Supplier" },
  new_supplier: { no: "Ny leverandør", en: "New supplier" },
  supplier_lot: { no: "Leverandør-LOT", en: "Supplier LOT" },
  supplier_lot_hint: {
    no: "Svært fornuftig — lim inn LOT fra sekk, boks eller handelsdokument.",
    en: "Strongly recommended — paste the LOT from the bag, tub or trade document.",
  },
  quantity_used: { no: "Mengde", en: "Quantity used" },
  quantity_unit: { no: "Enhet", en: "Unit" },
  best_before: { no: "Best før", en: "Best before" },
  add_ingredient: { no: "Legg til råvare", en: "Add ingredient" },
  no_ingredients: {
    no: "Ingen råvarer registrert på denne batchen ennå.",
    en: "No ingredients recorded on this batch yet.",
  },
  handovers: { no: "Overlevering", en: "Handover" },
  handovers_hint: {
    no: "Ett ledd fremover: hvilken virksomhet som mottok ferdigvaren. Villa-mottaker, lagerplass og eierskap er driftsfelt.",
    en: "One step forward: which business received the finished product. Villa recipient, storage and ownership are operational fields.",
  },
  handover_qty: { no: "Antall overlevert", en: "Quantity handed over" },
  handover_at: { no: "Tidspunkt", en: "Handover time" },
  recipient_company: { no: "Mottaker (virksomhet)", en: "Recipient company" },
  recipient_person: { no: "Mottatt av", en: "Received by" },
  storage_location: { no: "Lagerplass", en: "Storage location" },
  ownership: { no: "Eierskap etter overlevering", en: "Ownership after handover" },
  ownership_gold: { no: "Gold-eid", en: "Gold-owned" },
  ownership_villa: { no: "Villa-eid", en: "Villa-owned" },
  add_handover: { no: "Registrer overlevering", en: "Record handover" },
  no_handovers: { no: "Ingen overlevering registrert.", en: "No handover recorded." },
  choose_recipient: { no: "Velg mottaker", en: "Choose recipient" },
  recipient_other: { no: "Annen virksomhet", en: "Other company" },
  venue_deliveries: { no: "Levert til serveringssted", en: "Delivered to venue" },
  no_venue_deliveries: {
    no: "Ingen portal-leveranser peker på denne Gold-LOT ennå.",
    en: "No portal deliveries point at this Gold LOT yet.",
  },
  recall: { no: "Tilbakekalling", en: "Recall" },
  recall_title: { no: "Tilbakekalling", en: "Recall" },
  recall_intro: {
    no: "Søk på Gold-LOT eller leverandør-LOT. Resultatet viser råvarer bakover og hvem som fikk varen fremover.",
    en: "Search a Gold LOT or a supplier LOT. The result shows ingredients backward and who received the product forward.",
  },
  recall_search: { no: "Søk LOT", en: "Search LOT" },
  recall_placeholder: {
    no: "L-20260907-T-01 eller TK882",
    en: "L-20260907-T-01 or TK882",
  },
  recall_empty: { no: "Ingen treff.", en: "No matches." },
  recall_kind_gold: { no: "Gold-LOT", en: "Gold LOT" },
  recall_kind_supplier: { no: "Leverandør-LOT", en: "Supplier LOT" },
  recall_contact: { no: "Må kontaktes", en: "Must be contacted" },
  delivery_lot: { no: "LOT", en: "LOT" },
  delivery_lot_hint: {
    no: "Velg hvilken Gold-LOT som gikk til stedet. Ikke lag en ny leveransebatch.",
    en: "Choose which Gold LOT went to the venue. Do not create a new delivery batch.",
  },
  delivery_lot_none: { no: "Ikke knyttet", en: "Not linked" },
  no_open_lots: {
    no: "Ingen Gold-LOT for denne smaken ennå.",
    en: "No Gold LOT for this flavor yet.",
  },
  no_active_lot_prefix: { no: "Ingen aktiv Gold-LOT for", en: "No active Gold LOT for" },
  create_lot_before_delivery: {
    no: "Opprett Gold-LOT før levering kan registreres.",
    en: "Create a Gold LOT before a delivery can be registered.",
  },
  create_lot: { no: "Opprett LOT", en: "Create LOT" },
  lot_available: { no: "tilgjengelig", en: "available" },
  lot_used: { no: "Brukt", en: "Used" },
  lot_remaining: { no: "Gjenværende", en: "Remaining" },
  split_lots: { no: "Fordel på flere LOT", en: "Split across LOTs" },
  split_lots_hint: {
    no: "Ingen enkelt LOT dekker antallet. Fordel på flere LOT, eller reduser antallet.",
    en: "No single LOT covers this quantity. Split across LOTs, or reduce the quantity.",
  },
  unsplit_lots: { no: "Samle til ett LOT", en: "Combine into one LOT" },
  delivery_lot_required: {
    no: "Ingen leveringslinje med antall kan lagres uten Gold-LOT.",
    en: "No delivery line with quantity can be saved without a Gold LOT.",
  },
  delivery_lot_insufficient: {
    no: "Valgt Gold-LOT har ikke nok tilgjengelig mengde.",
    en: "The selected Gold LOT does not have enough remaining quantity.",
  },
  delivery_workflow: {
    no: "Velg sted, skriv antall. Systemet velger LOT.",
    en: "Choose a venue, enter quantity. The system selects the LOT.",
  },
  lot_tab_active: { no: "Aktive LOT-er", en: "Active LOTs" },
  lot_tab_production: { no: "Produksjon", en: "Production" },
  lot_tab_history: { no: "LOT-historikk", en: "LOT history" },
  lot_tab_recall: { no: "Søk / tilbakekalling", en: "Search / recall" },
  lot_prereq_title: { no: "LOT-infrastrukturen mangler", en: "LOT infrastructure is missing" },
  lot_schema_missing: {
    no: "Gold-LOT-tabellene er ikke opprettet. Kjør sql/10_gold_lots.sql i Lovable Cloud SQL Editor, deretter sql/11_delivery_lot_required.sql.",
    en: "Gold LOT tables are not created. Run sql/10_gold_lots.sql in the Lovable Cloud SQL Editor, then sql/11_delivery_lot_required.sql.",
  },
  lot_letter_required_admin: {
    no: "Alle aktive smaker må ha LOT-bokstav før LOT og levering kan brukes.",
    en: "Every active flavor needs a LOT letter before LOT and delivery can be used.",
  },
  open_products: { no: "Åpne Produkter", en: "Open Products" },
  ops_today: { no: "Drift i dag", en: "Ops today" },
  ops_intro: {
    no: "Produksjon lager LOT. Overlevering og levering flytter varen. Nye avtaler og steder ligger hos eier.",
    en: "Production creates the LOT. Handover and delivery move it. New deals and venues stay with the owner.",
  },
  ops_start_production: { no: "Start produksjon", en: "Start production" },
  ops_start_production_hint: {
    no: "Opprett Gold-LOT og registrer råvarer",
    en: "Create a Gold LOT and record ingredients",
  },
  ops_handover_villa: { no: "Overlever til Villa", en: "Hand over to Villa" },
  ops_handover_none: {
    no: "Ingen LOT-er klare for overlevering",
    en: "No LOTs ready for handover",
  },
  ops_handover_one: { no: "1 åpen LOT klar for overlevering", en: "1 open LOT ready for handover" },
  ops_handover_many: {
    no: "åpne LOT-er klare for overlevering",
    en: "open LOTs ready for handover",
  },
  ops_register_delivery: { no: "Registrer levering", en: "Register delivery" },
  ops_register_delivery_hint: {
    no: "Lever varer til eksisterende sted",
    en: "Deliver to an existing venue",
  },
  ops_stock: { no: "Lager", en: "Stock" },
  ops_stock_empty: { no: "Ingen Gold-LOT registrert ennå.", en: "No Gold LOTs recorded yet." },
  ops_produced: { no: "Produsert", en: "Produced" },
  ops_at_villa: { no: "Hos Villa", en: "At Villa" },
  ops_delivered: { no: "Levert", en: "Delivered" },
  ops_available: { no: "Tilgjengelig", en: "Available" },
  ops_need_empty: { no: "Ingen neste behov registrert.", en: "No upcoming demand recorded." },
  ops_estimated: { no: "estimert", en: "estimated" },

  staff: { no: "Ansatte", en: "Staff" },
  staff_title: { no: "Ansatte", en: "Staff" },
  staff_intro: {
    no: "Opprett innlogging til Gold-ansatte. Ingen e-post sendes — du gir brukernavn og passord selv, og bytter passord her hvis de har glemt det.",
    en: "Create logins for Gold employees. No email is sent — you give them the username and password, and reset the password here if they forget.",
  },
  staff_no_email: {
    no: "Ingen e-post. Skriv ned brukernavn og passord og gi det til den ansatte.",
    en: "No email. Write down the username and password and give it to the employee.",
  },
  new_staff: { no: "Ny ansatt", en: "New staff" },
  no_staff: { no: "Ingen ansatte ennå.", en: "No staff yet." },
  staff_created: { no: "Ansatt opprettet", en: "Staff account created" },
  staff_missing: {
    no: "Brukernavn (minst 3 tegn), passord (minst 6 tegn) og rolle er påkrevd.",
    en: "Username (min 3), password (min 6) and a role are required.",
  },
  staff_failed: {
    no: "Kunne ikke opprette den ansatte. Prøv igjen.",
    en: "Could not create the staff account. Please try again.",
  },
  staff_schema_missing: {
    no: "Drift-rollen mangler i databasen. Kjør sql/12_staff_roles.sql i Lovable Cloud SQL Editor.",
    en: "The ops role is missing in the database. Run sql/12_staff_roles.sql in the Lovable Cloud SQL Editor.",
  },
  staff_choose_role: { no: "Tilgang", en: "Access" },
  staff_role_updated: { no: "Tilgang oppdatert", en: "Access updated" },
  staff_last_admin: {
    no: "Du kan ikke fjerne tilgangen til den siste eieren.",
    en: "You cannot remove access from the last owner.",
  },
  role_owner: { no: "Eier", en: "Owner" },
  role_ops: { no: "Drift", en: "Ops" },
  role_venue: { no: "Sted", en: "Venue" },
  role_owner_inc_partners: {
    no: "Nye partnere og serveringssteder",
    en: "New partners and venues",
  },
  role_owner_inc_terms: {
    no: "Avtaler, smaker og priser",
    en: "Agreements, flavors and prices",
  },
  role_owner_inc_access: {
    no: "Tilgang og styring",
    en: "Access and overall control",
  },
  role_owner_inc_ops: {
    no: "Alt Drift kan",
    en: "Everything Ops can do",
  },
  role_ops_inc_lots: {
    no: "Produksjon, råvarer og Gold-LOT",
    en: "Production, ingredients and Gold LOT",
  },
  role_ops_inc_villa: {
    no: "Overlevering til Villa",
    en: "Handover to Villa",
  },
  role_ops_inc_delivery: {
    no: "Leveringer, beholdning og tilbakekalling",
    en: "Deliveries, stock and recall",
  },
  role_ops_inc_venues: {
    no: "Ser steder og etterspørsel — oppretter ikke nye avtaler",
    en: "Sees venues and demand — does not create new deals",
  },
  role_venue_inc_report: {
    no: "Skiftrapport for sitt serveringssted",
    en: "Shift report for their serving venue",
  },
  role_venue_hint: {
    no: "Sted-brukere opprettes under Steder, ikke her.",
    en: "Venue logins are created under Venues, not here.",
  },
  this_is_you: { no: "Deg", en: "You" },

  packing: { no: "Pakking og etikett", en: "Packing and labels" },
  packing_intro: {
    no: "LOT er hovedobjektet. Poser og kartonger er fysiske enheter under LOT-et.",
    en: "The LOT is the master object. Bags and cartons are physical units under the LOT.",
  },
  packing_schema_missing: {
    no: "Pakkingstabellene mangler. Kjør sql/13_lot_packing.sql i Lovable Cloud SQL Editor (etter sql/12_staff_roles.sql).",
    en: "Packing tables are missing. Run sql/13_lot_packing.sql in the Lovable Cloud SQL Editor (after sql/12_staff_roles.sql).",
  },
  approved_qty: { no: "Antall godkjent", en: "Quantity approved" },
  units_per_package: { no: "Arancini per pose", en: "Arancini per bag" },
  packages_per_carton: { no: "Poser per kartong", en: "Bags per carton" },
  unit_weight_g: { no: "Vekt per arancino (g)", en: "Weight per arancino (g)" },
  packing_preview: { no: "Pakkeplan", en: "Pack plan" },
  packing_run: { no: "Pakk LOT", en: "Pack LOT" },
  packing_rerun: { no: "Pakk på nytt", en: "Pack again" },
  packing_missing: {
    no: "Sett arancini per pose og poser per kartong under Produkter før pakking.",
    en: "Set units per bag and bags per carton under Products before packing.",
  },
  packing_qty: {
    no: "Godkjent antall må være mellom 1 og produsert antall.",
    en: "Approved quantity must be between 1 and produced quantity.",
  },
  packing_done: { no: "LOT pakket", en: "LOT packed" },
  packing_locked: {
    no: "Pakking kan ikke endres etter overlevering.",
    en: "Packing cannot be changed after handover.",
  },
  packing_print_empty: {
    no: "Pakk LOT før du skriver ut etiketter.",
    en: "Pack the LOT before printing labels.",
  },
  packages: { no: "Poser", en: "Bags" },
  cartons: { no: "Kartonger", en: "Cartons" },
  print_package_labels: { no: "Produktetiketter", en: "Product labels" },
  print_carton_labels: { no: "Kartongetiketter", en: "Carton labels" },
  label_fields: { no: "Etikett / merking", en: "Label / marking" },
  packing_units: { no: "Pakningsenhet", en: "Pack unit" },
  legal_designation: { no: "Betegnelse (norsk)", en: "Legal name (Norwegian)" },
  ingredients_list: { no: "Ingrediensliste", en: "Ingredients list" },
  allergens_list: { no: "Allergener (fremhevet)", en: "Allergens (highlighted)" },
  nutrition_decl: { no: "Næringsdeklarasjon", en: "Nutrition declaration" },
  prep_instructions: { no: "Tilberedning", en: "Preparation" },
  storage_instructions: { no: "Oppbevaring", en: "Storage" },
  do_not_refreeze: { no: "Ikke frys på nytt", en: "Do not refreeze" },
  producer_name: { no: "Produsent", en: "Producer" },
  producer_address: { no: "Produsentadresse", en: "Producer address" },
  shelf_life_days: { no: "Holdbarhet (dager)", en: "Shelf life (days)" },
  product_version: { no: "Produktversjon", en: "Product version" },
  remainder_bag: { no: "restpose", en: "remainder bag" },
  full_name: { no: "Navn", en: "Name" },
  employee_number: { no: "Ansattnr", en: "Employee no." },
  employee_number_hint: {
    no: "Valgfritt. Internt nummer, f.eks. GOS-004.",
    en: "Optional. Internal number, e.g. GOS-004.",
  },
  staff_updated: { no: "Ansatt oppdatert", en: "Staff updated" },
  staff_name_missing: {
    no: "Skriv inn navn på den ansatte.",
    en: "Enter the employee’s name.",
  },
  employee_number_taken: {
    no: "Ansattnummeret er allerede i bruk.",
    en: "That employee number is already in use.",
  },
  produced_by_required: {
    no: "Huk av minst én som produserte dette LOT-et.",
    en: "Select at least one person who produced this LOT.",
  },
  produced_by_legacy: {
    no: "Tidligere fritekst, ikke koblet til en ansatt.",
    en: "Legacy free text, not linked to a staff account.",
  },
  producer_schema_missing: {
    no: "Produsenttabellen mangler. Kjør sql/14_lot_producers.sql i Lovable Cloud SQL Editor (etter sql/13_lot_packing.sql).",
    en: "The producer table is missing. Run sql/14_lot_producers.sql in the Lovable Cloud SQL Editor (after sql/13_lot_packing.sql).",
  },
  no_production_staff: {
    no: "Ingen Gold-ansatte å velge. Opprett dem under Ansatte først.",
    en: "No Gold staff to choose. Create them under Staff first.",
  },
  legacy_delivery: { no: "Legacy", en: "Legacy" },
  legacy_delivery_intro: {
    no: "Dokumentert med det som er kjent. Pose, kartong og råvare-LOT er ikke etterkonstruert.",
    en: "Documented from what is known. Bags, cartons and raw-material LOTs were not reconstructed.",
  },
  legacy_stamp_hint: {
    no: "De tre eldste leveringene mangler legacy-notat. Merk dem uten å dikte opp pakkehistorikk.",
    en: "The three oldest deliveries are missing the legacy note. Mark them without inventing packing history.",
  },
  legacy_stamp_action: {
    no: "Merk de tre eldste som legacy",
    en: "Mark the three oldest as legacy",
  },
  legacy_stamp_done: {
    no: "De tre eldste leveringene er merket som legacy.",
    en: "The three oldest deliveries are marked as legacy.",
  },
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
