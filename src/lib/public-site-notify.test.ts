import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PUBLIC_SITE_DEFAULT_URL,
  publicSiteNotifyPayload,
  publicSiteNotifyUrl,
} from "./public-site-notify.ts";

test("portal notify payload sends current and previous venue slugs", () => {
  const payload = publicSiteNotifyPayload({
    slugs: ["oslo-bar-bowling", " oslo-bar-bowling ", ""],
    previousSlugs: ["gammel-slug", "oslo-bar-bowling"],
    published: true,
  });
  assert.deepEqual(payload, {
    slugs: ["oslo-bar-bowling"],
    previousSlugs: ["gammel-slug"],
    published: true,
  });
});

test("portal notify URL targets the public site SEO endpoint", () => {
  assert.equal(publicSiteNotifyUrl(), `${PUBLIC_SITE_DEFAULT_URL}/api/seo/notify`);
  assert.equal(
    publicSiteNotifyUrl("https://goldofsicily.no/"),
    "https://goldofsicily.no/api/seo/notify",
  );
});

test("creating or publishing a venue pings the public SEO notify endpoint", () => {
  const admin = readFileSync(new URL("./admin.functions.ts", import.meta.url), "utf8");
  const venuePage = readFileSync(
    new URL("../routes/_authenticated/admin.venues.$venueId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(admin, /notifyPublicSiteIndex/);
  assert.match(admin, /select\("id, slug, public_visible, active"\)/);
  assert.match(venuePage, /notifyVenueIndex/);
});
