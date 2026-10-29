import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDocumentText,
  buildDocumentPatch,
} from "../shared/document-prefill.mjs";
const passport =
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
test("passport names use MRZ ordering and check digits without returning identity identifiers", () => {
  const result = parseDocumentText(passport, "passport");
  assert.equal(result.suggestions[0].value, "Anna Maria Eriksson");
  assert.equal(result.suggestions[0].confidence, "high");
  assert.equal(result.suggestions[1].path, "saleInfo.signatoryName");
  const output = JSON.stringify(result);
  for (const sensitive of ["L898902C3", "740812", "120415", "ZE184226"])
    assert.ok(!output.includes(sensitive));
});
test("damaged MRZ check digits lower confidence and unlabelled passport text is never guessed", () => {
  const result = parseDocumentText(
    passport.replace("L898902C36", "L898902C35"),
    "passport",
  );
  assert.equal(result.suggestions[0].confidence, "medium");
  assert.equal(
    parseDocumentText("UNITED KINGDOM\nPASSPORT\nSome random words", "passport")
      .suggestions.length,
    0,
  );
  assert.equal(
    parseDocumentText("Surname: SMITH\nGiven names: JANE ANN", "passport")
      .suggestions[0].value,
    "Jane Ann Smith",
  );
});
test("licence name fields and address are separated from numbers, dates and signing assumptions", () => {
  const result = parseDocumentText(
    "DRIVING LICENCE\n1. SMITH\n2. JANE ANN\n3. 01.01.1980 UK\n4a. 01.01.2020\n5. SMITH801001AB9CD\n8. 12 HIGH STREET\nLONDON\nSW1A1AA\n9. B",
    "licence",
  );
  assert.equal(result.suggestions[0].value, "Jane Ann Smith");
  const address = result.suggestions.find(
    (s) => s.path === "saleInfo.signatoryAddress",
  );
  assert.equal(address.value, "12 HIGH STREET\nLONDON\nSW1A 1AA");
  assert.equal(address.confidence, "high");
  assert.ok(
    !result.suggestions.some((s) =>
      ["saleInfo.registeredAddress", "saleInfo.installationAddress"].includes(
        s.path,
      ),
    ),
  );
  assert.deepEqual(
    buildDocumentPatch(result.suggestions, ["saleInfo.signatoryAddress"]),
    { saleInfo: { signatoryAddress: "12 HIGH STREET\nLONDON\nSW1A 1AA" } },
  );
  assert.ok(!JSON.stringify(result).includes("SMITH801001"));
  assert.ok(!JSON.stringify(result).includes("1980"));
});
test("bank statements suggest labelled holder/business details and never infer payment provider or TPV", () => {
  const result = parseDocumentText(
    "BARCLAYS BANK\nBusiness account name: EXAMPLE COFFEE LTD\nBusiness address: 18 MARKET LANE\nMANCHESTER\nM1 1AE\nAccount number: 12345678\nSort code: 12-34-56\nClosing balance £12,345.67",
    "bank",
  );
  assert.equal(
    result.suggestions.find((s) => s.path === "saleInfo.registeredName").value,
    "EXAMPLE COFFEE LTD",
  );
  assert.equal(
    result.suggestions.find((s) => s.path === "saleInfo.registeredAddress")
      .confidence,
    "high",
  );
  assert.ok(
    !result.suggestions.some((s) =>
      ["provider", "monthlyVolume", "contactName"].includes(s.path),
    ),
  );
  const output = JSON.stringify(result);
  for (const excluded of ["12345678", "12-34-56", "12,345.67", "BARCLAYS"])
    assert.ok(!output.includes(excluded));
});
test("personal bank holders and correspondence addresses require role confirmation, while unknown statements stay blank", () => {
  const result = parseDocumentText(
    "Account holder: MR JAMES SMITH\nAddress: 4 PARK ROAD\nLEEDS\nLS1 1AB\nIBAN: GB00 NOTRETAINED",
    "bank",
  );
  assert.equal(result.suggestions[0].value, "James Smith");
  assert.equal(result.suggestions[0].confidence, "medium");
  assert.equal(
    result.suggestions.find((s) => s.path === "saleInfo.signatoryAddress")
      .confidence,
    "low",
  );
  assert.ok(
    !result.suggestions.some((s) =>
      ["saleInfo.registeredAddress", "saleInfo.installationAddress"].includes(
        s.path,
      ),
    ),
  );
  assert.equal(
    parseDocumentText(
      "NATWEST\nStatement October\nMoney in 5000.00\nAccount no 12345678",
      "bank",
    ).suggestions.length,
    0,
  );
  assert.equal(
    parseDocumentText("Business account name: 12345678", "bank").suggestions
      .length,
    0,
  );
});
test("reviewed patches contain only selected safe fields and preserve other existing values by omission", () => {
  const original = {
    contactName: "Existing Person",
    provider: "Dojo",
    saleInfo: { registeredName: "Existing Company", companyNumber: "12345678" },
  };
  const suggestions = parseDocumentText(
    "Surname: SMITH\nGiven names: JANE",
    "passport",
  ).suggestions;
  const patch = buildDocumentPatch(
    suggestions,
    ["saleInfo.signatoryName"],
    original,
  );
  assert.deepEqual(patch, { saleInfo: { signatoryName: "Jane Smith" } });
  assert.equal(original.contactName, "Existing Person");
  assert.equal(original.saleInfo.companyNumber, "12345678");
  assert.throws(
    () =>
      buildDocumentPatch(
        [{ path: "passportNumber", value: "SECRET" }],
        ["passportNumber"],
      ),
    /cannot be filled/,
  );
  assert.throws(
    () =>
      buildDocumentPatch(
        [{ path: "contactName", value: "12345678" }],
        ["contactName"],
      ),
    /person/,
  );
  assert.deepEqual(buildDocumentPatch(suggestions, []), {});
});
test("document parser input is bounded and supports empty uncertain text without fabricated fields", () => {
  assert.throws(() => parseDocumentText("x".repeat(100001), "bank"), /100,000/);
  assert.throws(() => parseDocumentText("x", "other"), /Choose/);
  assert.deepEqual(parseDocumentText("", "passport").suggestions, []);
  const result = parseDocumentText(
    "Company name: Example Coffee\nPassport number: SECRET\nProvider: Fake Bank",
    "passport",
  );
  assert.deepEqual(result.suggestions, []);
});
