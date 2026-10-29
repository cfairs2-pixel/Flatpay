/** Conservative, browser-safe card-processing statement extraction and reviewed calculations.
 * No raw text, payment identifiers, files or transaction rows are returned or retained.
 */
export const STATEMENT_FIELDS = Object.freeze([
  { key: "businessName", label: "Merchant trading name", type: "text" },
  { key: "provider", label: "Current provider", type: "text" },
  { key: "periodStart", label: "Statement start date", type: "date" },
  { key: "periodEnd", label: "Statement end date", type: "date" },
  { key: "periodMonths", label: "Months covered", type: "number" },
  { key: "turnover", label: "Total card turnover", type: "money" },
  { key: "totalCharges", label: "Total current charges", type: "money" },
  { key: "businessVolume", label: "Business card turnover", type: "money" },
  {
    key: "internationalVolume",
    label: "International card turnover",
    type: "money",
  },
  { key: "amexVolume", label: "Amex turnover", type: "money" },
  { key: "amexRate", label: "Current Amex rate", type: "rate" },
  { key: "transactionCount", label: "Number of card payments", type: "number" },
  { key: "processingFees", label: "Processing fees", type: "money" },
  { key: "terminalRental", label: "Terminal rental", type: "money" },
  { key: "pciFees", label: "PCI fees", type: "money" },
  { key: "otherFees", label: "Other fees", type: "money" },
  { key: "vat", label: "VAT charged", type: "money" },
]);
const metadata = new Map(STATEMENT_FIELDS.map((field) => [field.key, field]));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const present = (value) =>
  value !== "" && value !== undefined && value !== null;
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const numeric = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()))) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0 &&
  Number(value) <= 1e15
    ? Number(value)
    : null;
const tidy = (value) =>
  String(value || "")
    .replace(/[\u00a0\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
const datePattern =
  "(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4})";
const dateValue = (source) => {
  const value = tidy(source);
  let year, month, day;
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [, year, month, day] = match;
  else if ((match = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)))
    [, day, month, year] = match;
  else if ((match = value.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/i))) {
    day = match[1];
    year = match[3];
    month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  } else return null;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    Number(year) < 2000 ||
    Number(year) > 2100
  )
    return null;
  return date.toISOString().slice(0, 10);
};
function calendarMonths(start, end) {
  if (!start || !end || end < start) return null;
  const a = new Date(`${start}T00:00:00Z`),
    b = new Date(`${end}T00:00:00Z`);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    b.getUTCMonth() -
    a.getUTCMonth() +
    1;
  const last = new Date(
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return a.getUTCDate() === 1 && b.getUTCDate() === last ? months : null;
}
function moneyValues(source) {
  // Rates, quantities, dates, pence-per-item prices, credits and negative figures are not money totals.
  const withoutRates = source.replace(
    /\b\d+(?:[.,]\d+)?\s*(?:%|p\b|pence\b)/gi,
    " ",
  );
  const matches = [
    ...withoutRates.matchAll(
      /(?:GBP\s*|£\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*GBP)?/gi,
    ),
  ];
  return matches
    .filter((match) => {
      const before = withoutRates.slice(
        Math.max(0, match.index - 2),
        match.index,
      );
      const after = withoutRates.slice(
        match.index + match[0].length,
        match.index + match[0].length + 12,
      );
      return (
        !/[/(\d,.-]$/.test(before) &&
        !/^[\d,.]/.test(after) &&
        !/^\s*(?:\/|transactions?\b|payments?\b|items?\b|CR\b|credit\b)/i.test(
          after,
        ) &&
        !match[1].startsWith("-")
      );
    })
    .map((match) => ({
      value: Number(match[1].replace(/,/g, "")),
      currency: /£|GBP/i.test(match[0]),
      decimal: /\.\d{1,2}/.test(match[1]),
    }))
    .filter((item) => Number.isFinite(item.value));
}
function singleAmount(source) {
  const amounts = moneyValues(source);
  if (amounts.length === 1) return amounts[0].value;
  const explicit = amounts.filter((item) => item.currency);
  return explicit.length === 1 ? explicit[0].value : null;
}
const scalarRules = [
  [
    "turnover",
    /^(?:total\s+)?(?:card\s+)?(?:transaction\s+(?:value|amount|volume)|sales(?:\s+(?:value|volume|amount|turnover))?|card\s+turnover|card\s+sales|turnover|gross\s+card\s+sales|processed\s+volume|total\s+processed)(?:\s*\([^)]*\))?\s*[:=|–-]?\s*(.*)$/i,
    "Total card turnover",
  ],
  [
    "totalCharges",
    /^(?:grand\s+)?total\s+(?:charges|fees|costs|amount\s+(?:due|payable))(?!\s*(?:per|rate|ex|excl|excluding|before))(?:(?:\s*\((?:including|incl\.?)\s*vat\))|(?:\s+(?:including|incl\.?)\s*vat))?\s*[:=|–-]?\s*(.*)$/i,
    "Total statement charges",
  ],
  [
    "processingFees",
    /^(?:total\s+)?(?:processing\s+(?:fees|charges)|merchant\s+service\s+(?:charge|charges|fees)|card\s+processing\s+(?:charges|fees))\s*[:=|–-]?\s*(.*)$/i,
    "Processing fees",
  ],
  [
    "terminalRental",
    /^(?:total\s+)?(?:terminal\s+(?:rental|rent|hire)|monthly\s+terminal\s+(?:rental|rent|hire))\s*[:=|–-]?\s*(.*)$/i,
    "Terminal rental",
  ],
  [
    "pciFees",
    /^(?:total\s+)?pci(?:\s+dss)?(?:\s+(?:compliance|non[- ]compliance|management))?\s+(?:fee|fees|charge|charges)\s*[:=|–-]?\s*(.*)$/i,
    "PCI fees",
  ],
  [
    "otherFees",
    /^(?:total\s+)?(?:other|additional)\s+(?:fees|charges)\s*[:=|–-]?\s*(.*)$/i,
    "Other fees",
  ],
  [
    "vat",
    /^(?:total\s+)?vat(?:\s+(?:charged|amount))?\s*(?:@?\s*\d+(?:\.\d+)?\s*%)?\s*[:=|–-]?\s*(.*)$/i,
    "VAT charged",
  ],
  [
    "businessVolume",
    /^(?:total\s+)?(?:business|commercial|corporate)\s+(?:card\s+)?(?:turnover|sales(?:\s+value)?|transaction\s+value|volume)\s*[:=|–-]?\s*(.*)$/i,
    "Business card turnover",
  ],
  [
    "internationalVolume",
    /^(?:total\s+)?(?:international|overseas|foreign)\s+(?:card\s+)?(?:turnover|sales(?:\s+value)?|transaction\s+value|volume)\s*[:=|–-]?\s*(.*)$/i,
    "International card turnover",
  ],
  [
    "amexVolume",
    /^(?:total\s+)?(?:amex|american\s+express)\s+(?:card\s+)?(?:turnover|sales(?:\s+value)?|transaction\s+value|volume)\s*[:=|–-]?\s*(.*)$/i,
    "Amex turnover",
  ],
];
const providers = [
  "Dojo",
  "Worldpay",
  "SumUp",
  "Zettle",
  "Square",
  "Barclaycard",
  "Elavon",
  "Global Payments",
  "Clover",
  "Takepayments",
  "Teya",
  "Stripe",
  "Lloyds Cardnet",
  "Adyen",
  "Revolut",
];

export function parseMerchantStatement(text) {
  if (typeof text !== "string")
    throw new Error("Provide statement text to read.");
  if (text.length > 300000)
    throw new Error(
      "Statement text exceeds 300,000 characters. Read fewer pages at a time.",
    );
  const values = {},
    evidence = {},
    warnings = [];
  const candidates = new Map();
  const add = (key, value, label) => {
    if (value === null || value === undefined || value === "") return;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({ value, label });
  };
  const rawLines = text
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  const lines = rawLines.map(tidy);
  const foreignCurrency = /(?:\b(?:USD|EUR|AUD|CAD|NZD|CHF|JPY)\b|[$€])/i.test(
    text,
  );
  const bankStatement =
    /(?:^|\n)\s*(?:[A-Z ]+\s+)?bank\s+statement\b/i.test(text) ||
    (/\b(?:opening|closing)\s+balance\b/i.test(text) &&
      /\b(?:sort\s+code|iban|account\s+(?:number|no))\b/i.test(text));
  const processingEvidence =
    /\b(?:card\s+(?:processing|turnover|sales)|merchant\s+(?:services?|statement)|processing\s+(?:fees|charges)|acquirer)\b/i.test(
      text,
    );
  const wrongDocument = bankStatement && !processingEvidence;
  if (/\b(?:refunds?|cashback)\b/i.test(text))
    warnings.push(
      "Refunds or cashback appear in this statement. Confirm whether turnover is gross or net before comparing effective rates and savings.",
    );
  if (wrongDocument)
    warnings.push(
      "This looks like a bank statement. Upload the merchant card-processing statement; bank charges and balances are not used as processing figures.",
    );
  if (foreignCurrency)
    warnings.push(
      "A non-GBP currency appears in this statement. Monetary figures need manual confirmation in GBP; automatic money extraction is paused.",
    );
  else if (text.trim() && !/(?:£|\bGBP\b|pounds?\s+sterling)/i.test(text))
    warnings.push(
      "The currency is not shown clearly. Confirm all amounts are in GBP.",
    );
  let header = null,
    exclusionSubtotal = [],
    hasInclusiveTotal = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let match;
    if (
      (match = line.match(
        /^(?:merchant(?:\s+trading)?\s+name|business\s+name|trading\s+name)\s*[:=]\s*(.{2,300})$/i,
      )) &&
      /[a-z]/i.test(match[1]) &&
      !/\b(?:account|merchant)\s*(?:id|no|number)\b/i.test(match[1])
    )
      add("businessName", match[1], "Merchant trading name");
    if (
      (match = line.match(
        /^(?:current\s+provider|payment\s+provider|provider|acquirer|payment\s+processor)\s*[:=]\s*(.{2,100})$/i,
      )) &&
      /[a-z]/i.test(match[1]) &&
      !/\d{5}|https?:|@/.test(match[1])
    )
      add("provider", match[1], "Named payment provider");
    if (index < 8)
      for (const provider of providers) {
        const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (
          new RegExp(
            `^${escaped}(?:$|\\s+(?:merchant|statement|payments|card|monthly|quarterly))`,
            "i",
          ).test(line)
        )
          add("provider", provider, "Provider statement heading");
      }
    if (
      (match = line.match(
        new RegExp(
          `^(?:statement|billing|processing|reporting)\\s+(?:period|dates?)\\s*[:=]?\\s*(${datePattern})\\s*(?:to|[-–—])\\s*(${datePattern})$`,
          "i",
        ),
      ))
    ) {
      add("periodStart", dateValue(match[1]), "Statement period start");
      add("periodEnd", dateValue(match[2]), "Statement period end");
    }
    if (
      (match = line.match(
        new RegExp(
          `^(?:statement\\s+)?(?:start|from)\\s*(?:date)?\\s*[:=]\\s*(${datePattern})$`,
          "i",
        ),
      ))
    )
      add("periodStart", dateValue(match[1]), "Statement period start");
    if (
      (match = line.match(
        new RegExp(
          `^(?:statement\\s+)?(?:end|to)\\s*(?:date)?\\s*[:=]\\s*(${datePattern})$`,
          "i",
        ),
      ))
    )
      add("periodEnd", dateValue(match[1]), "Statement period end");
    if (
      (match = line.match(
        /^(?:statement\s+month|month\s+(?:ending|of)|monthly\s+statement(?:\s+for)?)\s*[:=]?\s*([a-z]{3,9})\s+(\d{4})$/i,
      ))
    ) {
      const first = dateValue(`1 ${match[1]} ${match[2]}`);
      if (first) {
        const d = new Date(`${first}T00:00:00Z`);
        add("periodStart", first, "Statement month");
        add(
          "periodEnd",
          new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
            .toISOString()
            .slice(0, 10),
          "Statement month",
        );
      }
    }
    if (
      /^(?:monthly\s+(?:merchant\s+)?statement|statement\s+frequency\s*:\s*monthly)$/i.test(
        line,
      )
    )
      add("periodMonths", 1, "Monthly statement frequency");
    if (
      /^(?:quarterly\s+(?:merchant\s+)?statement|statement\s+frequency\s*:\s*quarterly)$/i.test(
        line,
      )
    )
      add("periodMonths", 3, "Quarterly statement frequency");
    if (
      (match = line.match(
        /^(?:months\s+covered|statement\s+months|period\s+months)\s*[:=]\s*(\d+(?:\.\d+)?)$/i,
      ))
    ) {
      if (Number(match[1]) > 0 && Number(match[1]) <= 120)
        add("periodMonths", Number(match[1]), "Months covered");
    }
    if (
      (match = line.match(
        /^(?:total\s+)?(?:number\s+of\s+(?:card\s+)?(?:payments|transactions)|transaction\s+count|card\s+payment\s+count)\s*[:=|–-]?\s*([\d,]+)$/i,
      ))
    )
      add(
        "transactionCount",
        Number(match[1].replace(/,/g, "")),
        "Number of card payments",
      );
    if (!foreignCurrency && !wrongDocument) {
      if (
        (match = line.match(
          /^(?:amex|american\s+express)\s+(?:processing\s+)?rate\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%$/i,
        )) &&
        Number(match[1]) <= 100
      )
        add("amexRate", Number(match[1]), "Amex processing rate");
      if (
        (match = line.match(
          /^total\s+(?:charges|fees)\s*(?:\((?:excluding|excl\.?|ex)\s+vat\)|(?:excluding|excl\.?|ex)\s+vat|before\s+vat)\s*[:=|–-]?\s*(.*)$/i,
        ))
      ) {
        const value = singleAmount(match[1]);
        if (value !== null) exclusionSubtotal.push(value);
      }
      if (
        (match = line.match(
          /^total\s+(?:charges|fees)\s*[:=]?\s*(.*?)\s*\((?:ex|excl\.?|excluding)\s+vat\)\s*$/i,
        ))
      ) {
        const value = singleAmount(match[1]);
        if (value !== null) exclusionSubtotal.push(value);
      }
      for (const [key, rule, label] of scalarRules) {
        const result = line.match(rule);
        if (!result) continue;
        if (
          key === "totalCharges" &&
          /\bamount\s+(?:due|payable)\b/i.test(line) &&
          !processingEvidence &&
          !candidates.has("provider")
        )
          continue;
        let remainder = result[1];
        if (!remainder && lines[index + 1] && /^[£\d]/.test(lines[index + 1]))
          remainder = lines[index + 1];
        // An excluded-VAT subtotal must not be presented as the amount payable.
        if (
          key === "totalCharges" &&
          /\b(?:ex|excl|excluding|before)\b/i.test(remainder)
        )
          continue;
        const value = singleAmount(remainder);
        if (value !== null) {
          add(key, value, label);
          if (key === "totalCharges") hasInclusiveTotal = true;
        }
      }
    }
    const columns = rawLines[index]
      .trim()
      .split(/\t+| {2,}|\s*\|\s*/)
      .map(tidy)
      .filter(Boolean);
    if (
      columns.length >= 3 &&
      /card\s*type|category/i.test(columns[0]) &&
      columns.some((column) =>
        /^(?:sales\s+value|transaction\s+value|turnover|sales\s+amount|volume|value)$/i.test(
          column,
        ),
      )
    ) {
      header = columns;
      continue;
    }
    if (
      header &&
      columns.length === header.length &&
      !foreignCurrency &&
      !wrongDocument
    ) {
      const volumeIndex = header.findIndex((column) =>
        /^(?:sales\s+value|transaction\s+value|turnover|sales\s+amount|volume|value)$/i.test(
          column,
        ),
      );
      const countIndex = header.findIndex((column) =>
        /^(?:count|transactions|number|payments)$/i.test(column),
      );
      const chargeIndex = header.findIndex((column) =>
        /^(?:fees|charges)$/i.test(column),
      );
      const rateIndex = header.findIndex((column) => /^rate$/i.test(column));
      const name = columns[0];
      const category =
        /^(?:business|commercial|corporate)(?:\s+cards?)?$/i.test(name)
          ? "businessVolume"
          : /^(?:international|overseas|foreign)(?:\s+cards?)?$/i.test(name)
            ? "internationalVolume"
            : /^(?:amex|american\s+express)$/i.test(name)
              ? "amexVolume"
              : null;
      if (category) {
        add(
          category,
          singleAmount(columns[volumeIndex]),
          metadata.get(category).label,
        );
        if (
          category === "amexVolume" &&
          rateIndex >= 0 &&
          /^\d+(?:\.\d+)?\s*%$/.test(columns[rateIndex])
        )
          add(
            "amexRate",
            Number(columns[rateIndex].replace(/\s*%/, "")),
            "Amex table rate",
          );
      }
      if (/^total(?:\s+card\s+sales)?$/i.test(name)) {
        add(
          "turnover",
          singleAmount(columns[volumeIndex]),
          "Card table total turnover",
        );
        if (countIndex >= 0 && /^[\d,]+$/.test(columns[countIndex]))
          add(
            "transactionCount",
            Number(columns[countIndex].replace(/,/g, "")),
            "Card table total payments",
          );
        // Table charges commonly exclude monthly fees: retain as processing fees, never all-in total charges.
        if (chargeIndex >= 0)
          add(
            "processingFees",
            singleAmount(columns[chargeIndex]),
            "Card table processing fees",
          );
      }
    }
  }
  for (const [key, allItems] of candidates) {
    const named =
      key === "provider"
        ? allItems.filter((item) => item.label === "Named payment provider")
        : [];
    const items = named.length ? named : allItems;
    const unique = [...new Set(items.map((item) => item.value))];
    if (unique.length === 1) {
      values[key] = unique[0];
      evidence[key] = items[0].label;
    } else
      warnings.push(
        `Conflicting ${metadata.get(key).label.toLowerCase()} values were found. Enter the correct statement total.`,
      );
  }
  const derivedMonths = calendarMonths(values.periodStart, values.periodEnd);
  if (derivedMonths !== null) {
    if (own(values, "periodMonths") && values.periodMonths !== derivedMonths) {
      delete values.periodMonths;
      delete evidence.periodMonths;
      warnings.push(
        "The stated frequency and date range disagree. Confirm the months covered before using monthly figures.",
      );
    } else {
      values.periodMonths = derivedMonths;
      evidence.periodMonths = "Complete calendar months in statement period";
    }
  } else if (values.periodStart && values.periodEnd) {
    delete values.periodMonths;
    delete evidence.periodMonths;
    warnings.push(
      "This date range is a partial month or non-calendar period. Confirm its equivalent months before monthly or annual estimates are used.",
    );
  }
  if (!hasInclusiveTotal && exclusionSubtotal.length && own(values, "vat")) {
    const subtotals = [...new Set(exclusionSubtotal)];
    if (subtotals.length === 1) {
      values.totalCharges = round(subtotals[0] + values.vat);
      evidence.totalCharges = "Charges excluding VAT plus VAT charged";
    } else
      warnings.push(
        "Conflicting charges excluding VAT were found. Confirm the full charges including VAT.",
      );
  }
  if (
    own(values, "periodStart") &&
    own(values, "periodEnd") &&
    values.periodEnd < values.periodStart
  ) {
    delete values.periodMonths;
    warnings.push(
      "The statement end date precedes its start date. Correct the dates and months covered.",
    );
  }
  if (text.trim() && !own(values, "turnover"))
    warnings.push(
      "A clear card-turnover total was not found. Settlement amounts and bank balances are not used as card sales.",
    );
  if (text.trim() && !own(values, "totalCharges"))
    warnings.push(
      "A clear total charge was not found. Add the complete processing, rental and other applicable fees; check whether VAT is included.",
    );
  if (text.trim() && !own(values, "periodMonths"))
    warnings.push(
      "Confirm how many months this statement covers before using monthly figures or annual TPV estimates.",
    );
  if (own(values, "totalCharges"))
    warnings.push(
      "Check the total charges include all relevant fees and the intended VAT basis. Amex may be billed separately.",
    );
  return { values, evidence, warnings: [...new Set(warnings)] };
}

function cleanValues(input, strict = false) {
  const result = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (strict)
      throw new Error("Review the statement values before applying them.");
    return result;
  }
  for (const field of STATEMENT_FIELDS) {
    if (!present(input[field.key])) continue;
    const value = input[field.key];
    let clean = null;
    if (field.type === "text") {
      if (
        typeof value === "string" &&
        value.trim().length <= 300 &&
        !/[\r\n\u0000-\u001f]/.test(value)
      )
        clean = value.trim();
    } else if (field.type === "date") clean = dateValue(value);
    else {
      clean = numeric(value);
      if (field.key === "periodMonths" && !(clean > 0 && clean <= 120))
        clean = null;
      if (field.key === "transactionCount" && !Number.isSafeInteger(clean))
        clean = null;
      if (field.type === "rate" && clean > 100) clean = null;
    }
    if (clean === null && strict)
      throw new Error(
        `Check ${field.label.toLowerCase()}; enter a valid ${field.type === "date" ? "date" : field.type === "text" ? "short text value" : "non-negative number"}.`,
      );
    if (clean !== null) result[field.key] = clean;
  }
  return result;
}
export function calculateStatement(input = {}) {
  const values = cleanValues(input),
    months = values.periodMonths ?? null,
    turnover = values.turnover ?? null,
    charges = values.totalCharges ?? null;
  const warnings = [];
  const monthly = (value) =>
    value === undefined || months === null ? null : round(value / months);
  const share = (key) =>
    turnover > 0 && values[key] !== undefined
      ? (values[key] / turnover) * 100
      : null;
  for (const key of ["businessVolume", "internationalVolume", "amexVolume"])
    if (
      values[key] !== undefined &&
      turnover !== null &&
      values[key] > turnover
    )
      warnings.push(
        `${metadata.get(key).label} exceeds total turnover. Correct the figures before applying them.`,
      );
  if (
    values.periodStart &&
    values.periodEnd &&
    values.periodEnd < values.periodStart
  )
    warnings.push("Statement end date precedes start date.");
  if (months === null)
    warnings.push(
      "Confirm months covered to calculate monthly figures and annual TPV run rate.",
    );
  if (turnover === 0 && charges > 0)
    warnings.push(
      "Fees are shown with no card turnover. An effective rate cannot be calculated.",
    );
  const monthlyVolume = monthly(values.turnover);
  return {
    monthlyVolume,
    monthlyCharges: monthly(values.totalCharges),
    annualTpv:
      turnover !== null && months !== null
        ? round((turnover / months) * 12)
        : null,
    effectiveRate:
      turnover > 0 && charges !== null ? (charges / turnover) * 100 : null,
    businessShare: share("businessVolume"),
    internationalShare: share("internationalVolume"),
    amexShare: share("amexVolume"),
    averageTransactionValue:
      turnover !== null && values.transactionCount > 0
        ? round(turnover / values.transactionCount)
        : null,
    monthlyBusinessVolume: monthly(values.businessVolume),
    monthlyInternationalVolume: monthly(values.internationalVolume),
    monthlyAmexVolume: monthly(values.amexVolume),
    warnings,
  };
}
export function buildStatementPatch(input, selectedKeys, deal = {}) {
  if (!Array.isArray(selectedKeys))
    throw new Error("Choose the statement details to apply.");
  const selection = [...new Set(selectedKeys)];
  if (selection.some((key) => !metadata.has(key)))
    throw new Error("Only reviewed statement fields can be applied.");
  if (!selection.length) return {};
  const source = Object.fromEntries(
    selection
      .filter((key) => own(input || {}, key))
      .map((key) => [key, input[key]]),
  );
  const values = cleanValues(source, true);
  if (!Object.keys(values).length) return {};
  const calc = calculateStatement(values);
  if (calc.warnings.some((warning) => /exceeds|precedes/.test(warning)))
    throw new Error(
      calc.warnings.find((warning) => /exceeds|precedes/.test(warning)),
    );
  const patch = {
    statementAnalysis: {
      version: 1,
      currency: "GBP",
      reviewedAt: new Date().toISOString(),
      values,
    },
  };
  for (const key of ["businessName", "provider", "amexRate"])
    if (own(values, key)) patch[key] = values[key];
  const mapping = {
    turnover: ["monthlyVolume", "monthlyVolume"],
    totalCharges: ["currentCharges", "monthlyCharges"],
    businessVolume: ["businessVolume", "monthlyBusinessVolume"],
    internationalVolume: ["internationalVolume", "monthlyInternationalVolume"],
    amexVolume: ["amexVolume", "monthlyAmexVolume"],
  };
  for (const [key, [target, result]] of Object.entries(mapping))
    if (own(values, key)) {
      if (values.periodMonths === undefined)
        throw new Error(
          "Select and confirm months covered before applying turnover or charges.",
        );
      patch[target] = calc[result];
    }
  // Preserve the tracker invariant even when only part of a statement is selected.
  const total = patch.monthlyVolume ?? numeric(deal.monthlyVolume);
  for (const key of ["businessVolume", "internationalVolume", "amexVolume"]) {
    const volume = patch[key] ?? numeric(deal[key]);
    if (total !== null && volume !== null && volume > total)
      throw new Error(
        `${metadata.get(key).label} exceeds monthly turnover. Review the card mix and total together.`,
      );
  }
  return patch;
}

/** Validate the exact saved review shape so uploaded files/raw OCR cannot enter records. */
export function validateStatementAnalysis(analysis) {
  if (analysis === undefined || analysis === null) return [];
  const errors = [];
  if (typeof analysis !== "object" || Array.isArray(analysis))
    return ["Statement analysis must be an object."];
  const allowed = new Set(["version", "currency", "reviewedAt", "values"]);
  if (Object.keys(analysis).some((key) => !allowed.has(key)))
    errors.push(
      "Statement analysis contains unsupported fields. Only reviewed figures may be saved.",
    );
  if (analysis.version !== 1)
    errors.push("Statement analysis version must be 1.");
  if (analysis.currency !== "GBP")
    errors.push("Statement analysis currency must be GBP.");
  if (
    typeof analysis.reviewedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      analysis.reviewedAt,
    ) ||
    !Number.isFinite(Date.parse(analysis.reviewedAt)) ||
    new Date(analysis.reviewedAt).toISOString() !== analysis.reviewedAt
  )
    errors.push("Statement analysis needs a valid review timestamp.");
  if (
    !analysis.values ||
    typeof analysis.values !== "object" ||
    Array.isArray(analysis.values)
  )
    errors.push("Statement analysis values must be an object.");
  else {
    if (Object.keys(analysis.values).some((key) => !metadata.has(key)))
      errors.push("Statement analysis values contain unsupported fields.");
    try {
      cleanValues(analysis.values, true);
    } catch (failure) {
      errors.push(failure.message);
    }
    const values = cleanValues(analysis.values);
    if (
      values.periodStart &&
      values.periodEnd &&
      values.periodEnd < values.periodStart
    )
      errors.push("Statement analysis end date cannot precede its start date.");
    for (const key of ["businessVolume", "internationalVolume", "amexVolume"])
      if (
        values.turnover !== undefined &&
        values[key] !== undefined &&
        values[key] > values.turnover
      )
        errors.push(
          `Statement analysis ${metadata.get(key).label.toLowerCase()} cannot exceed turnover.`,
        );
  }
  return errors;
}
