import {
  distanceMeters,
  HANDOVER_POINT,
  zoneForMeters,
  type DeliveryZone,
} from "@/lib/delivery-zone";

export type DeliveryQuote = {
  zone: Exclude<DeliveryZone, "pickup">;
  freightOre: number | null;
  distanceM: number | null;
  located: boolean;
};

const OUTSIDE: DeliveryQuote = {
  zone: "outside",
  freightOre: null,
  distanceM: null,
  located: true,
};

function postal(value: string): string | null {
  const digits = value.replace(/\s/g, "");
  return /^\d{4}$/.test(digits) ? digits : null;
}

/** null means the address service could not be reached, so the row should be tried again. */
export async function quoteDeliveryAddress(input: {
  addressLine: string;
  postalCode: string;
  city: string;
}): Promise<DeliveryQuote | null> {
  const code = postal(input.postalCode);
  const street = input.addressLine.trim();
  if (!code || street.length < 3) return OUTSIDE;
  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  url.searchParams.set("sok", `${street} ${input.city}`.trim());
  url.searchParams.set("postnummer", code);
  url.searchParams.set("treffPerSide", "5");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const point = firstPoint(body, code);
    if (!point) return OUTSIDE;
    const meters = Math.round(distanceMeters(HANDOVER_POINT, point));
    const zone = zoneForMeters(meters);
    return { zone: zone.zone, freightOre: zone.freightOre, distanceM: meters, located: true };
  } catch {
    return null;
  }
}

function firstPoint(body: unknown, code: string): { lat: number; lon: number } | null {
  if (!body || typeof body !== "object") return null;
  const rows = (body as Record<string, unknown>)["adresser"];
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (record["postnummer"] !== code) continue;
    const point = record["representasjonspunkt"];
    if (!point || typeof point !== "object") continue;
    const lat = (point as Record<string, unknown>)["lat"];
    const lon = (point as Record<string, unknown>)["lon"];
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    return { lat, lon };
  }
  return null;
}
