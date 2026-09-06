import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatPriceNok, parseGuestPriceOre } from "./slug.ts";

test("empty guest price stays hidden", () => {
  assert.equal(parseGuestPriceOre(""), null);
  assert.equal(parseGuestPriceOre("   "), null);
  assert.equal(parseGuestPriceOre(","), null);
  assert.equal(parseGuestPriceOre("abc"), null);
});

test("guest price parses kroner to øre", () => {
  assert.equal(parseGuestPriceOre("79"), 7900);
  assert.equal(parseGuestPriceOre("79,5"), 7950);
  assert.equal(parseGuestPriceOre(" 12.00 "), 1200);
});

test("formatted price is omitted when missing", () => {
  assert.equal(formatPriceNok(null), null);
  assert.equal(formatPriceNok(7900), "79");
});

test("portal menu form treats price as optional", () => {
  const source = readFileSync(
    new URL("../routes/_authenticated/admin.venues.$venueId.tsx", import.meta.url),
    "utf8",
  );
  const publicApi = readFileSync(new URL("./public-venues.server.ts", import.meta.url), "utf8");
  assert.match(source, /useState\(""\)/);
  assert.match(source, /parseGuestPriceOre\(price\)/);
  assert.match(source, /price_guest_hint/);
  assert.match(publicApi, /item\.price_ore == null \|\| item\.price_ore === 0/);
});
