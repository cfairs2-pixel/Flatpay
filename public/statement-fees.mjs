const NAMES = { terminalRental: 'terminal rental', pciFees: 'PCI fees' };
const STATUSES = new Set(['unknown', 'included', 'separate', 'none']);
const PERIODS = { monthly: 1, quarterly: 3, annual: 12 };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const amount = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1e12 ? number : null;
};

export function emptyFeeReview() {
  return { version: 1, terminalRental: { status: 'unknown', amount: '', frequency: 'monthly' }, pciFees: { status: 'unknown', amount: '', frequency: 'monthly' } };
}

export function validateFeeReview(review) {
  if (!object(review) || review.version !== 1) return ['Review terminal rental and PCI fees before applying the total charges.'];
  const errors = [];
  if (Object.keys(review).some(key => !['version', 'terminalRental', 'pciFees'].includes(key))) errors.push('The fee review contains unsupported details.');
  for (const [key, label] of Object.entries(NAMES)) {
    const fee = review[key];
    if (!object(fee) || !STATUSES.has(fee.status)) { errors.push(`Choose whether ${label} is included, separate, or not charged.`); continue; }
    if (Object.keys(fee).some(name => !['status', 'amount', 'frequency'].includes(name))) errors.push(`The ${label} review contains unsupported details.`);
    if (fee.status === 'unknown') errors.push(`Confirm whether ${label} is included, separate, or not charged.`);
    if (fee.status === 'separate') {
      const value = amount(fee.amount);
      if (value === null || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) errors.push(`Enter the separate ${label} amount in pounds and pence.`);
      if (!Object.hasOwn(PERIODS, fee.frequency) && fee.frequency !== 'statement') errors.push(`Choose how often the separate ${label} is billed.`);
    }
  }
  return errors;
}

export function canonicalFeeReview(review) {
  const errors = validateFeeReview(review);
  if (errors.length) throw new Error(errors.join(' '));
  return Object.fromEntries([
    ['version', 1],
    ...Object.keys(NAMES).map(key => [key, review[key].status === 'separate'
      ? { status: 'separate', amount: amount(review[key].amount), frequency: review[key].frequency }
      : { status: review[key].status }]),
  ]);
}

export function calculateStatementCosts(values = {}, review, baseFigures = {}) {
  const monthsValue = amount(values.periodMonths);
  const months = monthsValue > 0 && monthsValue <= 120 ? monthsValue : null;
  const charges = amount(values.totalCharges);
  const turnover = amount(values.turnover);
  const baseMonthly = charges !== null && months !== null ? charges / months : null;
  const errors = review == null ? [] : validateFeeReview(review);
  const complete = review != null && errors.length === 0;
  const warnings = [...(baseFigures.warnings || [])];
  const breakdown = {};
  let separateMonthly = 0;
  if (complete && months !== null) for (const key of Object.keys(NAMES)) {
    const fee = review[key];
    const monthly = fee.status === 'separate' ? amount(fee.amount) / (fee.frequency === 'statement' ? months : PERIODS[fee.frequency]) : 0;
    separateMonthly += monthly;
    breakdown[key] = { monthly: round(monthly), period: round(monthly * months), status: fee.status };
  }
  if (review == null) warnings.push('Terminal rental and PCI fees have not yet been checked.');
  else warnings.push(...errors);
  const original = {
    monthlyCharges: baseMonthly === null ? null : round(baseMonthly),
    annualCharges: baseMonthly === null ? null : round(baseMonthly * 12),
    effectiveRate: turnover > 0 && charges !== null ? charges / turnover * 100 : null,
  };
  const adjusted = complete && months !== null && charges !== null ? charges + separateMonthly * months : null;
  return {
    monthlyVolume: turnover !== null && months !== null ? round(turnover / months) : null,
    annualTpv: turnover !== null && months !== null ? round(turnover / months * 12) : null,
    ...baseFigures,
    ...(review == null ? original : {
      monthlyCharges: adjusted === null ? null : round(adjusted / months),
      annualCharges: adjusted === null ? null : round(adjusted / months * 12),
      effectiveRate: adjusted !== null && turnover > 0 ? adjusted / turnover * 100 : null,
    }),
    statementMonthlyCharges: baseMonthly === null ? null : round(baseMonthly),
    separateMonthlyCharges: complete && months !== null ? round(separateMonthly) : null,
    adjustedPeriodCharges: adjusted === null ? null : round(adjusted),
    feeReviewComplete: complete,
    feeBreakdown: breakdown,
    warnings: [...new Set(warnings)],
  };
}

export function applyStatementFees(patch, review) {
  const analysis = patch?.statementAnalysis;
  if (!analysis?.values || !Object.hasOwn(analysis.values, 'totalCharges')) return patch;
  const canonical = canonicalFeeReview(review);
  const figures = calculateStatementCosts(analysis.values, canonical);
  if (figures.monthlyCharges === null) throw new Error('Confirm the total charges and months covered before adding separate fees.');
  return { ...patch, currentCharges: figures.monthlyCharges, statementAnalysis: { ...analysis, feeReview: canonical } };
}

const money = value => value == null ? 'Awaiting review' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);

export function createFeeReviewPanel(React) {
  const h = React.createElement;
  return function FeeReviewPanel({ value, onChange, values, disabled = false }) {
    const id = React.useId();
    const review = value || emptyFeeReview();
    const figures = calculateStatementCosts(values, review);
    const change = (key, field, next) => onChange({ ...review, [key]: { ...review[key], [field]: next } });
    return h('section', { className: 'statement-fee-review', 'aria-label': 'Terminal rental and PCI fee review' },
      h('h4', null, 'Check terminal rental and PCI fees'),
      h('p', null, 'Are these costs already included in the total charges above? Add only amounts billed separately. The comparison recalculates as you answer.'),
      ...Object.entries(NAMES).map(([key, label]) => {
        const fee = review[key] || { status: 'unknown' };
        const question = key === 'terminalRental' ? 'Is terminal rental included in the statement total?' : 'Are PCI fees included in the statement total?';
        return h('fieldset', { key, disabled, className: 'statement-fee-choice' },
          h('legend', null, key === 'terminalRental' ? 'Terminal rental' : 'PCI fees'),
          h('label', { htmlFor: `${id}-${key}-status` }, question),
          h('select', { id: `${id}-${key}-status`, value: fee.status, onChange: event => change(key, 'status', event.target.value) },
            h('option', { value: 'unknown' }, 'Choose an answer / not sure'),
            h('option', { value: 'included' }, 'Yes — already included'),
            h('option', { value: 'separate' }, 'No — add a separately billed fee'),
            h('option', { value: 'none' }, 'No fee is charged')),
          fee.status === 'separate' && h('div', { className: 'statement-fee-inputs' },
            h('label', { htmlFor: `${id}-${key}-amount` }, key === 'terminalRental' ? 'Total rental across all terminals (£)' : 'Separate PCI fee (£)'),
            h('input', { id: `${id}-${key}-amount`, type: 'number', inputMode: 'decimal', min: '0', step: '0.01', value: fee.amount ?? '', onChange: event => change(key, 'amount', event.target.value) }),
            h('label', { htmlFor: `${id}-${key}-frequency` }, `How often is ${label} billed?`),
            h('select', { id: `${id}-${key}-frequency`, value: fee.frequency || 'monthly', onChange: event => change(key, 'frequency', event.target.value) },
              h('option', { value: 'monthly' }, 'Per month'), h('option', { value: 'quarterly' }, 'Per quarter'),
              h('option', { value: 'annual' }, 'Per year'), h('option', { value: 'statement' }, 'For this statement period'))));
      }),
      h('p', { className: 'statement-fee-help' }, 'Use the same VAT basis as the statement total. Rental is the total for all terminals. Annual and quarterly bills are averaged over the period. Add actual fees, not a tariff or a minimum that was not charged.'),
      h('dl', { className: 'statement-fee-totals' },
        h('div', null, h('dt', null, 'Statement charges / month'), h('dd', null, money(figures.statementMonthlyCharges))),
        h('div', null, h('dt', null, 'Separate fees / month'), h('dd', null, money(figures.separateMonthlyCharges))),
        h('div', null, h('dt', null, 'Total current cost / month'), h('dd', null, money(figures.monthlyCharges)))),
      h('p', { role: 'status', className: 'statement-fee-status' }, figures.feeReviewComplete
        ? 'Fee review complete. Check the updated figures below, then apply and save the customer.'
        : 'Answer both fee questions and enter any separate amounts before applying the total charges.'),
      h('p', { className: 'statement-fee-help' }, 'The current effective cost includes the confirmed fees. Any unrecorded fees from a new provider are excluded from savings estimates.'));
  };
}
