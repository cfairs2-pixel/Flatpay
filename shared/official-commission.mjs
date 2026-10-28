/**
 * Pure reproduction of the user-supplied SM commission calculator.
 * Rates are percentage points (1.04 means 1.04%), TPV is ANNUAL pounds.
 * Source is a draft scheme; totals are estimates, never payroll confirmation.
 */
export const COMMISSION_SOURCE = Object.freeze({
  url: "https://sm-commission.pages.dev/SM_4_Calculator",
  rulesUrl: "https://sm-commission.pages.dev/SM_2_Rules",
  version: "DRAFT v2 · May 2026",
  retrieved: "2026-10-27",
  notes: [
    "Matches the executable calculator, including whole-pound rounding per deal and TPV capped at £500,000.",
    "The printed Introduction matrix differs at some interpolated points and extends beyond the calculator’s £500,000 cap. Confirm out-of-range deals with a manager.",
    "The calculator retains add-ons below the rate floor, while written Rules say no commission below the floor. Below-floor eligibility requires manager confirmation.",
    "The minimum guarantee is a portfolio-wide top-up, not extra commission per merchant. POS volume bonuses count installed merchant deals, not hardware units.",
    "Current Rules replace the training document’s fixed activation threshold with 0.5% of declared annual TPV from 1 July 2026.",
  ],
});
export const TPV_COLUMNS = Object.freeze([
  48000, 100000, 200000, 300000, 500000,
]);
const MATRIX = {
  0.0169: [135, 315, 675, 855, 1035],
  0.0149: [117, 279, 603, 765, 927],
  0.0129: [99, 243, 531, 675, 819],
  0.0109: [81, 207, 459, 585, 711],
  0.0089: [63, 171, 387, 495, 603],
  0.0079: [54, 153, 351, 450, 549],
  0.0069: [45, 135, 315, 405, 495],
  0.0059: [36, 117, 279, 360, 441],
  0.0049: [27, 99, 243, 315, 387],
};
const pounds = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const number = (value, label = "Amount") => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    (typeof value === "string" && !value.trim()) ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new RangeError(`${label} must be a non-negative finite number.`);
  return Number(value);
};
const quantity = (value, label = "Count") => {
  const result = number(value, label);
  if (!Number.isInteger(result))
    throw new RangeError(`${label} must be a whole number.`);
  return result;
};
const productFloor = (product) => {
  if (!["terminal", "pos", "mpos"].includes(product))
    throw new RangeError("Product must be terminal, pos, or mpos.");
  return product === "terminal" ? 0.0049 : 0.0089;
};
function tpvOnRow(row, tpv) {
  if (tpv <= TPV_COLUMNS[0]) return row[0];
  for (let i = 0; i < TPV_COLUMNS.length - 1; i++) {
    if (tpv >= TPV_COLUMNS[i] && tpv < TPV_COLUMNS[i + 1]) {
      const f = (tpv - TPV_COLUMNS[i]) / (TPV_COLUMNS[i + 1] - TPV_COLUMNS[i]);
      return row[i] + (row[i + 1] - row[i]) * f;
    }
  }
  return row[TPV_COLUMNS.length - 1];
}
export function lookupMatrix(ratePercent, annualTpv, product = "terminal") {
  const rate = number(ratePercent, "Rate") / 100,
    tpv = number(annualTpv, "Annual TPV"),
    floor = productFloor(product);
  if (rate < floor) return 0;
  const keys = Object.keys(MATRIX)
    .map(Number)
    .sort((a, b) => b - a);
  if (rate >= keys[0]) return Math.round(tpvOnRow(MATRIX[keys[0]], tpv));
  if (rate <= keys.at(-1))
    return Math.round(tpvOnRow(MATRIX[keys.at(-1)], tpv));
  let upper = keys[0],
    lower = keys.at(-1);
  for (let i = 0; i < keys.length - 1; i++)
    if (rate <= keys[i] && rate > keys[i + 1]) {
      upper = keys[i];
      lower = keys[i + 1];
      break;
    }
  const upperVal = tpvOnRow(MATRIX[upper], tpv),
    lowerVal = tpvOnRow(MATRIX[lower], tpv);
  return Math.round(
    lowerVal + (upperVal - lowerVal) * ((rate - lower) / (upper - lower)),
  );
}
export function upfrontBonus(amount, product = "pos") {
  productFloor(product);
  const upfront = number(amount, "Upfront amount");
  if (product === "terminal") return 0;
  return upfront < (product === "mpos" ? 250 : 500)
    ? -100
    : Math.round(upfront * 0.15);
}
export function posVolumeBonus(count) {
  const n = quantity(count, "POS deal count");
  const tiers = {
    2: 200,
    3: 350,
    4: 600,
    5: 1000,
    6: 1500,
    7: 2200,
    8: 2800,
    9: 3300,
    10: 3800,
  };
  return n < 2 ? 0 : n <= 10 ? tiers[n] : 3800 + (n - 10) * 300;
}
export function amexRateBonus(rate) {
  if (rate === "" || rate === undefined || rate === null) return 0;
  const numericRate = number(rate, "Amex rate");
  return { 3.89: 40, 2.99: 20, 2.49: 10, 1.99: 0 }[String(numericRate)] ?? 0;
}
export const SCENARIOS = Object.freeze([
  {
    name: "On Budget",
    v: {
      termInst: 12,
      posInst: 5,
      mposInst: 2,
      termRate: 0.79,
      posRate: 1.04,
      mposRate: 1.04,
      termTpv: 125000,
      posTpv: 200000,
      mposTpv: 100000,
      upfront: 1000,
      mposUpfront: 500,
      quickInst: 10,
      ogInst: 6,
      quickSales: 6,
      amex375: 0,
      amex299: 10,
      amex249: 0,
      hitRate: 100,
    },
  },
  {
    name: "High Performer",
    v: {
      termInst: 12,
      posInst: 7,
      mposInst: 3,
      termRate: 0.79,
      posRate: 1.04,
      mposRate: 1.04,
      termTpv: 125000,
      posTpv: 200000,
      mposTpv: 100000,
      upfront: 1000,
      mposUpfront: 500,
      quickInst: 9,
      ogInst: 5,
      quickSales: 5,
      amex375: 0,
      amex299: 9,
      amex249: 0,
      hitRate: 100,
    },
  },
  {
    name: "Low Performer",
    v: {
      termInst: 6,
      posInst: 3,
      mposInst: 1,
      termRate: 0.79,
      posRate: 1.04,
      mposRate: 1.04,
      termTpv: 125000,
      posTpv: 200000,
      mposTpv: 100000,
      upfront: 1000,
      mposUpfront: 500,
      quickInst: 5,
      ogInst: 3,
      quickSales: 3,
      amex375: 0,
      amex299: 5,
      amex249: 0,
      hitRate: 100,
    },
  },
]);
/** Exact arithmetic and input keys from the source calculator (amex375 is its historical key for 3.89%). */
export function calculatePortfolioCommission(input) {
  const p = { ...input };
  for (const key of [
    "termInst",
    "posInst",
    "mposInst",
    "quickInst",
    "ogInst",
    "quickSales",
    "amex375",
    "amex299",
    "amex249",
  ])
    p[key] = quantity(p[key] ?? 0, key);
  const hitRate = number(p.hitRate ?? 100, "Target hit rate");
  if (hitRate > 100)
    throw new RangeError("Target hit rate cannot exceed 100%.");
  const posPer = lookupMatrix(p.posRate ?? 0.89, p.posTpv ?? 48000, "pos");
  const termPer = lookupMatrix(
    p.termRate ?? 0.49,
    p.termTpv ?? 48000,
    "terminal",
  );
  const mposPer = lookupMatrix(p.mposRate ?? 0.89, p.mposTpv ?? 48000, "mpos");
  const { posInst, termInst, mposInst } = p;
  const posMatrix = posInst * posPer,
    termMatrix = termInst * termPer,
    mposMatrix = mposInst * mposPer;
  const matrix = posMatrix + termMatrix + mposMatrix;
  const upfront = posInst * upfrontBonus(p.upfront ?? 0, "pos"),
    mposUp = mposInst * upfrontBonus(p.mposUpfront ?? 0, "mpos");
  const posVol = posVolumeBonus(posInst),
    ogCount = p.ogInst,
    og = ogCount * 50;
  const quickInstallCount = p.quickInst,
    quickInstall = quickInstallCount * 50,
    quickSale = p.quickSales * 30;
  const amex375 = p.amex375 * 40,
    amex299 = p.amex299 * 20,
    amex249 = p.amex249 * 10,
    amex = amex375 + amex299 + amex249;
  const headline =
    matrix + upfront + mposUp + posVol + og + quickInstall + quickSale + amex;
  const matrixRealised = matrix * 0.5 + (matrix * 0.5 * hitRate) / 100;
  const realisedRaw =
    matrixRealised +
    upfront +
    mposUp +
    posVol +
    og +
    quickInstall +
    quickSale +
    amex;
  const realised = Math.max(realisedRaw, 2120),
    guaranteeActive = realisedRaw < 2120,
    guaranteeTopup = Math.max(0, 2120 - realisedRaw);
  return {
    posInst,
    termInst,
    mposInst,
    posPer,
    termPer,
    mposPer,
    posMatrix,
    termMatrix,
    mposMatrix,
    matrix,
    upfront,
    mposUp,
    posVol,
    og,
    ogCount,
    quickInstall,
    quickInstallCount,
    quickSale,
    amex375,
    amex299,
    amex249,
    amex,
    headline,
    realised,
    realisedRaw,
    guaranteeActive,
    guaranteeTopup,
  };
}
/** Per-merchant projection. Hardware quantities never multiply a merchant's matrix or add-on bonuses. */
export function calculateOfferCommission(options) {
  const { product = "terminal" } = options;
  const rate = number(options.rate, "Flatpay rate"),
    annualTpv = number(options.annualTpv, "Annual TPV");
  const floorMet = rate / 100 >= productFloor(product);
  const matrix = lookupMatrix(rate, annualTpv, product);
  const upfront =
    product === "terminal"
      ? 0
      : options.upfront === null ||
          options.upfront === undefined ||
          options.upfront === ""
        ? null
        : upfrontBonus(options.upfront, product);
  const og = options.ownGenerated === true ? 50 : 0,
    quickInstall = options.quickInstallation === true ? 50 : 0;
  const quickSale = options.ihQuickSale === true ? 30 : 0,
    amex = amexRateBonus(options.amexRate);
  const headline =
    upfront === null
      ? null
      : matrix + upfront + og + quickInstall + quickSale + amex;
  const notes = [
    "Projection uses one installed merchant deal; it excludes the monthly POS volume ladder and minimum guarantee.",
    "Projected bonuses require the documented eligibility conditions. Confirmed commission remains separate.",
  ];
  if (!floorMet)
    notes.push(
      "Rate is below the hard floor: the calculator returns zero matrix but retains add-ons; written Rules say no commission. Manager confirmation is required.",
    );
  if (annualTpv > 500000)
    notes.push(
      "Executable calculator caps annual TPV at £500,000; the printed matrix extends further. Confirm this estimate with a manager.",
    );
  if (upfront === null)
    notes.push(
      "Enter the POS/MPOS upfront amount to calculate the complete projection.",
    );
  if (options.ownGenerated && options.ihQuickSale)
    notes.push(
      "OG and IH quick-sale bonuses should not apply to the same merchant; verify the lead source.",
    );
  const breakdown = [
    { id: "matrix", label: "Matrix commission", amount: matrix },
    { id: "upfront", label: "Upfront bonus / penalty", amount: upfront },
    { id: "og", label: "Own-generated sale", amount: og },
    { id: "quickInstall", label: "Quick installation", amount: quickInstall },
    { id: "quickSale", label: "IH quick sale", amount: quickSale },
    { id: "amex", label: "Amex rate bonus", amount: amex },
  ];
  return {
    matrix,
    upfront,
    og,
    quickInstall,
    quickSale,
    amex,
    headline,
    floorMet,
    activationThreshold: pounds(annualTpv * 0.005),
    tpvTarget: pounds(annualTpv / 12),
    breakdown,
    notes,
    source: COMMISSION_SOURCE,
  };
}
export const officialMatrix = lookupMatrix;
export const officialUpfront = upfrontBonus;
export const officialAmexBonus = amexRateBonus;
export const calculateScenario = calculatePortfolioCommission;
