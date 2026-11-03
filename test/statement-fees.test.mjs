import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFeeReview,
  validateFeeReview,
  canonicalFeeReview,
  calculateStatementCosts,
  applyStatementFees,
} from '../public/statement-fees.mjs';

// Synthetic calculations only; no customer documents or financial records.
const annualValues = { periodMonths: 12, turnover: 480000, totalCharges: 3600 };
const annualFigures = {
  monthlyVolume: 40000,
  annualTpv: 480000,
  monthlyCharges: 300,
  annualCharges: 3600,
  effectiveRate: 0.75,
  warnings: [],
};

function review(terminalRental = { status: 'included' }, pciFees = { status: 'none' }) {
  return { version: 1, terminalRental, pciFees };
}

function separate(amount, frequency) {
  return { status: 'separate', amount, frequency };
}

function patch(values = annualValues) {
  return {
    businessName: 'Synthetic fee calculation',
    monthlyVolume: 40000,
    currentCharges: 300,
    statementAnalysis: {
      version: 1,
      currency: 'GBP',
      reviewedAt: '2026-11-01T12:00:00.000Z',
      values: structuredClone(values),
    },
  };
}

function close(actual, expected) {
  assert.equal(typeof actual, 'number');
  assert(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test('new fee review starts unresolved and has independent editable fields', () => {
  const first = emptyFeeReview();
  assert.deepEqual(first, {
    version: 1,
    terminalRental: { status: 'unknown', amount: '', frequency: 'monthly' },
    pciFees: { status: 'unknown', amount: '', frequency: 'monthly' },
  });
  assert(validateFeeReview(first).length > 0);
  assert.throws(() => canonicalFeeReview(first));
  first.terminalRental.amount = '40';
  assert.equal(emptyFeeReview().terminalRental.amount, '');
  assert.equal(first.pciFees.amount, '');
});

test('included and absent fees are confirmed without retaining unused amounts', () => {
  const input = review(
    { status: 'included', amount: 999, frequency: 'annual' },
    { status: 'none', amount: 999, frequency: 'monthly' },
  );
  assert.deepEqual(validateFeeReview(input), []);
  assert.deepEqual(canonicalFeeReview(input), {
    version: 1,
    terminalRental: { status: 'included' },
    pciFees: { status: 'none' },
  });
  const figures = calculateStatementCosts(annualValues, input, annualFigures);
  assert.equal(figures.separateMonthlyCharges, 0);
  assert.equal(figures.adjustedPeriodCharges, 3600);
  assert.equal(figures.monthlyCharges, 300);
  assert.equal(figures.annualCharges, 3600);
  close(figures.effectiveRate, 0.75);
  assert.equal(figures.feeReviewComplete, true);
});

test('separate monthly rental and annual PCI fees adjust one annual period', () => {
  const input = review(separate(40, 'monthly'), separate(120, 'annual'));
  assert.deepEqual(validateFeeReview(input), []);
  const figures = calculateStatementCosts(annualValues, input, annualFigures);
  assert.equal(figures.statementMonthlyCharges, 300);
  assert.equal(figures.separateMonthlyCharges, 50);
  assert.equal(figures.adjustedPeriodCharges, 4200);
  assert.equal(figures.monthlyCharges, 350);
  assert.equal(figures.annualCharges, 4200);
  close(figures.effectiveRate, 0.875);
  assert.equal(figures.feeReviewComplete, true);
  assert.equal(figures.monthlyVolume, 40000);
  assert.equal(figures.annualTpv, 480000);
  assert.notEqual(figures.feeBreakdown, undefined);
});

test('quarterly fees and annual fees use the reviewed number of months', () => {
  const figures = calculateStatementCosts(
    { periodMonths: 6, turnover: 60000, totalCharges: 600 },
    review(separate(90, 'quarterly'), separate(120, 'annual')),
  );
  assert.equal(figures.separateMonthlyCharges, 40);
  assert.equal(figures.adjustedPeriodCharges, 840);
  assert.equal(figures.monthlyCharges, 140);
  assert.equal(figures.annualCharges, 1680);
  close(figures.effectiveRate, 1.4);
});

test('fractional statement periods scale recurring fees without assuming a full quarter', () => {
  const figures = calculateStatementCosts(
    { periodMonths: 1.5, turnover: 15000, totalCharges: 150 },
    review(separate(90, 'quarterly'), separate(120, 'annual')),
  );
  assert.equal(figures.separateMonthlyCharges, 40);
  assert.equal(figures.adjustedPeriodCharges, 210);
  assert.equal(figures.monthlyCharges, 140);
  assert.equal(figures.annualCharges, 1680);
  close(figures.effectiveRate, 1.4);
});

test('statement-period fees are added once rather than once per month', () => {
  const figures = calculateStatementCosts(
    { periodMonths: 6, turnover: 60000, totalCharges: 600 },
    review(separate(120, 'statement'), separate(60, 'annual')),
  );
  assert.equal(figures.adjustedPeriodCharges, 750);
  assert.equal(figures.separateMonthlyCharges, 25);
  assert.equal(figures.monthlyCharges, 125);
  assert.equal(figures.annualCharges, 1500);
  close(figures.effectiveRate, 1.25);
});

test('annual totals retain pennies instead of multiplying rounded monthly charges', () => {
  const values = { periodMonths: 12, turnover: 240000.01, totalCharges: 1000.01 };
  const unchanged = calculateStatementCosts(values, review());
  assert.equal(unchanged.monthlyCharges, 83.33);
  assert.equal(unchanged.annualCharges, 1000.01);
  const adjusted = calculateStatementCosts(values, review({ status: 'included' }, separate(99.99, 'annual')));
  assert.equal(adjusted.monthlyCharges, 91.67);
  assert.equal(adjusted.adjustedPeriodCharges, 1100);
  assert.equal(adjusted.annualCharges, 1100);
  close(adjusted.effectiveRate, 1100 / 240000.01 * 100);
});

test('unresolved rental or PCI questions do not produce an adjusted cost comparison', () => {
  for (const input of [
    emptyFeeReview(),
    review({ status: 'unknown' }, { status: 'none' }),
    review({ status: 'included' }, { status: 'unknown' }),
  ]) {
    const figures = calculateStatementCosts(annualValues, input, annualFigures);
    close(figures.statementEffectiveRate, 0.75);
    assert.equal(figures.feeReviewComplete, false);
    for (const key of ['monthlyCharges', 'annualCharges', 'effectiveRate', 'adjustedPeriodCharges']) {
      assert.equal(figures[key], null, key);
    }
    assert.equal(figures.monthlyVolume, 40000);
    assert(figures.warnings.length > 0);
  }
});

test('statement rate is available immediately before fee answers or period confirmation', () => {
  for (const periodMonths of [undefined, '', 0, -1, NaN, 12]) {
    const figures = calculateStatementCosts({ turnover: 120000, totalCharges: 900, periodMonths }, emptyFeeReview());
    close(figures.statementEffectiveRate, 0.75);
    assert.equal(figures.effectiveRate, null);
    assert.equal(figures.adjustedRateReady, false);
    assert.match(figures.adjustedRateMessage, /Confirm terminal rental and PCI/);
  }
});

test('separate fees change only the total-cost rate, leaving the original statement rate visible', () => {
  const figures = calculateStatementCosts(annualValues, review(separate(40, 'monthly'), separate(120, 'annual')));
  close(figures.statementEffectiveRate, 0.75);
  close(figures.effectiveRate, 0.875);
  assert.equal(figures.adjustedRateReady, true);
  assert.equal(figures.adjustedRateMessage, '');
  const cleared = calculateStatementCosts(annualValues, review(separate('', 'monthly'), { status: 'none' }));
  close(cleared.statementEffectiveRate, 0.75);
  assert.equal(cleared.effectiveRate, null);
  assert.equal(cleared.adjustedRateReady, false);
});

test('a genuine zero statement charge is displayed as zero percent', () => {
  const figures = calculateStatementCosts({ periodMonths: 1, turnover: 1000, totalCharges: 0 }, emptyFeeReview());
  assert.equal(figures.statementEffectiveRate, 0);
  assert.equal(figures.statementRateMessage, '');
  assert.equal(figures.effectiveRate, null);
});

test('missing, zero or invalid rate inputs are explained instead of producing false zero or Infinity', () => {
  for (const turnover of [undefined, '', 0, -1, NaN, Infinity]) {
    const figures = calculateStatementCosts({ periodMonths: 1, turnover, totalCharges: 20 }, emptyFeeReview());
    assert.equal(figures.statementEffectiveRate, null);
    assert.match(figures.statementRateMessage, /turnover|Turnover/);
  }
  for (const totalCharges of [undefined, '', -1, NaN, Infinity]) {
    const figures = calculateStatementCosts({ periodMonths: 1, turnover: 1000, totalCharges }, emptyFeeReview());
    assert.equal(figures.statementEffectiveRate, null);
    assert.match(figures.statementRateMessage, /charges/);
  }
});

test('a completed fee review still explains any missing period or calculation inputs', () => {
  const noPeriod = calculateStatementCosts({ turnover: 120000, totalCharges: 900 }, review());
  assert.equal(noPeriod.feeReviewComplete, true);
  assert.equal(noPeriod.adjustedRateReady, false);
  close(noPeriod.statementEffectiveRate, 0.75);
  assert.match(noPeriod.adjustedRateMessage, /months covered/);
  const noTotals = calculateStatementCosts({ periodMonths: 12 }, review());
  assert.equal(noTotals.adjustedRateReady, false);
  assert.match(noTotals.adjustedRateMessage, /turnover and total charges/);
});

test('statement rate uses the original totals even if caller figures contain a stale rate', () => {
  const values = { periodMonths: 12, turnover: 240000.01, totalCharges: 1000.01 };
  const figures = calculateStatementCosts(values, emptyFeeReview(), { statementEffectiveRate: 99, effectiveRate: 99 });
  close(figures.statementEffectiveRate, values.totalCharges / values.turnover * 100);
  assert.notEqual(figures.statementEffectiveRate, (83.33 / 20000) * 100);
  assert.equal(figures.effectiveRate, null);
});

test('legacy statements retain their original figures until a fee review is supplied', () => {
  for (const input of [undefined, null]) {
    const figures = calculateStatementCosts(annualValues, input, annualFigures);
    assert.equal(figures.monthlyCharges, 300);
    assert.equal(figures.annualCharges, 3600);
    close(figures.effectiveRate, 0.75);
    assert.equal(figures.monthlyVolume, 40000);
    assert.equal(figures.feeReviewComplete, false);
  }
});

test('fee calculation preserves the raw statement, review and caller-provided figures', () => {
  const values = structuredClone(annualValues);
  const input = review(separate(40, 'monthly'), separate(120, 'annual'));
  const base = { ...structuredClone(annualFigures), warnings: ['Existing review note'] };
  const before = structuredClone({ values, input, base });
  const figures = calculateStatementCosts(values, input, base);
  assert.deepEqual({ values, input, base }, before);
  assert(figures.warnings.includes('Existing review note'));
  assert.equal(values.totalCharges, 3600);
});

test('separate fee amounts require a finite non-negative amount and a recognised billing period', () => {
  for (const amount of ['', undefined, null, -1, NaN, Infinity, 'not money']) {
    const input = review(separate(amount, 'monthly'));
    assert(validateFeeReview(input).length > 0, `amount ${String(amount)}`);
    assert.throws(() => canonicalFeeReview(input), `amount ${String(amount)}`);
  }
  for (const frequency of ['', undefined, null, 'weekly', 'yearly']) {
    const input = review(separate(40, frequency));
    assert(validateFeeReview(input).length > 0, `frequency ${String(frequency)}`);
    assert.throws(() => canonicalFeeReview(input), `frequency ${String(frequency)}`);
  }
});

test('malformed fee review versions and statuses are rejected', () => {
  for (const input of [
    {}, [],
    { ...review(), version: 2 },
    review({ status: 'yes' }),
    review({ status: 'separate' }),
    { version: 1, terminalRental: null, pciFees: { status: 'none' } },
  ]) {
    assert(validateFeeReview(input).length > 0);
    assert.throws(() => canonicalFeeReview(input));
  }
});

test('zero separate fees remain valid and cannot increase the statement total', () => {
  const input = review(separate(0, 'monthly'), separate(0, 'annual'));
  assert.deepEqual(validateFeeReview(input), []);
  const figures = calculateStatementCosts(annualValues, input, annualFigures);
  assert.equal(figures.adjustedPeriodCharges, 3600);
  assert.equal(figures.separateMonthlyCharges, 0);
});

test('applying the fee review updates monthly charges while preserving the original annual total', () => {
  const input = review(separate(40, 'monthly'), separate(120, 'annual'));
  const result = applyStatementFees(patch(), input);
  assert.equal(result.currentCharges, 350);
  assert.equal(result.monthlyVolume, 40000);
  assert.equal(result.statementAnalysis.version, 1);
  assert.equal(result.statementAnalysis.values.totalCharges, 3600);
  assert.equal(result.statementAnalysis.values.periodMonths, 12);
  assert.deepEqual(result.statementAnalysis.feeReview, canonicalFeeReview(input));
});

test('export, JSON restore and repeated fee application cannot double count separate bills', () => {
  const input = review(separate(40, 'monthly'), separate(120, 'annual'));
  const first = applyStatementFees(patch(), input);
  const restored = JSON.parse(JSON.stringify(first));
  const second = applyStatementFees(restored, restored.statementAnalysis.feeReview);
  const third = applyStatementFees(second, second.statementAnalysis.feeReview);
  for (const result of [first, second, third]) {
    assert.equal(result.currentCharges, 350);
    assert.equal(result.statementAnalysis.values.totalCharges, 3600);
    const figures = calculateStatementCosts(result.statementAnalysis.values, result.statementAnalysis.feeReview);
    assert.equal(figures.annualCharges, 4200);
  }
});

test('changing a separately billed fee to included removes its previous addition', () => {
  const initial = applyStatementFees(patch(), review(separate(40, 'monthly'), separate(120, 'annual')));
  const result = applyStatementFees(initial, review({ status: 'included' }, separate(120, 'annual')));
  assert.equal(result.currentCharges, 310);
  assert.equal(result.statementAnalysis.values.totalCharges, 3600);
});

test('turnover-only application leaves charges and saved fee review unchanged', () => {
  const input = patch({ periodMonths: 12, turnover: 480000 });
  const before = structuredClone(input);
  const result = applyStatementFees(input, emptyFeeReview());
  assert.deepEqual(result, before);
  assert.equal(result.currentCharges, 300);
  assert.equal(result.statementAnalysis.feeReview, undefined);
});

test('an unresolved fee review cannot be applied to selected statement charges', () => {
  assert.throws(() => applyStatementFees(patch(), emptyFeeReview()));
});
