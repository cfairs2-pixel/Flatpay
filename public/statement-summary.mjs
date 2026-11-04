// Annual card-payment summaries use a different layout from monthly bills.
// Retain the existing statement reader, adding only clearly labelled totals.
const AMOUNT = /(?:£\s*|GBP\s*|\bE\s*)(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d,.])/gi;
const OTHER_LABEL = /\b(?:your\s+)?(?:average\s+transaction|merchant\s+category|contract\s+ends|total\s+(?:card\s+transactions?|charges|fees|(?:value|amount)\s+of\s+card\s+payments?)|costs\s+for|other\s+(?:monthly|potential)|minimum\s+monthly|payment\s+brands|settlement\s+time)\b/i;
const LABELS = {
  turnover: [
    /\b(?:your\s+)?total\s+card\s+transactions?\b/gi,
    /\b(?:your\s+)?total\s+(?:value|amount)\s+of\s+card\s+(?:payments?|transactions?)\b/gi,
    /\b(?:annual|yearly)\s+card\s+(?:turnover|sales)\b/gi,
  ],
  totalCharges: [
    /\b(?:your\s+)?total\s+(?:charges|fees|costs)\b(?!\s*(?:per\s+transaction|rate|excluding|excl\b|before\s+vat))/gi,
  ],
};
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const currencyMismatch = text => /\b(?:USD|EUR|AUD|CAD|NZD|CHF|JPY)\b|[$€]/i.test(text);

function normalize(text) {
  return text.normalize('NFKC').replace(/\r/g, '\n').replace(/[\u00a0\t]/g, ' ')
    .replace(/months\s*[¹²³⁴⁵⁶⁷⁸⁹]\b/gi, 'months')
    .replace(/\bmonths\d{1,2}\b/gi, 'months');
}

function moneyTokens(text) {
  return [...text.matchAll(AMOUNT)].map(match => ({
    value: Number(match[1].replaceAll(',', '')),
    index: match.index,
    token: match[0],
  })).filter(item => Number.isFinite(item.value) && item.value >= 0 && item.value <= 1e15);
}

function afterLabel(text, label) {
  let tail = text.slice(label.index + label[0].length, label.index + label[0].length + 200);
  const boundary = tail.search(OTHER_LABEL);
  if (boundary >= 0) tail = tail.slice(0, boundary);
  // Negative amounts and ex-VAT subtotals need manual review, not sign removal.
  if (/\b(?:excluding|excl\.?|before)\s+vat\b|(?:^|\s)-\s*(?:£|GBP|E)?\s*\d|(?:£|GBP|E)\s*-\s*\d|\bCR\b/i.test(tail)) return null;
  const amounts = moneyTokens(tail);
  if (amounts.length === 1) return amounts[0].value;
  if (amounts.length > 1) return null;
  // OCR may omit the currency glyph. Require an explicit GBP cue elsewhere,
  // decimal pennies, and exactly one candidate in the labelled segment.
  if (/£|\bGBP\b/i.test(text)) {
    const decimal = [...tail.matchAll(/(?<![\d.,%])\b(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.,]|\s*%)/g)];
    if (decimal.length === 1) return Number(decimal[0][1].replaceAll(',', ''));
  }
  return null;
}

function annualPeriod(text) {
  return /\b(?:last|past|previous)\s+(?:12|[Il]2|twelve)\s+months\b/i.test(text)
    || /\b(?:12|twelve)[ -]month\s+(?:summary|statement|period)\b/i.test(text)
    || /\b(?:annual|yearly)\s+(?:(?:card|merchant|payment|payments)\s+){0,3}(?:statement|summary|turnover)\b/i.test(text);
}

/** Extend the existing parser's result without inventing dates or card shares. */
export function extendStatementSummary(rawText, baseline = { values: {}, evidence: {}, warnings: [] }, layout = []) {
  if (typeof rawText !== 'string') throw new TypeError('Provide statement text to read.');
  if (rawText.length > 300000) throw new Error('Statement text exceeds 300,000 characters. Read fewer pages at a time.');
  const text = normalize(rawText);
  let flat = text.replace(/\s+/g, ' ');
  const values = { ...baseline.values };
  const evidence = { ...baseline.evidence };
  let warnings = [...(baseline.warnings || [])];
  if (warnings.some(message => message.startsWith('This looks like a bank statement.'))) return baseline;
  const summary = /\bcard\s+payments?\s+summary\b|\bannual\s+card\s+(?:payment|payments|processing|turnover|statement)\b/i.test(flat)
    || /\btotal\s+card\s+transactions?\b/i.test(flat) && /\btotal\s+(?:charges|fees)\b/i.test(flat);
  if (!summary) return baseline;
  if (!currencyMismatch(flat)) {
    let repaired = false;
    flat = flat.replace(/(£\s*|GBP\s*|\bE\s*)(\d{1,3}(?:\.\d{3})+\.\d{2})(?![\d,.])/gi, (match, currency, digits) => {
      const parts = digits.split('.');
      const pennies = parts.pop();
      repaired = true;
      return currency + parts.join('') + '.' + pennies;
    });
    if (repaired) warnings.push('OCR read a thousands separator as a dot. Check the suggested pounds and pence against the original statement.');
  }
  const tariffSummary = /\byour\s+costs\s+for\s+accepting\b|\bother\s+monthly\s+charges\b|\badditional\s+charges\s+per\s+transaction\b/i.test(flat);
  if (tariffSummary) {
    // These boxes describe possible charges, not fees actually paid in the
    // summary period. The legacy generic bill parser can mistake them for sums.
    for (const field of ['processingFees', 'terminalRental', 'pciFees', 'otherFees', 'vat']) {
      delete values[field]; delete evidence[field];
    }
    warnings.push('The individual rates and fee boxes are a tariff, not totals paid. They are not added to the summary charges.');
  }

  const found = {};
  if (!currencyMismatch(flat)) {
    const spatial = Array.isArray(layout) ? layout : Array.isArray(layout?.candidates) ? layout.candidates : [];
    const blocked = new Set(Array.isArray(layout?.blockedFields) ? layout.blockedFields : []);
    for (const [field, labels] of Object.entries(LABELS)) {
      if (blocked.has(field)) {
        delete values[field]; delete evidence[field];
        warnings.push(`The page contains an unclear ${field === 'turnover' ? 'card-turnover' : 'total-charge'} amount. Enter it from the original statement.`);
        continue;
      }
      const candidates = [];
      for (const pattern of labels) for (const match of flat.matchAll(pattern)) {
        const value = afterLabel(flat, match);
        if (value !== null) candidates.push(value);
      }
      if (has(values, field)) candidates.push(values[field]);
      const positions = spatial.filter(candidate => candidate?.field === field && typeof candidate.value === 'number' && Number.isFinite(candidate.value) && candidate.value >= 0 && candidate.value <= 1e15);
      const positionValues = [...new Set(positions.map(candidate => candidate.value))];
      if (positionValues.length === 1) {
        if (candidates.some(value => value !== positionValues[0])) warnings.push(`The text reading order differs from the page layout for ${field === 'turnover' ? 'card turnover' : 'total charges'}. Check the matched amount against the original.`);
        values[field] = positionValues[0];
        evidence[field] = String(positions[0].evidence || 'Total matched to its label using the page layout').slice(0, 180);
        found[field] = true;
        continue;
      }
      if (positionValues.length > 1) {
        delete values[field]; delete evidence[field];
        warnings.push(`Different ${field === 'turnover' ? 'card-turnover' : 'total-charge'} totals were matched on the document. Enter the correct statement total.`);
        continue;
      }
      const unique = [...new Set(candidates)];
      if (unique.length === 1) {
        values[field] = unique[0];
        evidence[field] = field === 'turnover' ? 'Labelled total card transactions/value on the payment summary' : 'Labelled total charges on the payment summary';
        found[field] = true;
      } else if (unique.length > 1) {
        delete values[field]; delete evidence[field];
        warnings.push(`Conflicting ${field === 'turnover' ? 'card turnover' : 'total charge'} amounts were found. Enter the correct total from the original statement.`);
      }
    }
  }
  if (annualPeriod(flat)) {
    if (has(values, 'periodMonths') && Number(values.periodMonths) !== 12) {
      delete values.periodMonths; delete evidence.periodMonths;
      warnings.push('The annual summary and another statement period disagree. Confirm months covered before applying any amounts.');
    } else {
      values.periodMonths = 12;
      evidence.periodMonths = 'Annual summary or explicitly stated 12-month period';
      found.periodMonths = true;
      warnings.push('This is a 12-month summary. Monthly figures are averages: annual totals divided by 12. Check seasonality before using these estimates.');
    }
  }
  warnings = warnings.filter(message => !(found.turnover && message.startsWith('A clear card-turnover total was not found.'))
    && !(found.totalCharges && message.startsWith('A clear total charge was not found.'))
    && !(found.periodMonths && message.startsWith('Confirm how many months this statement covers')));
  if (found.totalCharges) warnings.push('Check the total charges include all relevant fees and the intended VAT basis. Amex may be billed separately.');
  if (/\btransaction\s+split\b/i.test(flat)) warnings.push('The card transaction split is not confirmed as a share of transaction value. Business, international and Amex turnover need separate confirmation.');
  return { values, evidence, warnings: [...new Set(warnings)] };
}
