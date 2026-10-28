/** Straight-line kilometres from the handover outside Smalgangen 31. */
export const HANDOVER_POINT = { lat: 59.91232162450495, lon: 10.760792861288444 };

export const FREIGHT_KM5_ORE = 6_000;
export const FREIGHT_KM10_ORE = 17_900;
export const FREIGHT_KM15_ORE = 34_900;

export type DeliveryZone = "pickup" | "km5" | "km10" | "km15" | "outside";

export function distanceMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const earth = 6_371_000;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 0–5 km, 5–10 km and 10–15 km are priced. Farther than 15 km is a manual offer. */
export function zoneForMeters(meters: number): {
  zone: Exclude<DeliveryZone, "pickup">;
  freightOre: number | null;
} {
  if (meters <= 5_000) return { zone: "km5", freightOre: FREIGHT_KM5_ORE };
  if (meters <= 10_000) return { zone: "km10", freightOre: FREIGHT_KM10_ORE };
  if (meters <= 15_000) return { zone: "km15", freightOre: FREIGHT_KM15_ORE };
  return { zone: "outside", freightOre: null };
}

export function formatDistance(meters: number, lang: "no" | "en"): string {
  const km = (meters / 1000).toFixed(1).replace(".", lang === "no" ? "," : ".");
  return lang === "no" ? `ca. ${km} km` : `about ${km} km`;
}
