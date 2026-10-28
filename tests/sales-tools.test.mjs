import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBundle, buildOfferSnapshot } from "../shared/sales-tools.mjs";
import { validateDeal, monthlySummary } from "../shared/domain.mjs";

const business = (id, annualTpv, currentRate, offeredRate) => ({
  id,
  name: `Business ${id}`,
  annualTpv,
  currentRate,
  offeredRate,
  businessSurcharge: 0.5,
  internationalSurcharge: 1,
  surchargeShare: 40,
  businessShare: 30,
  internationalShare: 20,
});
const offer = () => ({
  id: "ac",
  bundle: true,
  annualTpv: 100000,
  rate: 1,
  businesses: [
    business("primary", 100000, 2, 1),
    business("second", 300000, 1.5, 0.8),
  ],
});
const deal = (overrides = {}) => ({
  businessName: "Example",
  offers: [offer()],
  ...overrides,
});

test("bundle totals include each row once and use TPV-weighted rates", () => {
  const result = summarizeBundle(offer().businesses);
  assert.equal(result.count, 2);
  assert.equal(result.annualTpv, 400000);
  assert.equal(result.weightedCurrentRate, 1.625);
  assert.equal(result.weightedOfferedRate, 0.85);
  assert.equal(result.annualBaseSavings, 3100);
  assert.equal(result.tpvComplete, true);
  assert.equal(result.ratesComplete, true);
  assert.equal("surchargeShare" in result, false);
});

test("missing rates are incomplete; a quoted zero rate remains valid", () => {
  assert.equal(
    summarizeBundle([business("a", 100000, "", 1)]).annualBaseSavings,
    null,
  );
  assert.equal(
    summarizeBundle([business("a", 100000, 2, 0)]).annualBaseSavings,
    2000,
  );
  const incomplete = summarizeBundle([
    business("a", "", 2, 1),
    business("b", 50000, 2, 1),
  ]);
  assert.equal(incomplete.annualTpv, 50000);
  assert.equal(incomplete.tpvComplete, false);
  assert.equal(incomplete.weightedCurrentRate, null);
  assert.equal(summarizeBundle([]).weightedOfferedRate, null);
});

test("offer snapshots preserve per-business surcharge terms without changing source or commission sale count", () => {
  const source = deal({
    status: "Won",
    saleDate: "2026-10-27",
    monthlyVolume: 10000,
  });
  const snapshot = buildOfferSnapshot(source, source.offers[0]);
  assert.equal(snapshot.summary.annualTpv, 400000);
  assert.equal(snapshot.businesses[0].businessShare, 30);
  assert.equal(snapshot.businesses[0].internationalShare, 20);
  const single = buildOfferSnapshot(source, {
    id: "single",
    businessShare: 80,
    internationalShare: 70,
  });
  assert.equal(single.businesses[0].businessShare, 80);
  assert.equal(single.businesses[0].internationalShare, 70);
  snapshot.businesses[0].name = "Changed copy";
  assert.equal(source.offers[0].businesses[0].name, "Business primary");
  assert.equal(monthlySummary([source], "2026-10").wonCount, 1);
  assert.equal(buildOfferSnapshot(source, null), null);
});

test("AC fields validate rates and bundle identities while retaining optional legacy offers", () => {
  assert.deepEqual(validateDeal(deal()), []);
  assert.deepEqual(
    validateDeal(deal({ offers: [{ id: "legacy", rate: 1 }] })),
    [],
  );
  const invalid = offer();
  invalid.businessSurcharge = 101;
  invalid.businesses[1].id = "primary";
  invalid.businesses[1].annualTpv = -1;
  invalid.businesses[1].surchargeShare = 101;
  invalid.businesses[1].businessShare = 101;
  invalid.internationalShare = 101;
  const messages = validateDeal(deal({ offers: [invalid] }));
  assert.ok(messages.some((s) => s.includes("businessSurcharge")));
  assert.ok(messages.some((s) => s.includes("IDs must be unique")));
  assert.ok(messages.some((s) => s.includes("annual TPV")));
  assert.ok(messages.some((s) => s.includes("surchargeShare")));
  assert.ok(messages.some((s) => s.includes("businessShare")));
  assert.ok(messages.some((s) => s.includes("internationalShare")));
  assert.ok(
    validateDeal(
      deal({
        offers: [
          {
            id: "single",
            bundle: true,
            businesses: [business("one", 1, 1, 1)],
          },
        ],
      }),
    ).some((s) => s.includes("at least two")),
  );
});

test("notes, printable offers and closing deals reject malformed content and foreign offer references", () => {
  assert.deepEqual(
    validateDeal(
      deal({
        meetingNotes: [
          {
            id: "n1",
            title: "Meeting",
            date: "2026-10-27",
            body: "Discussed savings",
            actions: ["Call Friday"],
            nextFollowUp: "2026-10-30",
          },
        ],
        offerSheet: {
          offerId: "ac",
          validUntil: "2026-10-30",
          preparedBy: "Alex",
          terms: "Subject to approval",
        },
        closingDeal: { offerId: "ac", rate: 0.9, approved: false },
      }),
    ),
    [],
  );
  const invalid = validateDeal(
    deal({
      meetingNotes: [{ id: "n1", date: "2026-02-30", body: {} }],
      offerSheet: { offerId: "foreign", validUntil: "wrong" },
      closingDeal: { offerId: "foreign", rate: 101, approved: "yes" },
    }),
  );
  assert.ok(invalid.some((s) => s.includes("valid date")));
  assert.ok(invalid.some((s) => s.includes("offer sheet must reference")));
  assert.ok(invalid.some((s) => s.includes("Closing deal approval")));
});
