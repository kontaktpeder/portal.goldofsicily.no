import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isUniqueMenuItemConflict, nextAvailableProductId } from "./venue-menu-item.ts";

test("selects the next unused flavor after one is added", () => {
  const products = [{ id: "nduja" }, { id: "truffel" }];
  assert.equal(nextAvailableProductId(products, [], ""), "nduja");
  assert.equal(nextAvailableProductId(products, ["nduja"], "nduja"), "truffel");
  assert.equal(nextAvailableProductId(products, ["nduja", "truffel"], "truffel"), "");
});

test("detects unique menu-item conflicts", () => {
  assert.equal(
    isUniqueMenuItemConflict({
      code: "23505",
      message: 'duplicate key value violates unique constraint "venue_menu_items_customer_id_product_id_key"',
    }),
    true,
  );
  assert.equal(isUniqueMenuItemConflict({ message: "something else" }), false);
});

test("portal add-menu form recovers from a duplicate flavor", () => {
  const source = readFileSync(
    new URL("../routes/_authenticated/admin.venues.$venueId.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /nextAvailableProductId/);
  assert.match(source, /isUniqueMenuItemConflict/);
});
