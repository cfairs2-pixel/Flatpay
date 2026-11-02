import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractStatementLayout } from '../public/statement-layout.mjs';
import { extendStatementSummary } from '../public/statement-summary.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/statement-ocr-${name}.json`, import.meta.url), 'utf8'));
const word = (text, x0, y0, x1, y1, confidence = 95) => ({ text, bbox: { x0, y0, x1, y1 }, confidence });
const line = (text, x, y, { height = 24, confidence = 95, gap = 8, glyph = 11 } = {}) => {
  const words = [];
  for (const token of text.split(' ')) {
    const size = token.length * glyph;
    words.push(word(token, x, y, x + size, y + height, confidence));
    x += size + gap;
  }
  return { words };
};
function document(lines, text = 'Your card payments summary. Last 12 months. All figures in GBP.') {
  return { text, blocks: [{ paragraphs: [{ lines }] }] };
}
const totals = result => Object.fromEntries(result.candidates.map(candidate => [candidate.field, candidate.value]));

for (const name of ['flat', 'perspective']) {
  test(`actual ${name} OCR: geometry recovers totals missed by flattened text`, () => {
    const source = fixture(name);
    assert.equal(source.synthetic, true);
    const baseline = extendStatementSummary(source.ocrData.text);
    assert.equal(baseline.values.turnover, undefined);
    assert.equal(baseline.values.totalCharges, undefined);
    const result = extractStatementLayout(source.ocrData);
    assert.deepEqual(totals(result), { turnover: 123456.78, totalCharges: 1234.56 });
    assert.deepEqual(result.blockedFields, []);
    assert(result.candidates.every(candidate => candidate.raw.startsWith('£') && candidate.evidence.includes('OCR position')));
    if (name === 'perspective') {
      assert.equal(result.candidates.find(candidate => candidate.field === 'totalCharges').confidence, 45);
      assert(result.warnings.some(warning => warning.includes('confidence is low')));
    }
  });
}

test('stacked summary rows match labels on the left to currency boxes on the right', () => {
  const result = extractStatementLayout(document([
    line('Your total card transactions', 100, 300),
    line('£89,765.43', 650, 300, { height: 36 }),
    line('Your total charges', 100, 430),
    line('£987.65', 650, 430, { height: 36 }),
    line('Your average transaction', 1150, 300),
    line('£23.45', 1150, 350, { height: 36 }),
    line('Other monthly charges', 100, 700),
    line('Terminal rental', 100, 770),
    line('£19.00', 650, 770),
  ]));
  assert.deepEqual(totals(result), { turnover: 89765.43, totalCharges: 987.65 });
  assert.deepEqual(result.blockedFields, []);
});

test('split currency glyph and amount are recognized without changing digits', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 200),
    { words: [word('£', 500, 200, 520, 230), word('1,234.56', 525, 200, 650, 230)] },
  ]));
  assert.deepEqual(totals(result), { totalCharges: 1234.56 });
  assert.equal(result.candidates[0].raw, '£ 1,234.56');
});

test('existing GBP dot-thousands repair is explicit and warned', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 200), line('£1.234.56', 500, 200),
  ]));
  assert.deepEqual(totals(result), { totalCharges: 1234.56 });
  assert(result.warnings.some(warning => warning.includes('thousands separator')));
});

test('ordinary table rates and average transaction amount cannot fill a missing total', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 200),
    line('Your average transaction', 700, 200), line('£22.50', 700, 250),
    line('Your costs for accepting card payments', 100, 450),
    line('Rate per transaction', 100, 500), line('£0.05', 500, 500),
    line('Terminal rental', 100, 570), line('£19.00', 500, 570),
  ]));
  assert.deepEqual(result.candidates, []);
  assert(result.blockedFields.includes('totalCharges'));
});

test('two equally compatible currency positions are blocked', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 100),
    line('£100.00', 500, 100), line('£200.00', 500, 100),
  ]));
  assert.deepEqual(result.candidates, []);
  assert(result.blockedFields.includes('totalCharges'));
  assert(result.warnings.some(warning => warning.includes('More than one amount')));
});

test('one amount is not shared by turnover and charges', () => {
  const result = extractStatementLayout(document([
    line('Your total card transactions', 100, 100),
    line('Your total charges', 100, 140),
    line('£999.00', 600, 120, { height: 40 }),
  ]));
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(new Set(result.blockedFields), new Set(['turnover', 'totalCharges']));
});

test('conflicting complete total labels are blocked instead of choosing the larger amount', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 100), line('£100.00', 500, 100),
    line('Your total charges', 100, 300), line('£200.00', 500, 300),
  ]));
  assert.deepEqual(result.candidates, []);
  assert(result.blockedFields.includes('totalCharges'));
  assert(result.warnings.some(warning => warning.includes('Conflicting')));
});

for (const raw of ['£1,23.45', '-£100.00', '£-100.00', '£100.00CR', '£100.00%', '(£100.00)']) {
  test(`unsupported money ${raw} is blocked`, () => {
    const result = extractStatementLayout(document([line('Your total charges', 100, 100), line(raw, 500, 100)]));
    assert.deepEqual(result.candidates, []);
    assert(result.blockedFields.includes('totalCharges'));
  });
}

for (const suffix of ['CR', '%']) {
  test(`separate ${suffix} after currency blocks its amount`, () => {
    const result = extractStatementLayout(document([
      line('Your total charges', 100, 100),
      { words: [word('£100.00', 500, 100, 590, 130), word(suffix, 595, 100, 620, 130)] },
    ]));
    assert.deepEqual(result.candidates, []);
    assert(result.blockedFields.includes('totalCharges'));
  });
}

test('a bare percentage is not a monetary total', () => {
  const result = extractStatementLayout(document([line('Your total charges', 100, 100), line('1.25%', 500, 100)]));
  assert.deepEqual(result.candidates, []);
  assert(result.blockedFields.includes('totalCharges'));
});

for (const context of ['Bank statement. Opening balance. Your card payments summary. GBP.', 'Your card payments summary. Amounts in EUR.', 'Your card payments summary. $100.00', 'Ordinary tariff schedule. GBP.']) {
  test(`unsupported context: ${context}`, () => {
    const result = extractStatementLayout(document([line('Your total charges', 100, 100), line('£100.00', 500, 100)], context));
    assert.deepEqual(result.candidates, []);
  });
}

test('missing geometry returns no candidates or claimed ambiguity', () => {
  assert.deepEqual(extractStatementLayout({ text: 'Your card payments summary. Your total charges £100.00' }), { candidates: [], warnings: [], blockedFields: [] });
  assert.deepEqual(extractStatementLayout({ blocks: [{ paragraphs: [{ lines: [{ words: [{ text: '£100.00', bbox: { x0: 0, y0: 0, x1: 0, y1: 20 } }] }] }] }] }), { candidates: [], warnings: [], blockedFields: [] });
});


test('photo-style period suffixes and wrapped labels keep their right-hand totals', () => {
  const data = document([
    line('Your total card', 100, 200),
    line('transactions in the last', 100, 236),
    line('12 months', 100, 272),
    line('£89,765.43', 650, 236, { height: 36 }),
    line('Your total charges in the last 12 months', 100, 400),
    line('£987.65', 650, 400, { height: 36 }),
    line('Your average transaction', 1150, 200),
    line('£23.45', 1150, 250, { height: 36 }),
  ], 'Your card payments summary. Last 12 months. Your total card Your total charges in the last transactions in the last £89,765.43 £987.65 £23.45. GBP.');
  const result = extractStatementLayout(data);
  assert.deepEqual(totals(result), { turnover: 89765.43, totalCharges: 987.65 });
  assert.deepEqual(result.blockedFields, []);
});

for (const suffix of ['in', 'in the', 'in the last', 'over the past 12 months', 'for the previous twelve months']) {
  test(`explicit or wrapped period suffix: ${suffix}`, () => {
    const result = extractStatementLayout(document([line('Your total charges ' + suffix, 100, 100), line('£123.45', 800, 100)]));
    assert.deepEqual(totals(result), { totalCharges: 123.45 });
  });
}

for (const suffix of ['per transaction', 'in the last 6 months', 'excluding VAT', 'including rentals we might charge']) {
  test(`arbitrary or unsupported total suffix is not accepted: ${suffix}`, () => {
    const result = extractStatementLayout(document([line('Your total charges ' + suffix, 100, 100), line('£123.45', 800, 100)]));
    assert.deepEqual(result.candidates, []);
  });
}

test('an invalid nearest amount blocks fallback to a different nearby amount', () => {
  const result = extractStatementLayout(document([
    line('Your total charges', 100, 100),
    line('£1,23.45', 500, 100),
    line('£500.00', 500, 180),
  ]));
  assert.deepEqual(result.candidates, []);
  assert(result.blockedFields.includes('totalCharges'));
});

test('a recognized label with no amount is blocked, while an absent label is not', () => {
  const result = extractStatementLayout(document([line('Your total charges', 100, 100)]));
  assert.deepEqual(result.blockedFields, ['totalCharges']);
  assert.deepEqual(extractStatementLayout(document([line('No usable totals', 100, 100)])).blockedFields, []);
});


test('label footnotes survive OCR normalization without changing amount digits', () => {
  const result = extractStatementLayout(document([
    line('Your total card transactions¹ in the last 12 months', 100, 100),
    line('£12,345.67', 900, 100),
    line('Your total charges² in the last 12 months', 100, 300),
    line('£123.45', 900, 300),
  ]));
  assert.deepEqual(totals(result), { turnover: 12345.67, totalCharges: 123.45 });
});


test('actual stacked OCR retains the previously working totals beside vertically centred boxes', () => {
  const source = fixture('stacked');
  assert.equal(source.synthetic, true);
  const result = extractStatementLayout(source.ocrData);
  assert.deepEqual(totals(result), { turnover: 480000, totalCharges: 3600 });
  assert.deepEqual(result.blockedFields, []);
  assert.equal(result.candidates.find(candidate => candidate.field === 'turnover').raw, '£480.000.00');
  assert(result.warnings.some(warning => warning.includes('thousands separator')));
});

test('right-hand values below the first label baseline can match without accepting another row', () => {
  const result = extractStatementLayout(document([
    line('Your total card transactions', 76, 506, { height: 24 }),
    line('in the last 12 months', 76, 552, { height: 24 }),
    { words: [word('£480.000.00', 1051, 532, 1238, 555)] },
    line('Your average transaction value', 76, 702),
    line('£240.00', 1051, 702),
  ]));
  assert.deepEqual(totals(result), { turnover: 480000 });
  assert.deepEqual(result.blockedFields, []);
});
