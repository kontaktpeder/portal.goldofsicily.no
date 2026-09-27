export type BrregKind = "hovedenhet" | "underenhet";

export type BrregHit = {
  organizationNumber: string;
  legalName: string;
  organizationForm: string | null;
  kind: BrregKind;
  parentOrganizationNumber: string | null;
  businessAddress: string | null;
  postalAddress: string | null;
  city: string | null;
  vatRegistered: boolean;
  raw: Record<string, unknown>;
};

const ORGNR = /^[0-9]{9}$/;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function field(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

export function formatBrregAddress(value: unknown): { lines: string | null; city: string | null } {
  const address = record(value);
  if (!address) return { lines: null, city: null };
  const streetsRaw = field(address, "adresse");
  const streets = Array.isArray(streetsRaw)
    ? streetsRaw.filter((line): line is string => typeof line === "string" && line.trim() !== "")
    : [];
  const postnummer = text(field(address, "postnummer"));
  const poststed = text(field(address, "poststed"));
  const locality = [postnummer, poststed].filter(Boolean).join(" ");
  const lines = [...streets, locality].filter(Boolean).join(", ");
  return { lines: lines || null, city: poststed };
}

export function mapBrregEntity(value: unknown, kind: BrregKind): BrregHit | null {
  const row = record(value);
  if (!row) return null;
  const organizationNumber = text(field(row, "organisasjonsnummer"));
  const legalName = text(field(row, "navn"));
  if (!organizationNumber || !ORGNR.test(organizationNumber) || !legalName) return null;

  const form = record(field(row, "organisasjonsform"));
  const business = formatBrregAddress(field(row, "forretningsadresse") ?? field(row, "beliggenhetsadresse"));
  const postal = formatBrregAddress(field(row, "postadresse"));
  const parent = text(field(row, "overordnetEnhet"));

  return {
    organizationNumber,
    legalName,
    organizationForm: (form ? text(field(form, "beskrivelse")) ?? text(field(form, "kode")) : null),
    kind: parent ? "underenhet" : kind,
    parentOrganizationNumber: parent && ORGNR.test(parent) ? parent : null,
    businessAddress: business.lines,
    postalAddress: postal.lines,
    city: business.city ?? postal.city,
    vatRegistered: field(row, "registrertIMvaregisteret") === true,
    raw: row,
  };
}

export function mapBrregSearch(payload: unknown, kind: BrregKind): BrregHit[] {
  const body = record(payload);
  const embedded = record(body ? field(body, "_embedded") : null);
  const key = kind === "hovedenhet" ? "enheter" : "underenheter";
  const rows = embedded?.[key];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const hit = mapBrregEntity(row, kind);
    return hit ? [hit] : [];
  });
}

export function legalEntityWrite(hit: BrregHit, parentLegalEntityId: string | null) {
  return {
    organization_number: hit.organizationNumber,
    parent_legal_entity_id: parentLegalEntityId,
    legal_name: hit.legalName,
    organization_form: hit.organizationForm,
    business_address: hit.businessAddress,
    postal_address: hit.postalAddress,
    vat_registered: hit.vatRegistered,
    brreg_data: hit.raw,
    brreg_synced_at: new Date().toISOString(),
  };
}

const BRREG_ROOT = "https://data.brreg.no/enhetsregisteret/api";

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`BRREG ${response.status}`);
  return response.json() as Promise<unknown>;
}

export async function searchBrreg(query: string, fetchImpl: typeof fetch = fetch): Promise<BrregHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  if (ORGNR.test(trimmed)) {
    const [entity, unit] = await Promise.all([
      fetchImpl(`${BRREG_ROOT}/enheter/${trimmed}`, { headers: { Accept: "application/json" } }).then(readJson),
      fetchImpl(`${BRREG_ROOT}/underenheter/${trimmed}`, { headers: { Accept: "application/json" } }).then(readJson),
    ]);
    return [mapBrregEntity(entity, "hovedenhet"), mapBrregEntity(unit, "underenhet")].flatMap((hit) =>
      hit ? [hit] : [],
    );
  }

  const params = new URLSearchParams({ navn: trimmed, size: "8" });
  const [entities, units] = await Promise.all([
    fetchImpl(`${BRREG_ROOT}/enheter?${params}`, { headers: { Accept: "application/json" } }).then(readJson),
    fetchImpl(`${BRREG_ROOT}/underenheter?${params}`, { headers: { Accept: "application/json" } }).then(readJson),
  ]);
  return [...mapBrregSearch(entities, "hovedenhet"), ...mapBrregSearch(units, "underenhet")];
}

export async function fetchBrregUnit(
  organizationNumber: string,
  kind: BrregKind,
  fetchImpl: typeof fetch = fetch,
): Promise<BrregHit | null> {
  const path = kind === "hovedenhet" ? "enheter" : "underenheter";
  const payload = await readJson(
    await fetchImpl(`${BRREG_ROOT}/${path}/${organizationNumber}`, {
      headers: { Accept: "application/json" },
    }),
  );
  return mapBrregEntity(payload, kind);
}
