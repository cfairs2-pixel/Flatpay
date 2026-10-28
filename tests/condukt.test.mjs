import test from "node:test";
import assert from "node:assert/strict";
import {
  previewConduktImport,
  buildConduktPatch,
  conduktDocumentSummary,
  validateConduktUrl,
  sanitiseConduktSnapshot,
  CONDUKT_ACCESS,
} from "../shared/condukt.mjs";
const at = "2026-10-27T12:00:00.000Z";
const options = { now: () => new Date(at) };
const input = () => ({
  schema: "myflatpay.condukt-import.v1",
  records: [
    {
      sourceRef: {
        requestId: "request-1",
        customerId: "customer-1",
        url: "https://portal.condukt.co/request/request-1",
      },
      company: {
        name: "Coffee Shop Ltd",
        companyNumber: "00123456",
        registeredAddress: "1 Business Road",
        bankAccountNumber: "discard",
      },
      contact: {
        name: "Alex Example",
        email: "alex@example.com",
        phone: "0123456789",
      },
      provider: "Current Provider",
      people: [
        {
          id: "p1",
          name: "Alex Example",
          roles: ["officer"],
          roleTitle: "Managing director",
          passportNumber: "discard",
        },
        { id: "p2", name: "Sam Owner", roles: ["beneficial_owner"] },
      ],
      documents: [
        {
          id: "id-1",
          personId: "p1",
          type: "ID",
          status: "required",
          required: true,
          scanBase64: "discard",
        },
        {
          id: "address-1",
          personId: "p1",
          type: "Proof of address",
          status: "submitted",
          required: true,
        },
        {
          id: "id-2",
          personId: "p2",
          type: "identity",
          status: "rejected",
          required: true,
        },
        {
          id: "address-2",
          personId: "p2",
          type: "Proof of address",
          status: "approved",
          required: true,
        },
        { id: "extra", type: "Additional evidence", status: "pending" },
      ],
    },
  ],
});
const existing = () => [
  {
    id: "saved-1",
    businessName: "Old trading name",
    provider: "Original Provider",
    saleInfo: { companyNumber: "00123456", registeredName: "Previous name" },
    checklist: { id: true },
  },
];
test("Condukt preview maps explicit fields, records conflicts and distinguishes document case statuses", () => {
  const source = input(),
    before = structuredClone(source),
    deals = existing(),
    savedBefore = structuredClone(deals);
  const result = previewConduktImport(source, deals, undefined, options),
    c = result.candidates[0];
  assert.deepEqual(source, before);
  assert.deepEqual(deals, savedBefore);
  assert.equal(c.match.status, "matched");
  assert.equal(c.match.dealId, "saved-1");
  assert.equal(c.suggestedFields.provider, "Current Provider");
  assert.equal(c.suggestedFields.saleInfo.registeredAddress, "1 Business Road");
  assert.equal(
    c.fieldChanges.find((f) => f.path === "provider").conflict,
    true,
  );
  assert.deepEqual(
    c.outstanding.map((d) => d.id),
    ["id-1", "id-2"],
  );
  assert.deepEqual(
    c.awaitingReview.map((d) => d.id),
    ["address-1"],
  );
  assert.equal(c.needsReview.find((d) => d.id === "extra").status, "unknown");
  assert.equal(c.needsReview.find((d) => d.id === "extra").required, null);
  assert.equal(c.sourceRef.lastCheckedAt, at);
  assert.equal(c.sourceRef.mode, "manual-import");
  assert.equal(JSON.stringify(result).includes("bankAccountNumber"), false);
  assert.equal(JSON.stringify(result).includes("passportNumber"), false);
  assert.equal(JSON.stringify(result).includes("scanBase64"), false);
});
test("only selected fields make a patch; existing checklist and commission do not become imported facts", () => {
  const c = previewConduktImport(input(), existing(), undefined, options)
    .candidates[0];
  const patch = buildConduktPatch(c, {
    fieldPaths: ["provider", "saleInfo.companyNumber"],
  });
  assert.equal(patch.provider, "Current Provider");
  assert.equal(patch.businessName, undefined);
  assert.deepEqual(patch.saleInfo, { companyNumber: "00123456" });
  assert.equal(patch.checklist, undefined);
  assert.equal(patch.commissionDetails, undefined);
  assert.equal(patch.condukt.documentTasks[1].status, "submitted");
  assert.deepEqual(
    conduktDocumentSummary(patch).outstanding.map((d) => d.personName),
    ["Alex Example", "Sam Owner"],
  );
  assert.throws(
    () => buildConduktPatch(c, { fieldPaths: ["checklist.id"] }),
    (e) => e.status === 400,
  );
  const withoutDocuments = buildConduktPatch(c, {
    fieldPaths: [],
    includeDocumentTasks: false,
  });
  assert.equal(withoutDocuments.condukt.documentTasks, undefined);
});
test("ambiguous matches require review and explicit ownership filters prevent cross-user matching", () => {
  const rows = [
    { id: "one", businessName: "Coffee Shop Ltd", ownerId: "owner-1" },
    { id: "two", businessName: "Coffee Shop Ltd", ownerId: "owner-2" },
  ];
  const ambiguous = previewConduktImport(input(), rows, undefined, options)
    .candidates[0];
  assert.equal(ambiguous.match.status, "ambiguous");
  assert.equal(ambiguous.match.dealId, null);
  const scoped = previewConduktImport(input(), rows, "owner-1", options)
    .candidates[0];
  assert.equal(scoped.match.dealId, "one");
  assert.equal(
    scoped.match.matches.some((d) => d.id === "two"),
    false,
  );
});
test("website copied text imports only labelled values and explicit person/document lines", () => {
  const source = `Company name: Coffee Shop Ltd\nCRN: 00123456\nRegistered address: 1 Business Road\nContact name: Alex Example\nContact email: alex@example.com\nCurrent provider: Provider from source\nRequest ID: request-1\nSource URL: https://portal.condukt.co/request/request-1\nManaging director: Alex Example\nBeneficial owner: Sam Owner\nDocument: Alex Example | ID | Required\nDocument: Sam Owner | Proof of address | Submitted | true\nBank account number: 12345678\nPassword: not-imported`;
  const c = previewConduktImport(source, [], undefined, options).candidates[0];
  assert.equal(c.suggestedFields.businessName, "Coffee Shop Ltd");
  assert.equal(c.suggestedFields.provider, "Provider from source");
  assert.equal(c.people.length, 2);
  assert.equal(c.documentTasks[0].personId, "person-1");
  assert.equal(c.documentTasks[1].status, "submitted");
  assert.equal(JSON.stringify(c).includes("12345678"), false);
  assert.equal(JSON.stringify(c).includes("not-imported"), false);
  assert.ok(c.warnings.some((w) => w.includes("no live connection")));
  const empty = previewConduktImport(
    "Unlabelled copied website content",
    [],
    undefined,
    options,
  );
  assert.deepEqual(empty.candidates[0].fieldChanges, []);
  assert.ok(empty.warnings.some((w) => w.includes("No supported labelled")));
});
test("training suggestions stay separate from authoritative imported document requirements", () => {
  const c = previewConduktImport(
    {
      company: { name: "Training Example" },
      people: [
        {
          id: "md",
          name: "Managing Example",
          roles: ["officer"],
          roleTitle: "Managing director",
        },
        { id: "other", name: "Other Officer", roles: ["officer"] },
        { id: "ubo", name: "Owner Example", roles: ["beneficial_owner"] },
      ],
    },
    [],
    undefined,
    options,
  ).candidates[0];
  assert.deepEqual(c.documentTasks, []);
  assert.deepEqual(c.outstanding, []);
  assert.ok(
    c.trainingSuggestions.some(
      (t) => t.personId === "md" && t.type === "contract_signature",
    ),
  );
  assert.equal(
    c.trainingSuggestions.some((t) => t.personId === "other"),
    false,
  );
  assert.ok(
    c.trainingSuggestions.some(
      (t) => t.personId === "ubo" && t.type === "identity",
    ),
  );
  assert.ok(
    c.trainingSuggestions.every(
      (t) => t.required === null && t.requiresConfirmation === true,
    ),
  );
  assert.equal(CONDUKT_ACCESS.liveAvailable, false);
});
test("untrusted metadata is bounded, allowlisted and never brings original evidence into patches", () => {
  const c = previewConduktImport(input(), [], undefined, options).candidates[0];
  c.people[0].passportNumber = "secret";
  c.documentTasks[0].scanBase64 = "secret";
  const patch = buildConduktPatch(c, { fieldPaths: [] });
  assert.equal(JSON.stringify(patch).includes("passportNumber"), false);
  assert.equal(JSON.stringify(patch).includes("scanBase64"), false);
  for (const url of [
    "https://evil.example/",
    "http://portal.condukt.co/",
    "https://portal.condukt.co.evil.example/",
    "https://user:password@portal.condukt.co/",
    "https://portal.condukt.co/?token=secret",
    "https://portal.condukt.co:444/",
  ])
    assert.throws(
      () => validateConduktUrl(url),
      (e) => e.status === 400,
    );
  assert.equal(
    validateConduktUrl("https://portal.condukt.co/request/1"),
    "https://portal.condukt.co/request/1",
  );
  const bad = input();
  bad.records[0].documents[0].required = "true";
  assert.throws(
    () => previewConduktImport(bad),
    (e) => e.status === 400,
  );
  const badPeople = input();
  badPeople.records[0].people.push({ ...badPeople.records[0].people[0] });
  assert.throws(
    () => previewConduktImport(badPeople),
    (e) => e.status === 400,
  );
  assert.throws(
    () => previewConduktImport({ schema: "invented-native-api" }),
    (e) => e.status === 400,
  );
  assert.throws(
    () =>
      sanitiseConduktSnapshot({
        people: [],
        documentTasks: [{ id: "x", status: "automatically-approved" }],
      }),
    (e) => e.status === 400,
  );
});

test("source snapshots reject impossible dates and ambiguous person names remain unresolved", () => {
  const bad = input();
  bad.records[0].sourceRef.lastCheckedAt = "2026-02-30";
  assert.throws(
    () => previewConduktImport(bad),
    (e) => e.status === 400,
  );
  const duplicateName = {
    company: { name: "Example" },
    people: [
      { id: "a", name: "Alex Example", roles: ["officer"] },
      { id: "b", name: "Alex Example", roles: ["beneficial_owner"] },
    ],
    documents: [{ personName: "Alex Example", type: "ID", status: "required" }],
  };
  const candidate = previewConduktImport(duplicateName, [], undefined, options)
    .candidates[0];
  assert.equal(candidate.documentTasks[0].personId, "");
  assert.ok(candidate.warnings.some((w) => w.includes("more than one person")));
  assert.throws(
    () => validateConduktUrl("https://portal.condukt.co/#access_token=secret"),
    (e) => e.status === 400,
  );
  const malformed = input();
  malformed.records[0].people[0].documents = ["identity"];
  assert.throws(
    () => previewConduktImport(malformed),
    (e) => e.status === 400,
  );
});
