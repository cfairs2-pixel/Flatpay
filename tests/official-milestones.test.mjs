import test from "node:test";
import assert from "node:assert/strict";
import { estimateCurrentCommission } from "../shared/official-milestones.mjs";
import { validateDeal } from "../shared/domain.mjs";

const deal = (details = {}, override = {}) => ({
  businessName: "Example merchant",
  monthlyVolume: 200000 / 12,
  offers: [{ id: "offer", rate: 1.04, amexRate: 2.99 }],
  selectedOfferId: "offer",
  commissionDetails: {
    model: "pos",
    annualTpv: 200000,
    upfrontAmount: 1000,
    ownGenerated: true,
    quickInstall: true,
    ihQuickSale: false,
    installedDate: "2026-10-01",
    activationDate: "2026-10-05",
    transactedSinceInstall: 1000,
    rolling30DayTpv: 0,
    paidInFull: false,
    amexFirstActiveMonthTpv: 0,
    ...details,
  },
  ...override,
});
const estimate = (details, override = {}, asOfDate = "2026-10-27") =>
  estimateCurrentCommission(deal(details, override), { asOfDate });
const row = (result, id) => result.breakdown.find((item) => item.id === id);

test("current activation uses 0.5% annual TPV, with a separate activation event date", () => {
  const result = estimate();
  assert.equal(result.activationThreshold, 1000);
  assert.equal(result.activationMet, true);
  assert.equal(result.total, 711); // 441 matrix +150 upfront +50 OG +50 quick install +20 AMEX.
  assert.equal(row(result, "baseFirst").eligible, 220.5);
  assert.equal(row(result, "baseFirst").payMonth, "2026-11");
  assert.equal(result.eligibleNow, 320.5);
  assert.equal(estimate({ transactedSinceInstall: 999 }).activationMet, false);
  assert.equal(
    row(estimate({ transactedSinceInstall: 125 }), "baseFirst").eligible,
    0,
  );
  const missingDate = estimate({ activationDate: "" });
  assert.equal(missingDate.activationMet, true);
  assert.equal(row(missingDate, "baseFirst").payMonth, null);
  assert.ok(missingDate.missingInputs.includes("activationDate"));
});

test("remaining half needs the annual/12 rolling target reached within six calendar months", () => {
  const result = estimate({
    rolling30DayTpv: 17000,
    tpvThresholdDate: "2026-10-20",
  });
  assert.equal(result.tpvTarget, 16666.67);
  assert.equal(result.tpvTargetMet, true);
  assert.equal(row(result, "baseSecond").eligible, 220.5);
  const missingDate = estimate({
    rolling30DayTpv: 17000,
    tpvThresholdDate: "",
  });
  assert.equal(row(missingDate, "baseSecond").eligible, null);
  assert.equal(missingDate.eligibleNow, null);
  assert.equal(
    estimate(
      { rolling30DayTpv: 17000, tpvThresholdDate: "2027-04-02" },
      {},
      "2027-04-03",
    ).tpvTargetMet,
    false,
  );
  assert.equal(
    estimate(
      { rolling30DayTpv: 17000, tpvThresholdDate: "2027-04-01" },
      {},
      "2027-04-03",
    ).tpvTargetMet,
    true,
  );
  assert.equal(
    estimate({ rolling30DayTpv: 17000, tpvThresholdDate: "2026-10-02" })
      .tpvTargetMet,
    false,
  );
});

test("upfront payment and AMEX usage keep their separate payout months", () => {
  const result = estimate(
    {
      paidInFull: true,
      upfrontPaidDate: "2026-09-25",
      amexFirstActiveMonthTpv: 123,
      amexQualificationDate: "2026-11-02",
    },
    {},
    "2026-11-03",
  );
  assert.equal(row(result, "upfront").eligible, 150);
  assert.equal(row(result, "upfront").payMonth, "2026-10"); // Full payment is a separate trigger.
  assert.equal(row(result, "amex").eligible, 20);
  assert.equal(row(result, "amex").payMonth, "2026-12");
  assert.equal(result.expectedPayMonth, null);
  assert.deepEqual(result.payMonths, ["2026-10", "2026-11", "2026-12"]);
  assert.equal(
    row(estimate({ amexFirstActiveMonthTpv: 122.99 }), "amex").eligible,
    0,
  );
  assert.equal(
    row(
      estimate({ paidInFull: true, upfrontPaidDate: "2026-11-02" }),
      "upfront",
    ).eligible,
    0,
  );
});

test("unknown model or POS upfront does not invent a complete projection", () => {
  assert.equal(estimate({ model: "" }).total, null);
  assert.ok(estimate({ model: "" }).missingInputs.includes("model"));
  assert.equal(estimate({ upfrontAmount: "" }).total, null);
  assert.equal(estimate({ model: "terminal", upfrontAmount: "" }).total, 561);
  assert.equal(estimate({ annualTpv: 0 }).total, null);
});

test("declared annual TPV fallback is explicit, selected offer wins, and device counts do not multiply", () => {
  const result = estimate(
    { annualTpv: "" },
    {
      monthlyVolume: 99999,
      saleInfo: { expectedMonthlyTpv: 10000 },
      offers: [
        { id: "offer", rate: 1.04, hardware: { terminal: 20, posPremium: 10 } },
        { id: "later", rate: 1.69 },
      ],
    },
  );
  assert.equal(result.annualTpv, 120000);
  assert.equal(result.activationThreshold, 600);
  assert.equal(
    row(result, "baseFirst").total + row(result, "baseSecond").total,
    247,
  );
  assert.ok(result.notes.some((note) => note.includes("contracted monthly")));
});

test("below-floor and legacy installations need review and do not release estimated pay", () => {
  const below = estimate({}, { offers: [{ id: "offer", rate: 0.88 }] });
  assert.equal(below.eligibleNow, null);
  assert.ok(below.missingInputs.includes("rateFloorReview"));
  const legacy = estimate({
    installedDate: "2026-06-20",
    activationDate: "2026-06-21",
    transactedSinceInstall: 123,
  });
  assert.equal(legacy.eligibleNow, null);
  assert.equal(legacy.activationMet, false);
  assert.ok(legacy.notes.some((note) => note.includes("old £123")));
});

test("cancellation reverses only recorded paid commission once, including any paid AMEX", () => {
  const result = estimate({
    cancellationDate: "2026-10-20",
    churnDate: "2026-10-22",
    paidCommissionToDate: 250,
    amexRateReducedDate: "2026-10-21",
    amexBonusPaid: 20,
  });
  assert.equal(result.churnRisk, true);
  assert.equal(result.clawback, 250);
  assert.equal(result.eligibleNow, -250);
  assert.equal(row(result, "clawback").eligible, -250);
  assert.equal(row(result, "clawback").payMonth, "2026-10");
  assert.equal(
    result.breakdown.filter((item) => item.id === "clawback").length,
    1,
  );
  assert.equal(result.pendingAmount, null);
  const unknown = estimate({
    cancellationDate: "2026-10-20",
    paidCommissionToDate: "",
  });
  assert.equal(unknown.clawback, null);
  assert.equal(unknown.eligibleNow, null);
});

test("low-usage churn uses 15% of expected THREE-month volume with seasonal exclusion", () => {
  const beforeQuarter = estimate({ firstThreeMonthsTpv: 0 }, {}, "2026-12-31");
  assert.equal(beforeQuarter.churnRisk, false);
  const below = estimate(
    {
      firstThreeMonthsTpv: 7499,
      paidCommissionToDate: 150,
      churnDate: "2027-01-02",
    },
    {},
    "2027-01-03",
  );
  assert.equal(below.churnRisk, true);
  assert.equal(below.clawback, 150);
  assert.equal(
    estimate({ firstThreeMonthsTpv: 7500 }, {}, "2027-01-03").churnRisk,
    false,
  );
  assert.equal(
    estimate({ firstThreeMonthsTpv: 0, seasonal: true }, {}, "2027-01-03")
      .churnRisk,
    false,
  );
  assert.equal(
    estimate({ firstThreeMonthsTpv: "" }, {}, "2027-01-03").churnRisk,
    false,
  );
  assert.equal(
    estimate(
      {
        firstThreeMonthsTpv: 0,
        seasonal: true,
        cancellationDate: "2026-11-01",
      },
      {},
      "2027-01-03",
    ).churnRisk,
    true,
  );
});

test("AMEX rate reduction reverses only an actually recorded paid bonus", () => {
  const result = estimate({
    amexFirstActiveMonthTpv: 123,
    amexQualificationDate: "2026-10-10",
    amexRateReducedDate: "2026-10-20",
    amexBonusPaid: 20,
  });
  assert.equal(result.churnRisk, false);
  assert.equal(result.clawback, 20);
  assert.equal(row(result, "amex").eligible, 0);
  assert.equal(row(result, "clawback").eligible, -20);
  assert.equal(result.eligibleNow, 300.5);
  const unknown = estimate({
    amexRateReducedDate: "2026-10-20",
    amexBonusPaid: "",
  });
  assert.equal(unknown.clawback, null);
  assert.equal(unknown.eligibleNow, null);
});

test("future events do not release pay and conflicting lead source requires review", () => {
  const future = estimate({
    installedDate: "2026-11-01",
    activationDate: "2026-11-03",
    transactedSinceInstall: 1000,
  });
  assert.equal(future.activationMet, false);
  assert.equal(future.eligibleNow, 0);
  const conflicting = estimate({
    ownGenerated: true,
    ihQuickSale: true,
    quickSaleDate: "2026-09-30",
  });
  assert.equal(conflicting.eligibleNow, null);
  assert.equal(row(conflicting, "quickSale").payMonth, null);
  assert.ok(conflicting.missingInputs.includes("leadSource"));
  assert.throws(
    () => estimateCurrentCommission({}, { asOfDate: "2026-02-30" }),
    /asOfDate/,
  );
});

test("upfront, AMEX and verified IH sale qualify independently from matrix activation", () => {
  const result = estimate({
    ownGenerated: false,
    quickInstall: false,
    transactedSinceInstall: 0,
    activationDate: "",
    paidInFull: true,
    upfrontPaidDate: "2026-09-20",
    amexFirstActiveMonthTpv: 123,
    amexQualificationDate: "2026-10-10",
    ihQuickSale: true,
    quickSaleDate: "2026-09-15",
  });
  assert.equal(result.activationMet, false);
  assert.equal(row(result, "baseFirst").eligible, 0);
  assert.equal(row(result, "upfront").eligible, 150);
  assert.equal(row(result, "upfront").payMonth, "2026-10");
  assert.equal(row(result, "amex").eligible, 20);
  assert.equal(row(result, "amex").payMonth, "2026-11");
  assert.equal(row(result, "quickSale").eligible, 30);
  assert.equal(row(result, "quickSale").payMonth, "2026-10");
  assert.equal(result.eligibleNow, 200);
  assert.equal(
    estimate({ upfrontAmount: "", posUpfrontPaid: 1000 }).total,
    711,
  );
});

test("validator protects current-rule inputs while permitting blank draft amounts and dates", () => {
  assert.deepEqual(
    validateDeal(
      deal({
        annualTpv: "",
        upfrontAmount: "",
        activationDate: "",
        amexBonusPaid: "",
        model: "",
      }),
    ),
    [],
  );
  for (const key of [
    "annualTpv",
    "upfrontAmount",
    "amexFirstActiveMonthTpv",
    "firstThreeMonthsTpv",
    "paidCommissionToDate",
    "amexBonusPaid",
  ]) {
    assert.ok(
      validateDeal(deal({ [key]: -1 })).some((message) =>
        message.includes(key),
      ),
    );
    assert.ok(
      validateDeal(deal({ [key]: {} })).some((message) =>
        message.includes(key),
      ),
    );
  }
  for (const key of [
    "activationDate",
    "amexQualificationDate",
    "quickSaleDate",
    "cancellationDate",
    "churnDate",
    "amexRateReducedDate",
  ])
    assert.ok(
      validateDeal(deal({ [key]: "2026-02-30" })).some((message) =>
        message.includes(key),
      ),
    );
  for (const key of ["ownGenerated", "quickInstall", "ihQuickSale", "seasonal"])
    assert.ok(
      validateDeal(deal({ [key]: "false" })).some((message) =>
        message.includes(key),
      ),
    );
  assert.ok(
    validateDeal(deal({ model: "made-up-model" })).some((message) =>
      message.includes("model"),
    ),
  );
  assert.ok(
    validateDeal(deal({ activationDate: "2026-09-30" })).some((message) =>
      message.includes("Activation date"),
    ),
  );
});
