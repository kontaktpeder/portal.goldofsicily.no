import assert from "node:assert/strict";
import test from "node:test";
import {
  MENU_FILE_MAX_BYTES,
  menuFileDisplayName,
  menuFileObjectPath,
  sanitizeMenuFileName,
  validateMenuFile,
} from "./venue-menu-file.ts";

test("rejects files over 50 MB", () => {
  assert.equal(
    validateMenuFile({ name: "meny.pdf", size: MENU_FILE_MAX_BYTES + 1, type: "application/pdf" }),
    "too_large",
  );
});

test("accepts pdf and images at the limit", () => {
  assert.equal(
    validateMenuFile({ name: "meny.pdf", size: MENU_FILE_MAX_BYTES, type: "application/pdf" }),
    null,
  );
  assert.equal(validateMenuFile({ name: "meny.png", size: 12, type: "image/png" }), null);
  assert.equal(validateMenuFile({ name: "meny.webp", size: 12, type: "" }), null);
});

test("rejects unsupported types", () => {
  assert.equal(validateMenuFile({ name: "notes.exe", size: 12, type: "application/x-msdownload" }), "bad_type");
});

test("sanitizes and paths menu files", () => {
  assert.equal(sanitizeMenuFileName("Oslo Bar meny (vår).PDF"), "Oslo-Bar-meny-var.pdf");
  assert.equal(menuFileObjectPath("venue-1", "Meny 2026.pdf", 1700000000000), "venue-1/1700000000000-Meny-2026.pdf");
  assert.equal(menuFileDisplayName("venue-1/1700000000000-Meny-2026.pdf"), "Meny-2026.pdf");
});
