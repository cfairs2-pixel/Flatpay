import {
  calculateOfferCommission,
  COMMISSION_SOURCE,
} from "./official-commission.mjs";

const blank = (value) => value === "" || value === null || value === undefined;
const number = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};
const addMonths = (value, months) => {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
};
const followingMonth = (date) =>
  validDate(date) ? addMonths(`${date.slice(0, 7)}-01`, 1).slice(0, 7) : null;
const knownSum = (values) =>
  values.some((value) => value === null)
    ? null
    : money(values.reduce((sum, value) => sum + value, 0));

/**
 * Event-based estimate using the current official Rules, separate from payroll confirmation.
 * installedDate is physical installation; activationDate records crossing the activation TPV.
 * Reversals are returned separately and are never silently deducted from confirmed commission.
 */
export function estimateCurrentCommission(
  deal = {},
  { asOfDate = new Date().toISOString().slice(0, 10) } = {},
) {
  if (!validDate(asOfDate))
    throw new RangeError("asOfDate must be a valid YYYY-MM-DD date.");
  const details =
    deal.commissionDetails && typeof deal.commissionDetails === "object"
      ? deal.commissionDetails
      : {};
  const notes = [
    "Estimate follows the official draft calculator and current Rules; it does not confirm payroll or change manually confirmed commission.",
    "This merchant estimate excludes the monthly POS installation ladder and £2,120 portfolio minimum guarantee.",
  ];
  const missingInputs = [];
  const missing = (key) => {
    if (!missingInputs.includes(key)) missingInputs.push(key);
  };
  const model = ["terminal", "pos", "mpos"].includes(details.model)
    ? details.model
    : null;
  if (!model) missing("model");
  let annualTpv;
  if (!blank(details.annualTpv)) annualTpv = number(details.annualTpv);
  else if (number(deal.saleInfo?.expectedMonthlyTpv) > 0) {
    annualTpv = number(deal.saleInfo.expectedMonthlyTpv) * 12;
    notes.push(
      "Annual TPV uses the contracted monthly TPV × 12; verify this against the signed annual declaration.",
    );
  } else {
    annualTpv =
      number(deal.monthlyVolume) === null
        ? null
        : number(deal.monthlyVolume) * 12;
    if (annualTpv > 0)
      notes.push(
        "Annual TPV uses the merchant monthly transaction value × 12; verify the signed declaration before relying on commission.",
      );
  }
  if (!(annualTpv > 0) || !Number.isFinite(annualTpv)) {
    annualTpv = null;
    missing("annualTpv");
  }
  const offers = Array.isArray(deal.offers) ? deal.offers : [];
  const selected =
    offers.find(
      (offer) => offer?.id === (deal.acceptedOfferId || deal.selectedOfferId),
    ) || offers.at(-1);
  const rate = number(selected?.rate);
  if (rate === null || rate > 100) missing("offerRate");
  const upfront = number(
    !blank(details.upfrontAmount)
      ? details.upfrontAmount
      : details.posUpfrontPaid,
  );
  if (blank(details.upfrontAmount) && !blank(details.posUpfrontPaid))
    notes.push(
      "Upfront amount uses the previously saved POS upfront value; confirm it is the full invoiced amount.",
    );
  if (model && model !== "terminal" && upfront === null)
    missing("upfrontAmount");
  const initial = {
    total: null,
    eligibleNow: null,
    pendingAmount: null,
    complete: false,
    activationThreshold: annualTpv === null ? null : money(annualTpv * 0.005),
    activationMet: false,
    tpvTarget: annualTpv === null ? null : money(annualTpv / 12),
    tpvTargetMet: false,
    breakdown: [],
    missingInputs,
    notes,
    source: COMMISSION_SOURCE,
    churnRisk: false,
    churnReasons: [],
    clawback: 0,
    clawbackMonth: null,
    expectedPayMonth: null,
    payMonths: [],
  };
  if (!model || annualTpv === null || rate === null || rate > 100)
    return initial;
  const amexRate = number(selected?.amexRate);
  const projection = calculateOfferCommission({
    product: model,
    rate,
    annualTpv,
    upfront,
    ownGenerated: details.ownGenerated === true,
    quickInstallation: details.quickInstall === true,
    ihQuickSale: details.ihQuickSale === true,
    amexRate: amexRate !== null && amexRate <= 100 ? amexRate : "",
  });
  notes.push(...projection.notes);
  if (amexRate === null)
    notes.push(
      "No AMEX bonus is included without a quoted qualifying AMEX rate.",
    );
  const byNow = (date) => validDate(date) && date <= asOfDate;
  const installed = byNow(details.installedDate);
  const legacy = installed && details.installedDate < "2026-07-01";
  if (legacy) {
    missing("legacyActivationRule");
    notes.push(
      "This installation predates 1 July 2026. Merchants already qualified under the old £123 activation rule may retain it; confirm the historical qualification with a manager. Current-rule eligibility is not released automatically.",
    );
  }
  const activationDatePresent = !blank(details.activationDate);
  const activationDateValid =
    byNow(details.activationDate) &&
    installed &&
    details.activationDate >= details.installedDate;
  const volumeActivated =
    installed &&
    (number(details.transactedSinceInstall) ?? -1) >=
      projection.activationThreshold;
  const activationMet =
    volumeActivated &&
    !legacy &&
    (!activationDatePresent || activationDateValid);
  const activationDate = activationDateValid ? details.activationDate : null;
  if (activationMet && !activationDate) {
    missing("activationDate");
    notes.push(
      "The activation volume is recorded. Enter the date it crossed 0.5% of declared annual TPV to determine the first-half payout month.",
    );
  }
  if (activationDatePresent && !activationDateValid)
    notes.push(
      "Activation date must be on or after installation and no later than the estimate date.",
    );
  const targetVolumeMet =
    activationMet &&
    (number(details.rolling30DayTpv) ?? -1) >= projection.tpvTarget;
  const deadline = installed ? addMonths(details.installedDate, 6) : null;
  const thresholdDateValid =
    byNow(details.tpvThresholdDate) &&
    installed &&
    details.tpvThresholdDate >= details.installedDate &&
    (!activationDate || details.tpvThresholdDate >= activationDate) &&
    details.tpvThresholdDate <= deadline;
  const tpvTargetMet = targetVolumeMet && thresholdDateValid;
  const thresholdUnknown = targetVolumeMet && blank(details.tpvThresholdDate);
  if (thresholdUnknown) {
    missing("tpvThresholdDate");
    notes.push(
      "Record when the rolling 30-day TPV target was reached; the second half only qualifies within six months of physical installation.",
    );
  }
  if (!blank(details.tpvThresholdDate) && !thresholdDateValid)
    notes.push(
      "The TPV target date must fall between installation and six months after it, and cannot be in the future.",
    );

  const churnReasons = [];
  const cancellationChurn =
    installed &&
    byNow(details.cancellationDate) &&
    details.cancellationDate >= details.installedDate &&
    details.cancellationDate <= deadline;
  if (cancellationChurn)
    churnReasons.push("Cancellation within six months of installation.");
  const firstThree = number(details.firstThreeMonthsTpv);
  const threeMonthEnd = installed ? addMonths(details.installedDate, 3) : null;
  const lowUsageChurn =
    installed &&
    threeMonthEnd <= asOfDate &&
    firstThree !== null &&
    details.seasonal !== true &&
    firstThree < (annualTpv / 4) * 0.15;
  if (lowUsageChurn)
    churnReasons.push(
      "First-three-month TPV is below 15% of expected three-month volume; no seasonal exemption is recorded.",
    );
  const churnRisk = churnReasons.length > 0;
  const amexReversed = byNow(details.amexRateReducedDate);
  const paid = number(details.paidCommissionToDate);
  const paidAmex = number(details.amexBonusPaid);
  let clawback = 0,
    clawbackMonth = null;
  if (churnRisk) {
    clawback = paid;
    const churnDate =
      byNow(details.churnDate) && details.churnDate >= details.installedDate
        ? details.churnDate
        : cancellationChurn
          ? details.cancellationDate
          : null;
    clawbackMonth = churnDate?.slice(0, 7) || null;
    notes.push(
      "The recorded facts meet a written churn condition. Unpaid components are held; confirm the registered churn and reversal with payroll.",
    );
    if (paid === null) {
      missing("paidCommissionToDate");
      notes.push(
        "Paid commission is unknown, so the clawback amount remains unknown; no deduction has been invented.",
      );
    }
    if (!clawbackMonth) {
      missing("churnDate");
      notes.push(
        "Record the registered churn date to identify the reversal month.",
      );
    }
  } else if (amexReversed) {
    clawback = paidAmex;
    clawbackMonth = details.amexRateReducedDate.slice(0, 7);
    notes.push(
      "The AMEX rate was reduced or removed; the already-paid AMEX bonus is reversible. Other components are unaffected by this event.",
    );
    if (paidAmex === null) {
      missing("amexBonusPaid");
      notes.push(
        "The paid AMEX bonus is unknown, so its reversal amount remains unknown.",
      );
    }
  }
  // Dates cannot substitute for event evidence, and event evidence cannot invent dates.
  const combinedDate = (eventDate) =>
    activationDate && byNow(eventDate)
      ? [activationDate, eventDate].sort().at(-1)
      : null;
  const component = (id, label, total, qualified, earnedDate) => {
    const held = churnRisk || (id === "amex" && amexReversed);
    let eligible = held ? 0 : qualified === null ? null : qualified ? total : 0;
    if (
      (!projection.floorMet ||
        (legacy && ["baseFirst", "baseSecond"].includes(id))) &&
      !held &&
      total !== 0
    )
      eligible = null;
    return {
      id,
      label,
      total,
      eligible,
      payMonth:
        eligible !== null && eligible !== 0 && earnedDate
          ? followingMonth(earnedDate)
          : null,
    };
  };
  const first = money(projection.matrix / 2),
    second = money(projection.matrix - first);
  const upfrontPaymentKnown =
    details.paidInFull === true &&
    (blank(details.upfrontPaidDate) || byNow(details.upfrontPaidDate));
  const amexUsage = (number(details.amexFirstActiveMonthTpv) ?? -1) >= 123;
  const amexDateAllowed =
    blank(details.amexQualificationDate) ||
    byNow(details.amexQualificationDate);
  const quickSaleDateAllowed =
    blank(details.quickSaleDate) || byNow(details.quickSaleDate);
  const breakdown = [
    component(
      "baseFirst",
      "Matrix commission · first 50%",
      first,
      activationMet,
      activationDate,
    ),
    component(
      "baseSecond",
      "Matrix commission · remaining 50%",
      second,
      thresholdUnknown ? null : tpvTargetMet,
      tpvTargetMet ? combinedDate(details.tpvThresholdDate) : null,
    ),
    component(
      "upfront",
      model === "mpos"
        ? "MPOS upfront bonus / penalty"
        : model === "pos"
          ? "POS upfront bonus / penalty"
          : "Terminal upfront · not applicable",
      projection.upfront,
      upfrontPaymentKnown,
      byNow(details.upfrontPaidDate) ? details.upfrontPaidDate : null,
    ),
    component(
      "og",
      "Own-generated installation",
      projection.og,
      installed,
      installed ? details.installedDate : null,
    ),
    component(
      "quickInstall",
      "Quick installation · confirmed within five days",
      projection.quickInstall,
      installed,
      installed ? details.installedDate : null,
    ),
    component(
      "quickSale",
      "IH quick sale · confirmed within 24 hours",
      projection.quickSale,
      quickSaleDateAllowed,
      byNow(details.quickSaleDate) ? details.quickSaleDate : null,
    ),
    component(
      "amex",
      "AMEX rate bonus · first active month usage",
      projection.amex,
      amexUsage && amexDateAllowed,
      byNow(details.amexQualificationDate)
        ? details.amexQualificationDate
        : null,
    ),
  ];
  if (!projection.floorMet) {
    missing("rateFloorReview");
    notes.push(
      "No below-floor eligibility is released automatically because the written Rules and executable calculator disagree on add-ons.",
    );
  }
  if (details.ownGenerated === true && details.ihQuickSale === true) {
    missing("leadSource");
    for (const row of breakdown.filter((row) =>
      ["og", "quickSale"].includes(row.id),
    )) {
      row.eligible = churnRisk ? 0 : null;
      row.payMonth = null;
    }
    notes.push(
      "Choose either own-generated or IH quick-sale lead source; both bonuses cannot be confirmed for the same merchant.",
    );
  }
  if (churnRisk || amexReversed) {
    breakdown.push({
      id: "clawback",
      label: churnRisk
        ? "Churn · recorded paid commission reversal"
        : "AMEX · recorded paid bonus reversal",
      total: clawback === null ? null : -clawback,
      eligible: clawback === null ? null : -clawback,
      payMonth: clawback !== null && clawback > 0 ? clawbackMonth : null,
    });
    notes.push(
      "The total shows the original deal projection. The recorded reversal is a separate negative payout row; previously paid amounts are never deducted twice.",
    );
  }
  const eligibilityUnknown = !projection.floorMet || legacy;
  const eligibleNow =
    eligibilityUnknown && !churnRisk
      ? null
      : knownSum(breakdown.map((row) => row.eligible));
  const total = projection.headline;
  const earned = breakdown.filter(
    (row) => row.eligible !== null && row.eligible !== 0,
  );
  const payMonths = [
    ...new Set(earned.map((row) => row.payMonth).filter(Boolean)),
  ].sort();
  if (earned.some((row) => !row.payMonth))
    notes.push(
      "Some eligible components lack an earning date; their payout month remains unconfirmed.",
    );
  notes.push(
    "Only matrix commission depends on activation and the 30-day target. Upfront, AMEX and IH quick-sale use their separate documented triggers; OG and quick-install bonuses use the recorded installation date.",
  );
  return {
    total,
    eligibleNow,
    pendingAmount:
      total === null || eligibleNow === null || churnRisk || amexReversed
        ? null
        : money(total - eligibleNow),
    complete:
      total !== null && missingInputs.length === 0 && !eligibilityUnknown,
    activationThreshold: projection.activationThreshold,
    activationMet,
    tpvTarget: projection.tpvTarget,
    tpvTargetMet,
    breakdown,
    missingInputs,
    notes,
    source: COMMISSION_SOURCE,
    annualTpv,
    model,
    churnRisk,
    churnReasons,
    clawback,
    clawbackMonth,
    payMonths,
    expectedPayMonth:
      earned.length &&
      earned.every((row) => row.payMonth) &&
      payMonths.length === 1
        ? payMonths[0]
        : null,
  };
}
