import assert from "node:assert/strict";
import test from "node:test";
import { formatBrregAddress, legalEntityWrite, mapBrregEntity, mapBrregSearch } from "./brreg.ts";

const osloBarUnit = {
  organisasjonsnummer: "987654321",
  navn: "OSLO BAR & BOWLING",
  organisasjonsform: { kode: "BEDR", beskrivelse: "Bedrift" },
  overordnetEnhet: "123456789",
  beliggenhetsadresse: {
    adresse: ["Bogstadveien 1"],
    postnummer: "0355",
    poststed: "OSLO",
  },
  registrertIMvaregisteret: false,
};

test("an underenhet keeps its own org number and points at the hovedenhet", () => {
  const hit = mapBrregEntity(osloBarUnit, "underenhet");
  assert.ok(hit);
  assert.equal(hit.kind, "underenhet");
  assert.equal(hit.parentOrganizationNumber, "123456789");
  assert.equal(hit.organizationForm, "Bedrift");
  assert.equal(hit.city, "OSLO");
  assert.equal(hit.businessAddress, "Bogstadveien 1, 0355 OSLO");
  assert.equal(hit.vatRegistered, false);
});

test("search results ignore rows without a 9-digit org number", () => {
  const hits = mapBrregSearch(
    {
      _embedded: {
        enheter: [
          {
            organisasjonsnummer: "123456789",
            navn: "VILLA IMPORT AS",
            organisasjonsform: { beskrivelse: "Aksjeselskap" },
            forretningsadresse: { adresse: ["Storgata 1"], postnummer: "0155", poststed: "OSLO" },
            registrertIMvaregisteret: true,
          },
          { organisasjonsnummer: "12", navn: "Broken" },
        ],
      },
    },
    "hovedenhet",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.legalName, "VILLA IMPORT AS");
  assert.equal(hits[0]?.vatRegistered, true);
  assert.equal(hits[0]?.parentOrganizationNumber, null);
});

test("a BRREG write does not include accounting ids or Gold fields", () => {
  const hit = mapBrregEntity(osloBarUnit, "underenhet");
  assert.ok(hit);
  const row = legalEntityWrite(hit, "parent-id");
  assert.equal(row.organization_number, "987654321");
  assert.equal(row.parent_legal_entity_id, "parent-id");
  assert.equal("accounting_customer_id" in row, false);
  assert.equal("name" in row, false);
  assert.ok(row.brreg_synced_at);
});

test("address formatting keeps street and postal city apart", () => {
  assert.deepEqual(
    formatBrregAddress({ adresse: ["Gate 2"], postnummer: "7010", poststed: "TRONDHEIM" }),
    { lines: "Gate 2, 7010 TRONDHEIM", city: "TRONDHEIM" },
  );
  assert.deepEqual(formatBrregAddress(null), { lines: null, city: null });
});
