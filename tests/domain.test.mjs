import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveRate,
  cardShare,
  calculateMerchant,
  offerSummary,
  validateDeal,
  monthlySummary,
} from "../shared/domain.mjs";

const merchant = (overrides = {}) => ({
  businessName: "The Example Café",
  monthlyVolume: 50000,
  currentCharges: 750,
  businessVolume: 10000,
  internationalVolume: 7500,
  amexVolume: 5000,
  amexRate: 2.5,
  status: "Proposal sent",
  offers: [
    {
      id: "first",
      rate: 1.1,
      amexRate: 2,
      hardware: { terminal: 2, posPremium: 1, posPro: 0, mpos: 1 },
      acLink: "https://example.com/ac/123",
    },
  ],
  ...overrides,
});

test("reviewed statement figures validate without storing source documents", () => {
  const statementAnalysis = {
    version: 1,
    currency: "GBP",
    reviewedAt: "2026-10-29T12:00:00.000Z",
    values: { turnover: 50000, totalCharges: 750, periodMonths: 1 },
  };
  assert.deepEqual(validateDeal(merchant({ statementAnalysis })), []);
  for (const invalid of [
    { ...statementAnalysis, rawText: "Private account details" },
    { ...statementAnalysis, values: { turnover: -1 } },
    { ...statementAnalysis, values: { periodMonths: 0 } },
    { ...statementAnalysis, values: { accountNumber: "12345678" } },
    { ...statementAnalysis, currency: "USD" },
  ]) {
    assert.ok(validateDeal(merchant({ statementAnalysis: invalid })).length);
  }
});

test("effective rate uses total charges divided by transaction value times 100", () => {
  assert.equal(effectiveRate(750, 50000), 1.5);
  assert.ok(Math.abs(effectiveRate("125.50", "10000") - 1.255) < 1e-12);
  assert.equal(effectiveRate(50, 0), 0);
  assert.equal(effectiveRate(undefined, undefined), 0);
});

test("card mix percentages are independent and can overlap", () => {
  assert.equal(cardShare(12000, 40000), 30);
  const result = calculateMerchant(
    merchant({
      businessVolume: 40000,
      internationalVolume: 30000,
      amexVolume: 20000,
    }),
  );
  assert.equal(result.businessShare, 80);
  assert.equal(result.internationalShare, 60);
  assert.equal(result.amexShare, 40);
  assert.deepEqual(
    validateDeal(
      merchant({
        businessVolume: 40000,
        internationalVolume: 30000,
        amexVolume: 20000,
      }),
    ),
    [],
  );
});

test("proposed costs count Amex once and calculate monthly and annual savings", () => {
  const result = calculateMerchant(merchant());
  assert.equal(result.currentRate, 1.5);
  assert.equal(result.proposedCharges, 595);
  assert.equal(result.monthlySavings, 155);
  assert.equal(result.annualSavings, 1860);
  assert.equal(result.currentAmexCharges, 125);
});

test("missing Amex pricing yields an incomplete savings result, not free Amex", () => {
  assert.equal(offerSummary(merchant(), { rate: 1 }).monthlySavings, null);
  assert.equal(
    offerSummary(merchant({ amexVolume: 0 }), { rate: 1 }).proposedCharges,
    500,
  );
  assert.equal(
    calculateMerchant(merchant({ offers: [] })).monthlySavings,
    null,
  );
});

test("accepted offer takes precedence over later unaccepted revisions", () => {
  const result = calculateMerchant(
    merchant({
      acceptedOfferId: "first",
      offers: [
        { id: "first", rate: 1, amexRate: 2 },
        { id: "second", rate: 2, amexRate: 2 },
      ],
    }),
  );
  assert.equal(result.proposedCharges, 550);
});

test("validates amounts, impossible shares, rates, quantities, links, and sale dates", () => {
  assert.deepEqual(validateDeal(merchant()), []);
  assert.ok(validateDeal(merchant({ monthlyVolume: Infinity })).length);
  assert.ok(
    validateDeal(merchant({ businessVolume: 50001 })).some((message) =>
      message.includes("cannot exceed"),
    ),
  );
  assert.ok(
    validateDeal(merchant({ amexVolume: -1 })).some((message) =>
      message.includes("non-negative"),
    ),
  );
  assert.ok(
    validateDeal(merchant({ currentCharges: true })).some((message) =>
      message.includes("non-negative"),
    ),
  );
  assert.ok(
    validateDeal(
      merchant({
        offers: [
          {
            rate: 101,
            hardware: { terminal: 1.5 },
            acLink: "javascript:alert(1)",
          },
        ],
      }),
    ).length >= 3,
  );
  assert.ok(
    validateDeal(merchant({ status: "won", saleDate: "2026-02-30" })).length,
  );
  assert.deepEqual(
    validateDeal(merchant({ status: "won", saleDate: "2026-10-27" })),
    [],
  );
});

test("won monthly summary excludes other months and unconfirmed commission", () => {
  const deals = [
    merchant({
      status: "won",
      saleDate: "2026-10-01",
      commissionConfirmed: true,
      commissionAmount: 200,
    }),
    merchant({
      status: "won",
      saleDate: "2026-10-31",
      commissionConfirmed: false,
      commissionAmount: 999,
    }),
    merchant({
      status: "lost",
      saleDate: "2026-10-05",
      commissionConfirmed: true,
      commissionAmount: 300,
    }),
    merchant({
      status: "won",
      saleDate: "2026-09-30",
      commissionConfirmed: true,
      commissionAmount: 400,
    }),
  ];
  assert.deepEqual(monthlySummary(deals, "2026-10"), {
    wonCount: 2,
    monthlyVolume: 100000,
    confirmedCommission: 200,
    pendingCommissionCount: 1,
  });
  assert.throws(() => monthlySummary(deals, "2026-13"), /YYYY-MM/);
});

test("confirmed commission requires an entered amount and invalid accepted offers are rejected", () => {
  assert.ok(
    validateDeal(
      merchant({ commissionConfirmed: true, commissionAmount: "" }),
    ).some((message) => message.includes("confirmed commission")),
  );
  assert.ok(
    validateDeal(merchant({ acceptedOfferId: "missing" })).some((message) =>
      message.includes("accepted offer"),
    ),
  );
});

test("commission details accept incomplete values but reject invalid money and milestone dates", () => {
  const incomplete = {
    baseAmount: "",
    ogBonus: "",
    standBonus: 0,
    quickInstallBonus: null,
    posUpfrontPaid: "",
    transactedSinceInstall: "",
    rolling30DayTpv: "",
    signedMonthlyTpv: "",
    installedDate: "",
    tpvThresholdDate: "",
    upfrontPaidDate: "",
    paidInFull: false,
  };
  assert.deepEqual(
    validateDeal(merchant({ commissionDetails: incomplete })),
    [],
  );
  for (const key of [
    "baseAmount",
    "ogBonus",
    "standBonus",
    "quickInstallBonus",
    "posUpfrontPaid",
    "transactedSinceInstall",
    "rolling30DayTpv",
    "signedMonthlyTpv",
  ]) {
    for (const value of [-1, Infinity, NaN, "not a number", true, [], {}]) {
      assert.ok(
        validateDeal(merchant({ commissionDetails: { [key]: value } })).some(
          (message) => message.includes(key),
        ),
        `${key} must reject ${String(value)}`,
      );
    }
  }
  for (const key of ["installedDate", "tpvThresholdDate", "upfrontPaidDate"]) {
    assert.ok(
      validateDeal(
        merchant({ commissionDetails: { [key]: "2026-02-29" } }),
      ).some((message) => message.includes(key)),
    );
    assert.deepEqual(
      validateDeal(merchant({ commissionDetails: { [key]: "2028-02-29" } })),
      [],
    );
  }
});

test("sale information validates entered figures, optional dates, text, and safe CRM links", () => {
  assert.deepEqual(
    validateDeal(
      merchant({ status: "Won", saleDate: "2026-10-27", saleInfo: {} }),
    ),
    [],
  );
  assert.deepEqual(
    validateDeal(
      merchant({
        saleInfo: {
          expectedMonthlyTpv: "",
          maxTransactionAmount: "",
          surchargeShare: "",
          signatureDate: "",
          installationDate: "",
          crmLink: "",
        },
      }),
    ),
    [],
  );
  assert.deepEqual(
    validateDeal(
      merchant({
        saleInfo: {
          expectedMonthlyTpv: "25000",
          maxTransactionAmount: 3000,
          surchargeShare: 100,
          signatureDate: "2026-10-27",
          installationDate: "2026-11-02",
          crmLink: "https://crm.example.com/merchant/123",
        },
      }),
    ),
    [],
  );
  for (const [key, value] of Object.entries({
    expectedMonthlyTpv: -1,
    maxTransactionAmount: "oops",
    surchargeShare: 100.1,
    signatureDate: "2026-13-01",
    installationDate: "2026-04-31",
    crmLink: "javascript:alert(1)",
    registeredName: [],
    installationAddress: {},
  })) {
    assert.ok(
      validateDeal(merchant({ saleInfo: { [key]: value } })).length > 0,
      key,
    );
  }
  for (const crmLink of [
    "https://name:password@example.com",
    "data:text/html,hello",
    ["https://example.com"],
    "https://example.com/" + "a".repeat(2000),
  ]) {
    assert.ok(
      validateDeal(merchant({ saleInfo: { crmLink } })).some((message) =>
        message.includes("CRM link"),
      ),
    );
  }
});

test("malformed nested records yield validation errors without throwing", () => {
  for (const key of ["commissionDetails", "saleInfo", "checklist"]) {
    for (const value of [[], ["unexpected"], true, 12, "unexpected"]) {
      assert.ok(
        validateDeal(merchant({ [key]: value })).length > 0,
        `${key}: ${String(value)}`,
      );
    }
  }
  for (const value of [[], ["unexpected"], true, 12, "unexpected"]) {
    const deal = merchant();
    deal.offers[0].hardware = value;
    assert.ok(
      validateDeal(deal).some((message) => message.includes("hardware")),
    );
  }
  assert.ok(
    validateDeal(merchant({ offers: [null] })).some((message) =>
      message.includes("invalid"),
    ),
  );
  assert.ok(
    validateDeal(merchant({ offers: {} })).some((message) =>
      message.includes("list"),
    ),
  );
  assert.deepEqual(
    validateDeal(
      merchant({ commissionDetails: null, saleInfo: null, checklist: null }),
    ),
    [],
  );
});

test("confirmation flags require booleans and checklist items cannot use truthy strings", () => {
  for (const value of ["true", "false", 0, 1, null, "", [], {}]) {
    assert.ok(
      validateDeal(
        merchant({ commissionConfirmed: value, commissionAmount: 200 }),
      ).some((message) => message.includes("confirmation")),
    );
    assert.ok(
      validateDeal(merchant({ commissionDetails: { paidInFull: value } })).some(
        (message) => message.includes("true or false"),
      ),
    );
  }
  assert.deepEqual(
    validateDeal(
      merchant({
        commissionConfirmed: false,
        commissionDetails: { paidInFull: false },
        checklist: { companyVerified: true, bankVerified: false },
      }),
    ),
    [],
  );
  assert.ok(
    validateDeal(merchant({ checklist: { bankVerified: "false" } })).some(
      (message) => message.includes("checklist"),
    ),
  );
});

test("offer selection, metadata, and hardware shape are validated without mutating input", () => {
  const valid = merchant({ selectedOfferId: "first" });
  Object.assign(valid.offers[0], {
    date: "2026-10-27",
    manager: "Example manager",
    notes: "",
    additionalHardware: "2 receipt printers",
  });
  const before = JSON.stringify(valid);
  assert.deepEqual(validateDeal(valid), []);
  assert.equal(JSON.stringify(valid), before);
  assert.ok(
    validateDeal(merchant({ selectedOfferId: "missing" })).some((message) =>
      message.includes("selected offer"),
    ),
  );
  for (const [key, value] of Object.entries({
    id: {},
    date: "2026-02-30",
    manager: 7,
    notes: [],
    additionalHardware: {},
    acLink: ["https://example.com"],
  })) {
    const deal = merchant();
    deal.offers[0][key] = value;
    assert.ok(validateDeal(deal).length > 0, key);
  }
  const tooLong = merchant();
  Object.assign(tooLong.offers[0], {
    manager: "m".repeat(301),
    notes: "n".repeat(10001),
    additionalHardware: "h".repeat(2001),
  });
  assert.equal(validateDeal(tooLong).length, 3);
});

test("commission target dates cannot precede installation qualification", () => {
  const errors = validateDeal({
    businessName: "Date Check",
    commissionDetails: {
      installedDate: "2026-10-10",
      tpvThresholdDate: "2026-10-09",
    },
  });
  assert.ok(
    errors.some((error) => error.includes("cannot precede installation")),
  );
});
