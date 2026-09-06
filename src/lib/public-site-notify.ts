export const PUBLIC_SITE_DEFAULT_URL = "https://goldofsicily.no";

/** Must match goldofsicily.no `SEO_NOTIFY_FALLBACK_SECRET`. Override with SEO_NOTIFY_SECRET. */
export const SEO_NOTIFY_FALLBACK_SECRET = "gos-idx-7f3c2e91b4a06d58";

export type PublicSiteNotifyInput = {
  slugs?: Array<string | null | undefined>;
  previousSlugs?: Array<string | null | undefined>;
  published?: boolean;
};

function cleanSlugs(values: Array<string | null | undefined> | undefined) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const slug = value?.trim() ?? "";
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function publicSiteUrl() {
  const fromEnv =
    (typeof process !== "undefined" &&
      (process.env.PUBLIC_SITE_URL || process.env.VITE_PUBLIC_SITE_URL)) ||
    "";
  return (fromEnv.trim() || PUBLIC_SITE_DEFAULT_URL).replace(/\/$/, "");
}

export function seoNotifySecret() {
  const fromEnv =
    (typeof process !== "undefined" && process.env.SEO_NOTIFY_SECRET) || "";
  return fromEnv.trim() || SEO_NOTIFY_FALLBACK_SECRET;
}

export function publicSiteNotifyUrl(base = publicSiteUrl()) {
  return `${base.replace(/\/$/, "")}/api/seo/notify`;
}

export function publicSiteNotifyPayload(input: PublicSiteNotifyInput) {
  const slugs = cleanSlugs(input.slugs);
  const previousSlugs = cleanSlugs(input.previousSlugs).filter((slug) => !slugs.includes(slug));
  return {
    slugs,
    previousSlugs,
    published: input.published !== false,
  };
}

export async function notifyPublicSiteIndex(input: PublicSiteNotifyInput) {
  const payload = publicSiteNotifyPayload(input);
  if (payload.slugs.length === 0 && payload.previousSlugs.length === 0) {
    return { ok: true, skipped: true as const };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(publicSiteNotifyUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${seoNotifySecret()}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: response.ok, skipped: false as const, status: response.status };
  } catch {
    return { ok: false, skipped: false as const };
  } finally {
    clearTimeout(timer);
  }
}
