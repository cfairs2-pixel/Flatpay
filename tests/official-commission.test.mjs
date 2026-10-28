import test from "node:test";
import assert from "node:assert/strict";
import {
  lookupMatrix,
  upfrontBonus,
  posVolumeBonus,
  amexRateBonus,
  calculatePortfolioCommission,
  calculateOfferCommission,
  SCENARIOS,
} from "../shared/official-commission.mjs";

test("official published examples match executable calculator totals", () => {
  assert.deepEqual(
    SCENARIOS.map((s) => calculatePortfolioCommission(s.v).headline),
    [8117, 10622, 4204],
  );
  const budget = calculatePortfolioCommission(SCENARIOS[0].v);
  assert.deepEqual(
    [budget.termPer, budget.posPer, budget.mposPer],
    [203, 441, 198],
  );
});
test("matrix preserves rate floor and exact anchor points", () => {
  assert.equal(lookupMatrix(0.49, 100000, "terminal"), 99);
  assert.equal(lookupMatrix(0.489, 100000, "terminal"), 0);
  assert.equal(lookupMatrix(0.89, 200000, "pos"), 387);
  assert.equal(lookupMatrix(0.889, 200000, "pos"), 0);
  assert.equal(lookupMatrix(0.889, 200000, "mpos"), 0);
  assert.equal(lookupMatrix(1.69, 500000, "mpos"), 1035);
});
test("matrix interpolates in two dimensions and matches source rounding", () => {
  assert.equal(lookupMatrix(1.04, 200000, "pos"), 441);
  assert.equal(lookupMatrix(0.79, 125000, "terminal"), 203);
  assert.equal(lookupMatrix(1.04, 125000, "pos"), 259);
  assert.equal(lookupMatrix(0.79, 48000, "terminal"), 54);
});
test("calculator clamps both TPV endpoints and maximum rate", () => {
  assert.equal(lookupMatrix(0.89, 0, "pos"), 63);
  assert.equal(lookupMatrix(0.89, 700000, "pos"), 603);
  assert.equal(lookupMatrix(2, 500000, "pos"), 1035);
});
test("POS and MPOS threshold penalties and whole-pound upfront bonuses", () => {
  assert.equal(upfrontBonus(499.99, "pos"), -100);
  assert.equal(upfrontBonus(500, "pos"), 75);
  assert.equal(upfrontBonus(249.99, "mpos"), -100);
  assert.equal(upfrontBonus(250, "mpos"), 38);
  assert.equal(upfrontBonus(2495, "pos"), 374);
  assert.equal(upfrontBonus(1495, "pos"), 224);
  assert.equal(upfrontBonus(995, "mpos"), 149);
});
test("POS volume ladder counts deals, handles every cliff and beyond ten", () => {
  assert.deepEqual(
    Array.from({ length: 13 }, (_, n) => posVolumeBonus(n)),
    [0, 0, 200, 350, 600, 1000, 1500, 2200, 2800, 3300, 3800, 4100, 4400],
  );
  assert.equal(calculatePortfolioCommission({ mposInst: 10 }).posVol, 0);
});
test("Amex differentiated rates use exact documented bonus levels", () => {
  assert.deepEqual(
    [3.89, 2.99, 2.49, 1.99, 2.5, 3.891].map(amexRateBonus),
    [40, 20, 10, 0, 0, 0],
  );
});
test("portfolio applies target reduction only to matrix back half", () => {
  const full = calculatePortfolioCommission(SCENARIOS[0].v);
  const zero = calculatePortfolioCommission({ ...SCENARIOS[0].v, hitRate: 0 });
  assert.equal(full.realisedRaw - zero.realisedRaw, full.matrix / 2);
  assert.equal(full.upfront, zero.upfront);
  assert.equal(full.posVol, zero.posVol);
});
test("guarantee tops up rather than adding salary and is never a per-deal bonus", () => {
  const result = calculatePortfolioCommission({});
  assert.equal(result.headline, 0);
  assert.equal(result.realised, 2120);
  assert.equal(result.guaranteeTopup, 2120);
  const deal = calculateOfferCommission({
    product: "terminal",
    rate: 0.79,
    annualTpv: 125000,
  });
  assert.equal(deal.headline, 203);
});
test("offer projection counts once and preserves unknown upfront amount", () => {
  const options = {
    product: "pos",
    rate: 1.04,
    annualTpv: 200000,
    ownGenerated: true,
    quickInstallation: true,
    amexRate: 2.99,
  };
  assert.equal(calculateOfferCommission(options).headline, null);
  const result = calculateOfferCommission({
    ...options,
    upfront: 1000,
    hardware: { posPremium: 5 },
  });
  assert.equal(result.headline, 711);
  assert.equal(result.activationThreshold, 1000);
  assert.equal(result.tpvTarget, 16666.67);
});
test("below-floor and over-cap projections disclose source discrepancies", () => {
  const result = calculateOfferCommission({
    product: "pos",
    rate: 0.79,
    annualTpv: 700000,
    upfront: 1000,
  });
  assert.equal(result.floorMet, false);
  assert.equal(result.matrix, 0);
  assert.ok(result.notes.some((n) => n.includes("Manager confirmation")));
  assert.ok(result.notes.some((n) => n.includes("caps annual TPV")));
});
test("invalid monetary inputs, product names, counts and percentages are rejected", () => {
  assert.throws(() => lookupMatrix(-1, 100000, "pos"));
  assert.throws(() => lookupMatrix(1, NaN, "pos"));
  assert.throws(() => lookupMatrix(1, 100000, "unknown"));
  assert.throws(() => posVolumeBonus(2.5));
  assert.throws(() => calculatePortfolioCommission({ hitRate: 101 }));
});
