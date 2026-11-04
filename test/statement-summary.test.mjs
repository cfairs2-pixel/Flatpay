import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { extendStatementSummary } from '../public/statement-summary.mjs';
import { validateFeeReview } from '../public/statement-fees.mjs';

// Exercise the actual parser and application functions in the retained bundle.
const source = await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8');
const begin = source.indexOf('af=Object.freeze');
const end = source.indexOf('const fA=', begin);
assert(begin > 0 && end > begin);
const context = { extendStatementSummary, validateFeeReview };
vm.runInNewContext(`const ${source.slice(begin, end)}; globalThis.reader={parse:tA,calculate:Pd,apply:eA,validate:rf};`, context);
const { parse, calculate, apply, validate } = context.reader;

// Synthetic figures retain the reported layout; no customer photo or real
// statement text/amounts are published with these tests.
const annual = `Your card payments summary
About You
Your transaction split over the last 12 months¹
Mastercard Debit 20.00% Credit 20.00% Business 5.00%
VISA Debit 30.00% Credit 20.00% Business 5.00%
Your total charges in the last
12 months
£3,600.00
Your average transaction value £240.00
Your total card transactions
in the last 12 months
£480,000.00
Your merchant category code (MCC) 7538-Automotive Serv
Your contract ends on 31 October 2026
Your costs for accepting common individual card payments
Debit 0.26% + £0.00 Credit 1.83% + £0.00
Additional charges per transaction Authorisation Fee £0.03
Chargeback Fee £9.00
Other monthly charges
Minimum monthly service charge (MMSC) £20.00`;

test('annual photographed-summary labels produce period totals and monthly averages', () => {
  const result = parse(annual);
  assert.equal(result.values.periodMonths, 12);
  assert.equal(result.values.turnover, 480000);
  assert.equal(result.values.totalCharges, 3600);
  const figures = calculate(result.values);
  assert.equal(figures.monthlyVolume, 40000);
  assert.equal(figures.monthlyCharges, 300);
  assert.equal(figures.effectiveRate, 0.75);
  assert(result.warnings.some(message => /Monthly figures are averages/.test(message)));
  assert(!result.warnings.some(message => /^A clear (?:card-turnover total|total charge) was not found/.test(message)));
});

test('reader does not infer transaction counts, card value mix or dates from other summary details', () => {
  const { values, warnings } = parse(annual);
  for (const key of ['transactionCount', 'businessVolume', 'internationalVolume', 'amexVolume', 'amexRate', 'periodStart', 'periodEnd', 'terminalRental', 'pciFees', 'otherFees']) assert.equal(values[key], undefined, key);
  assert(warnings.some(message => /split is not confirmed as a share of transaction value/.test(message)));
});

test('two-column OCR lines and currency glyph confusion retain nearby labelled totals', () => {
  const result = parse(`Your card payments summary
Your transaction split over the last 12 months
Your total charges in the last E3,600.00 Your average transaction value £240.00
12 months
Your total card transactions E480,000.00 Your merchant category code (MCC)
in the last 12 months 7538-Automotive Serv`);
  assert.equal(result.values.totalCharges, 3600);
  assert.equal(result.values.turnover, 480000);
  assert.equal(result.values.periodMonths, 12);
});

test('unambiguous repeated-dot OCR money is corrected with an explicit review warning', () => {
  const result = parse('Your card payments summary\nlast 12 months\nYour total card transactions £480.000.00\nYour total charges £3,600.00');
  assert.equal(result.values.turnover, 480000);
  assert.equal(result.values.totalCharges, 3600);
  assert(result.warnings.some(message => /thousands separator as a dot/.test(message)));
  const ambiguous = parse('Your card payments summary\nlast 12 months\nYour total card transactions £48.00.00');
  assert.equal(ambiguous.values.turnover, undefined);
});

test('annual card-payment value wording is supported while ordinary monthly parsing is retained', () => {
  const result = parse('Annual card payment summary\nGBP\nTotal value of card payments £120,000.00\nTotal charges £900.00');
  assert.equal(result.values.turnover, 120000);
  assert.equal(result.values.totalCharges, 900);
  assert.equal(result.values.periodMonths, 12);
  const monthly = parse('Monthly statement\nGBP\nTotal card turnover £40,000.00\nTotal charges £300.00');
  assert.equal(monthly.values.turnover, 40000);
  assert.equal(monthly.values.totalCharges, 300);
  assert.equal(monthly.values.periodMonths, 1);
});

test('annual totals are preserved when selected figures fill a customer draft', () => {
  const { values } = parse(annual);
  const patch = apply(values, ['periodMonths', 'turnover', 'totalCharges'], {});
  assert.equal(patch.monthlyVolume, 40000);
  assert.equal(patch.currentCharges, 300);
  assert.equal(patch.statementAnalysis.values.turnover, 480000);
  assert.equal(patch.statementAnalysis.values.totalCharges, 3600);
  assert.equal(patch.statementAnalysis.values.periodMonths, 12);
  assert.equal(validate({ businessName: 'Synthetic shop', offers: [], ...patch }).length, 0);
});

test('applied fee metadata passes actual customer validation and unresolved metadata fails', () => {
  const { values } = parse(annual);
  const analysis = apply(values, ['periodMonths', 'turnover', 'totalCharges'], {}).statementAnalysis;
  analysis.feeReview = { version: 1, terminalRental: { status: 'separate', amount: 40, frequency: 'monthly' }, pciFees: { status: 'included' } };
  assert.equal(validate({ businessName: 'Synthetic shop', offers: [], statementAnalysis: analysis }).length, 0);
  analysis.feeReview.pciFees.status = 'unknown';
  assert(validate({ businessName: 'Synthetic shop', offers: [], statementAnalysis: analysis }).some(error => /PCI fees/.test(error)));
});

test('annual charges use the original total rather than rounded monthly pennies', () => {
  const result = parse('Your card payments summary\nlast 12 months\nYour total card transactions £240,000.01\nYour total charges £1,000.01');
  const figures = calculate(result.values);
  assert.equal(figures.monthlyCharges, 83.33);
  assert.equal(figures.annualCharges, 1000.01);
  assert.equal(figures.annualTpv, 240000.01);
});

test('conflicting amounts or periods require manual review', () => {
  const conflict = parse(annual + '\nYour total charges in the last 12 months £3,700.00');
  assert.equal(conflict.values.totalCharges, undefined);
  assert(conflict.warnings.some(message => /Conflicting/.test(message)));
  const periods = parse(annual + '\nMonthly statement');
  assert.equal(periods.values.periodMonths, undefined);
  assert(periods.warnings.some(message => /period disagree/.test(message)));
});

test('foreign currency and bank statements cannot become GBP merchant totals', () => {
  const currency = parse(annual.replaceAll('£', '€'));
  assert.equal(currency.values.turnover, undefined);
  assert.equal(currency.values.totalCharges, undefined);
  const bank = parse('Bank statement\nOpening balance\nAccount number 12345678\n' + annual);
  assert.equal(bank.values.turnover, undefined);
  assert.equal(bank.values.totalCharges, undefined);
});

test('multiple possible amounts and negative charge values are not silently selected', () => {
  const multiple = parse('Your card payments summary\nlast 12 months\nYour total charges £900.00 £1,100.00\nYour total card transactions £120,000.00');
  assert.equal(multiple.values.totalCharges, undefined);
  for (const money of ['-£900.00', '£-900.00', '£900.00 CR']) {
    const negative = parse(`Your card payments summary\nlast 12 months\nYour total charges ${money}\nYour total card transactions £120,000.00`);
    assert.equal(negative.values.totalCharges, undefined, money);
  }
});

test('position-matched candidates recover totals from interleaved summary boxes', () => {
  const text = 'Your card payments summary\nlast 12 months\nYour total card    Your total    Your average\ntransactions    charges    transaction value\n£120,000.00    £900.00    £25.00';
  const result = parse(text, { candidates: [
    { field: 'turnover', value: 120000, evidence: 'Card turnover matched in its summary box' },
    { field: 'totalCharges', value: 900, evidence: 'Total charges matched in its summary box' },
  ] });
  assert.equal(result.values.turnover, 120000);
  assert.equal(result.values.totalCharges, 900);
  assert.equal(result.values.periodMonths, 12);
  assert.match(result.evidence.totalCharges, /matched/);
});

test('an ambiguous spatial match cannot fall back to a guessed plain-text amount', () => {
  const result = parse('Your card payments summary\nlast 12 months\nYour total charges £900.00\nYour total card transactions £120,000.00', { blockedFields: ['totalCharges'] });
  assert.equal(result.values.totalCharges, undefined);
  assert.equal(result.values.turnover, 120000);
});

test('conflicting layout totals require manual review and a text correction ignores old geometry', () => {
  const text = 'Your card payments summary\nlast 12 months\nYour total charges £900.00';
  const result = parse(text, { candidates: [{ field: 'totalCharges', value: 900 }, { field: 'totalCharges', value: 1000 }] });
  assert.equal(result.values.totalCharges, undefined);
  assert.equal(parse(text).values.totalCharges, 900);
});
