import test from "node:test";
import assert from "node:assert/strict";
import {
  STATEMENT_FIELDS,
  parseMerchantStatement,
  calculateStatement,
  buildStatementPatch,
  validateStatementAnalysis,
} from "../shared/merchant-statement.mjs";

test("monthly labelled processing statement extracts totals, card mix and fees without retaining identifiers", () => {
  const result = parseMerchantStatement(`Worldpay merchant statement
Merchant name: Example Coffee Ltd
Statement period: 01/10/2026 - 31/10/2026
Merchant ID: 123456789012
Account number: 987654321
Total card turnover: £20,000.00
Total charges: £300.00
Net settlement: £19,700.00
Processing fees: £260.00
Terminal rental: £20.00
PCI compliance fees: £5.00
Other fees: £5.00
VAT charged: £10.00
Business card turnover: £4,000.00
International card turnover: £3,000.00
Amex turnover: £1,000.00
Amex rate: 2.5%
Number of card payments: 1,000`);
  assert.equal(result.values.provider, "Worldpay");
  assert.equal(result.values.businessName, "Example Coffee Ltd");
  assert.equal(result.values.periodMonths, 1);
  assert.equal(result.values.turnover, 20000);
  assert.equal(result.values.totalCharges, 300);
  assert.equal(result.values.processingFees, 260);
  assert.equal(result.values.terminalRental, 20);
  assert.equal(result.values.pciFees, 5);
  assert.equal(result.values.otherFees, 5);
  assert.equal(result.values.vat, 10);
  const calc = calculateStatement(result.values);
  assert.equal(calc.monthlyVolume, 20000);
  assert.equal(calc.monthlyCharges, 300);
  assert.equal(calc.effectiveRate, 1.5);
  assert.equal(calc.annualTpv, 240000);
  assert.equal(calc.businessShare, 20);
  assert.equal(calc.internationalShare, 15);
  assert.equal(calc.amexShare, 5);
  assert.equal(calc.averageTransactionValue, 20);
  for (const secret of ["123456789012", "987654321", "19,700"])
    assert.ok(!JSON.stringify(result).includes(secret));
});

test("identical summary totals deduplicate while conflicting totals stay unresolved", () => {
  const duplicate = parseMerchantStatement(
    "Monthly statement\nTotal card turnover £20,000.00\nTotal charges £300.00\nTotal card turnover £20,000.00\nTotal charges £300.00",
  );
  assert.equal(duplicate.values.turnover, 20000);
  assert.equal(duplicate.values.totalCharges, 300);
  const conflict = parseMerchantStatement(
    "Monthly statement\nTotal card turnover £20,000.00\nTotal card turnover £12,000.00\nTotal charges £300.00\nTotal charges £240.00",
  );
  assert.equal(conflict.values.turnover, undefined);
  assert.equal(conflict.values.totalCharges, undefined);
  assert.ok(
    conflict.warnings.some((warning) => /Conflicting.*turnover/.test(warning)),
  );
});

test("unknown period retains statement figures but cannot become monthly or annual values", () => {
  const result = parseMerchantStatement(
    "Total card turnover £20,000.00\nTotal charges £300.00",
  );
  assert.equal(result.values.periodMonths, undefined);
  const calc = calculateStatement(result.values);
  assert.equal(calc.monthlyVolume, null);
  assert.equal(calc.monthlyCharges, null);
  assert.equal(calc.annualTpv, null);
  assert.equal(calc.effectiveRate, 1.5);
  assert.throws(
    () => buildStatementPatch(result.values, ["turnover", "totalCharges"]),
    /months covered/,
  );
});

test("quarterly dates normalize exact totals and partial month dates require explicit review", () => {
  const quarter = parseMerchantStatement(
    "Statement period: 01/07/2026 - 30/09/2026\nTotal card turnover £60,000.00\nTotal charges £900.00",
  );
  assert.equal(quarter.values.periodMonths, 3);
  assert.equal(calculateStatement(quarter.values).monthlyVolume, 20000);
  assert.equal(calculateStatement(quarter.values).annualTpv, 240000);
  const partial = parseMerchantStatement(
    "Monthly statement\nStatement period: 15/10/2026 - 31/10/2026\nTotal card turnover £10,000.00\nTotal charges £150.00",
  );
  assert.equal(partial.values.periodMonths, undefined);
  assert.equal(calculateStatement(partial.values).annualTpv, null);
  assert.ok(partial.warnings.some((warning) => /partial month/.test(warning)));
});

test("card table uses value column rather than count, percentage rate or processing fee column", () => {
  const result = parseMerchantStatement(
    "Monthly statement\nCard type  Transactions  Value  Rate  Charges\nBusiness cards  20  £4,000.00  1.9%  £76.00\nInternational cards  10  £3,000.00  2.9%  £87.00\nAmex  5  £1,000.00  2.5%  £25.00\nTotal  100  £20,000.00  1.5%  £300.00\nTotal charges £340.00",
  );
  assert.equal(result.values.businessVolume, 4000);
  assert.equal(result.values.internationalVolume, 3000);
  assert.equal(result.values.amexVolume, 1000);
  assert.equal(result.values.amexRate, 2.5);
  assert.equal(result.values.turnover, 20000);
  assert.equal(result.values.transactionCount, 100);
  assert.equal(result.values.processingFees, 300);
  assert.equal(result.values.totalCharges, 340);
  assert.equal(
    parseMerchantStatement("Business cards: 20 transactions 1.9% £76.00").values
      .businessVolume,
    undefined,
  );
});

test("bank balances, settlement payouts and per-item prices do not become card turnover or charges", () => {
  const result = parseMerchantStatement(
    "Monthly statement\nOpening balance £20,000.00\nClosing balance £21,000.00\nNet settlement £19,700.00\nMoney in £24,000.00\nTotal charges per payment 15p\nProcessing fees: 20 transactions at 1.9% £76.00\nMerchant number 123456789",
  );
  assert.equal(result.values.turnover, undefined);
  assert.equal(result.values.totalCharges, undefined);
  assert.equal(result.values.processingFees, 76);
  assert.equal(result.values.businessName, undefined);
});

test("VAT subtotal is only added when explicitly labelled and is never added to an existing total", () => {
  const derived = parseMerchantStatement(
    "Monthly statement\nTotal fees excluding VAT: £100.00\nVAT @ 20% £20.00\nTerminal rental £10.00",
  );
  assert.equal(derived.values.totalCharges, 120);
  assert.equal(derived.values.vat, 20);
  assert.equal(
    parseMerchantStatement("Total fees: £100.00 (ex VAT)\nVAT £20.00").values
      .totalCharges,
    120,
  );
  const explicit = parseMerchantStatement(
    "Monthly statement\nTotal charges including VAT: £120.00\nTotal fees excluding VAT: £100.00\nVAT charged £20.00\nTerminal rental £10.00",
  );
  assert.equal(explicit.values.totalCharges, 120);
  const unknown = parseMerchantStatement(
    "Monthly statement\nProcessing fees £100.00\nTerminal rental £10.00\nVAT £2.00",
  );
  assert.equal(unknown.values.totalCharges, undefined);
});

test("zero values remain zero, absent values remain null and overlapping categories are independent", () => {
  const zero = parseMerchantStatement(
    "Monthly statement\nTotal card turnover £0.00\nTotal charges £0.00\nBusiness card turnover £0.00\nNumber of card payments: 0",
  );
  assert.equal(zero.values.turnover, 0);
  assert.equal(zero.values.totalCharges, 0);
  assert.equal(calculateStatement(zero.values).monthlyVolume, 0);
  assert.equal(calculateStatement(zero.values).effectiveRate, null);
  const calc = calculateStatement({
    turnover: 10000,
    totalCharges: 0,
    periodMonths: 1,
    businessVolume: 9000,
    internationalVolume: 9000,
  });
  assert.equal(calc.effectiveRate, 0);
  assert.equal(calc.businessShare, 90);
  assert.equal(calc.internationalShare, 90);
  assert.equal(calc.amexShare, null);
  assert.deepEqual(calc.warnings, []);
});

test("foreign or mixed currency monetary values need manual GBP review", () => {
  for (const text of [
    "Monthly statement\nTotal card turnover USD 20,000.00\nTotal charges USD 300.00",
    "Monthly statement\nTotal card turnover £20,000.00\nInternational sales EUR 1000.00\nTotal charges £300.00",
  ]) {
    const result = parseMerchantStatement(text);
    assert.equal(result.values.turnover, undefined);
    assert.equal(result.values.totalCharges, undefined);
    assert.ok(result.warnings.some((warning) => /non-GBP/.test(warning)));
  }
});

test("review patch is whitelisted, selective and keeps annual estimates out of commission and AC declarations", () => {
  const values = {
    provider: "Worldpay",
    periodMonths: 3,
    turnover: 60000,
    totalCharges: 900,
    businessVolume: 12000,
    transactionCount: 3000,
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    rawText: "SENSITIVE",
  };
  const deal = {
    monthlyVolume: 0,
    businessVolume: 0,
    commissionDetails: { annualTpv: 500000 },
    offers: [{ annualTpv: 500000 }],
  };
  const patch = buildStatementPatch(
    values,
    ["provider", "periodMonths", "turnover", "totalCharges", "businessVolume"],
    deal,
  );
  assert.equal(patch.monthlyVolume, 20000);
  assert.equal(patch.currentCharges, 300);
  assert.equal(patch.businessVolume, 4000);
  assert.equal(patch.provider, "Worldpay");
  assert.equal(patch.commissionDetails, undefined);
  assert.equal(patch.offers, undefined);
  assert.equal(patch.statementAnalysis.values.periodStart, undefined);
  assert.equal(patch.statementAnalysis.values.rawText, undefined);
  assert.equal(patch.statementAnalysis.values.transactionCount, undefined);
  assert.deepEqual(validateStatementAnalysis(patch.statementAnalysis), []);
  assert.deepEqual(buildStatementPatch(values, []), {});
  assert.throws(
    () => buildStatementPatch(values, ["rawText"]),
    /Only reviewed/,
  );
  assert.equal(deal.commissionDetails.annualTpv, 500000);
});

test("invalid reviewed figures and conflicting existing card mix are rejected before records are changed", () => {
  assert.throws(
    () =>
      buildStatementPatch(
        { periodMonths: 1, turnover: 1000, businessVolume: 2000 },
        ["periodMonths", "turnover", "businessVolume"],
      ),
    /exceeds/,
  );
  assert.throws(
    () =>
      buildStatementPatch(
        { periodMonths: 1, turnover: 1000 },
        ["periodMonths", "turnover"],
        { businessVolume: 2000 },
      ),
    /exceeds/,
  );
  assert.throws(
    () =>
      buildStatementPatch({ periodMonths: 0, turnover: 1000 }, [
        "periodMonths",
        "turnover",
      ]),
    /months covered/,
  );
  assert.throws(
    () => buildStatementPatch({ amexRate: 101 }, ["amexRate"]),
    /amex/i,
  );
  assert.throws(
    () =>
      buildStatementPatch({ turnover: -1, periodMonths: 1 }, [
        "turnover",
        "periodMonths",
      ]),
    /turnover/,
  );
});

test("saved statement validation rejects raw files, unknown fields and malformed scalars", () => {
  const valid = {
    version: 1,
    currency: "GBP",
    reviewedAt: "2026-10-29T12:00:00.000Z",
    values: { periodMonths: 1, turnover: 20000, totalCharges: 300 },
  };
  assert.deepEqual(validateStatementAnalysis(valid), []);
  for (const changed of [
    { ...valid, file: "photo" },
    { ...valid, currency: "EUR" },
    { ...valid, reviewedAt: "yesterday" },
    { ...valid, values: { rawText: "sensitive" } },
    { ...valid, values: { turnover: { amount: 2 } } },
    { ...valid, values: { transactionCount: 1.5 } },
  ])
    assert.ok(validateStatementAnalysis(changed).length);
  assert.equal(STATEMENT_FIELDS.length, 17);
  assert.throws(() => parseMerchantStatement("x".repeat(300001)), /300,000/);
  assert.deepEqual(parseMerchantStatement("").values, {});
});

test("bank statements and malformed European amounts never become automatic processing figures", () => {
  const bank = parseMerchantStatement(
    "BANK STATEMENT\nAccount number 12345678\nClosing balance £2000.00\nTotal charges £20.00",
  );
  assert.equal(bank.values.totalCharges, undefined);
  assert.ok(bank.warnings.some((warning) => /bank statement/i.test(warning)));
  for (const bad of ["£12.345,67", "£1,23.45", "£123.456"])
    assert.equal(
      parseMerchantStatement(`Total card turnover ${bad}`).values.turnover,
      undefined,
    );
  const provider = parseMerchantStatement(
    "Dojo merchant statement\nCurrent provider: Worldpay",
  );
  assert.equal(provider.values.provider, "Worldpay");
  assert.ok(
    validateStatementAnalysis({
      version: 1,
      currency: "GBP",
      reviewedAt: "2026-02-31T12:00:00.000Z",
      values: { turnover: [] },
    }).length,
  );
});

test("generic invoice amount due is not a processing cost and refunds prompt turnover-basis review", () => {
  assert.equal(
    parseMerchantStatement("Invoice\nTotal amount due £500.00").values
      .totalCharges,
    undefined,
  );
  const merchant = parseMerchantStatement(
    "Worldpay merchant statement\nTotal amount due £500.00\nTotal card turnover £20,000.00\nRefunds £300.00",
  );
  assert.equal(merchant.values.totalCharges, 500);
  assert.ok(merchant.warnings.some((warning) => /gross or net/.test(warning)));
});
