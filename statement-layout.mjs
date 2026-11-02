// Preserve the spatial relationship between summary labels and OCR currency
// words. This produces review candidates, never inferred fees or repaired digits.
const FIELDS = ['turnover', 'totalCharges'];
const NAMES = { turnover: 'card turnover', totalCharges: 'total charges' };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 12;
const height = box => box.y1 - box.y0;
const width = box => box.x1 - box.x0;
const cx = box => (box.x0 + box.x1) / 2;
const cy = box => (box.y0 + box.y1) / 2;
const union = words => ({ x0: Math.min(...words.map(w => w.bbox.x0)), y0: Math.min(...words.map(w => w.bbox.y0)), x1: Math.max(...words.map(w => w.bbox.x1)), y1: Math.max(...words.map(w => w.bbox.y1)) });
const validBox = box => box && ['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(box[key])) && box.x1 > box.x0 && box.y1 > box.y0;
const normalize = value => value.normalize('NFKC').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const cleanLabel = value => normalize(value.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, '')).toLowerCase().replace(/\b(transactions?|charges|fees|costs)[1-9]\b/g, '$1').replace(/[\s:;*†‡.,]+$/g, '').replace(/([a-z])[1-9]$/, '$1');

function labelKind(text) {
  const label = cleanLabel(text)
    .replace(/ (?:in|over|for) (?:the )?(?:last|past|previous) (?:12|twelve) months?$/, '')
    .replace(/ (?:in|over|for)(?: the(?: (?:last|past|previous))?)?$/, '');
  if (/^(?:your )?(?:total card transactions?|total (?:value|amount) of card (?:payments?|transactions?)|(?:annual|yearly) card (?:turnover|sales)|(?:total )?card (?:turnover|sales))$/.test(label)) return 'turnover';
  if (/^(?:your )?total (?:charges|fees|costs)(?: (?:including|incl) vat)?$/.test(label)) return 'totalCharges';
  if (/\b(?:average|transaction split|costs for accepting|other monthly charges|additional charges per transaction|rate per transaction|terminal rental|pci (?:fees|compliance)|minimum monthly)\b/.test(label)) return 'excluded';
  return null;
}

function readLines(data) {
  const lines = [];
  for (const block of Array.isArray(data?.blocks) ? data.blocks : []) {
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
        const words = (Array.isArray(line?.words) ? line.words : []).filter(word => typeof word?.text === 'string' && word.text.trim() && validBox(word.bbox)).map(word => ({ text: normalize(word.text), bbox: { ...word.bbox }, confidence: Number.isFinite(word.confidence) ? Math.max(0, Math.min(100, word.confidence)) : null }));
        if (words.length) lines.push(words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
        if (lines.length > 2500) return [];
      }
    }
  }
  return lines.reduce((count, line) => count + line.length, 0) <= 12000 ? lines : [];
}

function moneyValue(raw, allowE) {
  const text = normalize(raw).replace(/\u2212/g, '-');
  if (/[-()%]|\bCR\b|CR$/i.test(text)) return { invalid: true };
  const currency = allowE ? '(?:£|GBP|E)' : '(?:£|GBP)';
  let repaired = false;
  let valueText = text;
  const dotted = text.match(new RegExp(`^(${currency}\\s*)(\\d{1,3}(?:\\.\\d{3})+\\.\\d{2})$`, 'i'));
  if (dotted) {
    const pieces = dotted[2].split('.');
    const pennies = pieces.pop();
    valueText = dotted[1] + pieces.join('') + '.' + pennies;
    repaired = true;
  }
  const matched = valueText.match(new RegExp(`^${currency}\\s*((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?)$`, 'i'));
  if (!matched) return { invalid: true };
  const value = Number(matched[1].replaceAll(',', ''));
  return Number.isFinite(value) && value >= 0 && value <= 1e15 ? { value, repaired } : { invalid: true };
}

function segmentsAndAmounts(lines, typicalHeight, allowE) {
  const segments = [], amounts = [];
  const currencyWord = text => /£|\bGBP|^GBP\d/i.test(text) || allowE && /^E(?:\s|\d|$)/.test(text);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const words = lines[lineIndex].map((word, wordIndex) => ({ ...word, id: `${lineIndex}:${wordIndex}` }));
    const used = new Set();
    for (let index = 0; index < words.length; index++) {
      if (!currencyWord(words[index].text)) continue;
      let start = index, end = index;
      const adjacent = (left, right) => right.bbox.x0 - left.bbox.x1 <= Math.max(height(left.bbox), height(right.bbox)) * 1.7;
      if (/^(?:£|GBP|E)$/i.test(words[index].text) && words[index + 1] && /^[\d.,+-]+$/.test(words[index + 1].text) && adjacent(words[index], words[index + 1])) end++;
      if (words[start - 1] && /^[-−(]$/.test(words[start - 1].text) && adjacent(words[start - 1], words[start])) start--;
      if (words[end + 1] && /^(?:CR|%|\))$/i.test(words[end + 1].text) && adjacent(words[end], words[end + 1])) end++;
      const group = words.slice(start, end + 1);
      group.forEach(word => used.add(word.id));
      const raw = group.map(word => word.text).join(' ');
      const parsed = moneyValue(raw, allowE);
      const knownConfidence = group.map(word => word.confidence).filter(value => value !== null);
      amounts.push({ ...parsed, raw, bbox: union(group), confidence: knownConfidence.length ? Math.min(...knownConfidence) : null, ids: group.map(word => word.id), id: group.map(word => word.id).join('|') });
      index = end;
    }
    let segment = [];
    const flush = () => {
      if (segment.length) segments.push({ words: segment, bbox: union(segment), text: segment.map(word => word.text).join(' '), ids: segment.map(word => word.id), lineIndex });
      segment = [];
    };
    for (const word of words) {
      if (used.has(word.id)) { flush(); continue; }
      const previous = segment.at(-1);
      if (previous && word.bbox.x0 - previous.bbox.x1 > Math.max(30, typicalHeight * 2.25)) flush();
      segment.push(word);
    }
    flush();
  }
  return { segments, amounts };
}

function labelsFrom(segments, typicalHeight) {
  const labels = [], seen = new Set();
  const visit = (parts, depth) => {
    const words = parts.flatMap(part => part.words);
    const box = union(words);
    const text = parts.map(part => part.text).join(' ');
    const kind = labelKind(text);
    const key = kind + ':' + words.map(word => word.id).join('|');
    if (kind && !seen.has(key)) { seen.add(key); labels.push({ kind, text, bbox: box, ids: words.map(word => word.id), words }); }
    if (depth === 3 || kind) return;
    const last = parts.at(-1);
    const next = segments.filter(part => !parts.includes(part) && part.bbox.y0 > last.bbox.y0 + Math.min(height(part.bbox), height(last.bbox)) * 0.3
      && part.bbox.y1 > last.bbox.y1 + Math.min(height(part.bbox), height(last.bbox)) * 0.3
      && part.bbox.y0 - last.bbox.y1 <= Math.max(height(part.bbox), height(last.bbox), typicalHeight) * 1.65
      && (Math.abs(part.bbox.x0 - last.bbox.x0) <= typicalHeight * 1.8 || Math.abs(cx(part.bbox) - cx(last.bbox)) <= Math.max(width(part.bbox), width(last.bbox)) * 0.32)
      && !/\d/.test(part.text));
    next.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    for (const part of next.slice(0, 3)) visit([...parts, part], depth + 1);
  };
  for (const segment of segments) {
    // Only label prefixes can begin a wrapped label. Avoid repeatedly scanning
    // every body/table paragraph on long documents.
    if (/^(?:your(?: |$))?(?:total\b|annual\b|yearly\b|card\b|average\b|transaction split\b|costs for accepting\b|other monthly\b|additional charges\b|rate per\b|terminal\b|pci\b|minimum monthly\b)|^your$/i.test(segment.text)) visit([segment], 1);
  }
  return labels;
}

function relation(label, amount, typicalHeight) {
  const a = label.bbox, b = amount.bbox;
  const unit = Math.max(typicalHeight, height(b));
  const rightGap = b.x0 - a.x1;
  if (rightGap >= -typicalHeight * 0.25 && rightGap <= Math.max(width(a) * 2.5, unit * 10)
    // A value box can be vertically centred beside a two-line label.
    && Math.abs(cy(a) - cy(b)) <= Math.max(height(a), height(b)) * 1.5) {
    return { direction: 'right', score: Math.max(0, rightGap) / unit + Math.abs(cy(a) - cy(b)) / unit * 2 };
  }
  const belowGap = b.y0 - a.y1;
  const sameColumn = Math.abs(b.x0 - a.x0) <= typicalHeight * 2.2
    || cx(b) >= a.x0 - typicalHeight && cx(b) <= a.x1 + Math.max(typicalHeight * 1.5, width(a) * 0.3);
  if (belowGap >= -typicalHeight * 0.4 && belowGap <= Math.max(height(a), height(b)) * 4.5 && sameColumn) {
    return { direction: 'below', score: Math.max(0, belowGap) / unit + Math.min(Math.abs(b.x0 - a.x0), Math.abs(cx(b) - cx(a))) / unit * 0.7 };
  }
  return null;
}

function blockedByLabel(label, amount, match, labels, typicalHeight) {
  return labels.some(other => {
    if (other === label || other.ids.some(id => label.ids.includes(id))) return false;
    const box = other.bbox;
    if (match.direction === 'right') return cx(box) > label.bbox.x1 && cx(box) < cx(amount.bbox) && Math.abs(cy(box) - cy(amount.bbox)) <= Math.max(height(box), height(amount.bbox)) * 1.3;
    return cy(box) > label.bbox.y1 && cy(box) < amount.bbox.y0 && Math.abs(cx(box) - cx(amount.bbox)) <= Math.max(width(box), width(amount.bbox)) * 0.7 + typicalHeight;
  });
}

/** Extract conservative, geometry-backed review candidates from Tesseract 7. */
export function extractStatementLayout(ocrData) {
  const lines = readLines(ocrData);
  if (!lines.length) return { candidates: [], warnings: [], blockedFields: [] };
  const words = lines.flat();
  const text = normalize((typeof ocrData.text === 'string' ? ocrData.text : '') + '\n' + words.map(word => word.text).join(' '));
  if (/\bbank statement\b|\b(?:opening|closing) balance\b/i.test(text)) return { candidates: [], warnings: ['Bank statement balances are not used as card-payment totals.'], blockedFields: [] };
  if (/\b(?:USD|EUR|AUD|CAD|NZD|CHF|JPY)\b|[$€]/i.test(text)) return { candidates: [], warnings: ['A non-GBP currency appears in the OCR. Confirm the amounts manually in GBP.'], blockedFields: [] };
  if (!/\bcard payments? summary\b|\bannual\s+(?:(?:card|merchant|payment|payments)\s+){0,3}(?:summary|statement|turnover)\b/i.test(text)) return { candidates: [], warnings: [], blockedFields: [] };
  const typicalHeight = median(words.map(word => height(word.bbox)));
  const { segments, amounts } = segmentsAndAmounts(lines, typicalHeight, /£|\bGBP\b/i.test(text));
  const labels = labelsFrom(segments, typicalHeight);
  const warnings = [], matches = [];
  const blockedFields = new Set();
  const protectedAmounts = new Set();
  for (const amount of amounts) {
    const excluded = labels.filter(label => label.kind === 'excluded').map(label => ({ label, match: relation(label, amount, typicalHeight) })).filter(item => item.match);
    for (const item of excluded) {
      const total = labels.filter(label => FIELDS.includes(label.kind)).map(label => relation(label, amount, typicalHeight)).filter(Boolean);
      if (!total.length || item.match.score <= Math.min(...total.map(match => match.score)) + 0.6) protectedAmounts.add(amount.id);
    }
  }
  for (const label of labels.filter(label => FIELDS.includes(label.kind))) {
    const nearby = amounts.map(amount => ({ label, amount, match: relation(label, amount, typicalHeight) })).filter(item => item.match && !blockedByLabel(label, item.amount, item.match, labels, typicalHeight)).sort((a, b) => a.match.score - b.match.score);
    if (!nearby.length) { blockedFields.add(label.kind); continue; }
    const best = nearby[0];
    if (best.amount.invalid) { blockedFields.add(label.kind); warnings.push(`The amount beside ${NAMES[label.kind]} has an unsupported sign, credit marker or money format. Check the original statement.`); continue; }
    if (protectedAmounts.has(best.amount.id)) { blockedFields.add(label.kind); continue; }
    const second = nearby[1];
    if (second && second.match.score <= best.match.score + Math.max(0.7, best.match.score * 0.2)) { blockedFields.add(label.kind); warnings.push(`More than one amount could belong to ${NAMES[label.kind]}. Enter the correct total from the statement.`); continue; }
    matches.push(best);
  }
  const shared = new Set(matches.filter(item => matches.some(other => other.label.kind !== item.label.kind && other.amount.id === item.amount.id)).map(item => item.amount.id));
  if (shared.size) { matches.filter(item => shared.has(item.amount.id)).forEach(item => blockedFields.add(item.label.kind)); warnings.push('One OCR amount could belong to more than one total. Confirm both totals manually.'); }
  const candidates = [];
  for (const field of FIELDS) {
    const options = matches.filter(item => item.label.kind === field && !shared.has(item.amount.id));
    const uniqueValues = [...new Set(options.map(item => item.amount.value))];
    if (uniqueValues.length > 1) { blockedFields.add(field); warnings.push(`Conflicting spatially labelled ${NAMES[field]} amounts were found. Confirm the total manually.`); continue; }
    if (!options.length || blockedFields.has(field)) continue;
    options.sort((a, b) => a.match.score - b.match.score);
    const { label, amount, match } = options[0];
    const confidenceValues = [amount.confidence, ...label.words.map(word => word.confidence)].filter(value => value !== null);
    const confidence = confidenceValues.length ? Math.min(...confidenceValues) : null;
    candidates.push({ field, value: amount.value, raw: amount.raw, evidence: `OCR position links “${label.text}” to the amount ${match.direction === 'right' ? 'on its right' : 'below it'}.`, confidence });
    if (confidence !== null && confidence < 70) warnings.push(`OCR confidence is low for ${NAMES[field]}. Check every digit against the original statement.`);
    if (amount.repaired) warnings.push('OCR read a thousands separator as a dot. Check the suggested pounds and pence against the original statement.');
  }
  return { candidates, warnings: [...new Set(warnings)], blockedFields: [...blockedFields] };
}
