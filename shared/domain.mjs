/** Pure calculations shared by the tracker UI and server. Percentages use 1.5 for 1.5%. */
import { validateStatementAnalysis } from "./merchant-statement.mjs";
const finite = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value));
const amount = (value) => (finite(value) ? Number(value) : 0);
const blank = (value) => value === "" || value === null || value === undefined;
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function effectiveRate(totalCharges, totalTransactionValue) {
  const charges = amount(totalCharges);
  const volume = amount(totalTransactionValue);
  return volume > 0 && charges >= 0 ? (charges / volume) * 100 : 0;
}

/** Card types may overlap: an international business Amex belongs to all three. */
export function cardShare(cardValue, totalValue) {
  const volume = amount(totalValue);
  return volume > 0 ? (amount(cardValue) / volume) * 100 : 0;
}

export function offerSummary(deal, offer) {
  if (!offer || !finite(offer.rate)) {
    return { proposedCharges: null, monthlySavings: null, annualSavings: null };
  }
  const volume = amount(deal.monthlyVolume);
  const amex = amount(deal.amexVolume);
  // An unquoted Amex rate must never silently become a free processing rate.
  if (amex > 0 && !finite(offer.amexRate)) {
    return { proposedCharges: null, monthlySavings: null, annualSavings: null };
  }
  const proposedCharges = money(
    (Math.max(0, volume - amex) * amount(offer.rate) +
      amex * amount(offer.amexRate)) /
      100,
  );
  const monthlySavings = money(amount(deal.currentCharges) - proposedCharges);
  return {
    proposedCharges,
    monthlySavings,
    annualSavings: money(monthlySavings * 12),
  };
}

export function calculateMerchant(deal) {
  const offers = Array.isArray(deal.offers) ? deal.offers : [];
  const chosen =
    offers.find(
      (offer) => offer.id === (deal.acceptedOfferId || deal.selectedOfferId),
    ) || offers.at(-1);
  return {
    currentRate: effectiveRate(deal.currentCharges, deal.monthlyVolume),
    businessShare: cardShare(deal.businessVolume, deal.monthlyVolume),
    internationalShare: cardShare(deal.internationalVolume, deal.monthlyVolume),
    amexShare: cardShare(deal.amexVolume, deal.monthlyVolume),
    currentAmexCharges: money(
      (amount(deal.amexVolume) * amount(deal.amexRate)) / 100,
    ),
    ...offerSummary(deal, chosen),
  };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function isWon(deal) {
  return String(deal.status).toLowerCase() === "won";
}

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validateText(errors, value, label, max = 300) {
  if (!blank(value) && (typeof value !== "string" || value.length > max))
    errors.push(
      `${label} must be text of at most ${max.toLocaleString("en-GB")} characters.`,
    );
}

function validateNumber(errors, value, label, max = Infinity) {
  if (
    !blank(value) &&
    (!finite(value) || Number(value) < 0 || Number(value) > max)
  )
    errors.push(
      `${label} must be a non-negative number${max !== Infinity ? ` no greater than ${max}` : ""}.`,
    );
}

function validateOptionalDate(errors, value, label) {
  if (!blank(value) && !validDate(value))
    errors.push(`${label} must be a valid date.`);
}

function validateLink(errors, value, label) {
  if (blank(value)) return;
  try {
    if (typeof value !== "string" || value.length > 2000)
      throw new Error("Invalid link");
    const parsed = new URL(value);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid link");
  } catch {
    errors.push(
      `${label} must be a valid HTTP or HTTPS URL of at most 2,000 characters.`,
    );
  }
}

function validateMeetingNotes(errors, notes) {
  if (blank(notes)) return;
  if (!Array.isArray(notes)) {
    errors.push("Meeting notes must be a list.");
    return;
  }
  if (notes.length > 200)
    errors.push("A merchant can have at most 200 meeting notes.");
  const ids = new Set();
  for (const [index, note] of notes.entries()) {
    const label = `Meeting note ${index + 1}`;
    if (!record(note)) {
      errors.push(`${label} must be an object.`);
      continue;
    }
    if (typeof note.id !== "string" || !note.id.trim() || note.id.length > 300)
      errors.push(`${label} must have a valid ID.`);
    if (ids.has(note.id)) errors.push("Meeting note IDs must be unique.");
    ids.add(note.id);
    validateText(errors, note.title, `${label} title`);
    validateText(errors, note.body, `${label} body`, 20000);
    validateOptionalDate(errors, note.date, `${label} date`);
    validateOptionalDate(errors, note.nextFollowUp, `${label} follow-up date`);
    if (Array.isArray(note.actions)) {
      if (note.actions.length > 100)
        errors.push(`${label} can have at most 100 actions.`);
      note.actions.forEach((action) =>
        validateText(errors, action, `${label} action`, 2000),
      );
    } else validateText(errors, note.actions, `${label} actions`, 10000);
  }
}

function validateBundleBusinesses(errors, businesses, label, bundled) {
  if (businesses === undefined && !bundled) return;
  if (!Array.isArray(businesses)) {
    errors.push(`${label} businesses must be a list.`);
    return;
  }
  if (businesses.length > 50)
    errors.push(`${label} can include at most 50 businesses.`);
  if (bundled && businesses.length < 2)
    errors.push(
      `${label} bundle needs at least two businesses, including the primary business.`,
    );
  const ids = new Set();
  for (const [index, business] of businesses.entries()) {
    const rowLabel = `${label} business ${index + 1}`;
    if (!record(business)) {
      errors.push(`${rowLabel} must be an object.`);
      continue;
    }
    if (
      typeof business.id !== "string" ||
      !business.id.trim() ||
      business.id.length > 300
    )
      errors.push(`${rowLabel} must have a valid ID.`);
    if (ids.has(business.id))
      errors.push(`${label} business IDs must be unique.`);
    ids.add(business.id);
    validateText(errors, business.name, `${rowLabel} name`);
    validateText(errors, business.provider, `${rowLabel} current provider`);
    if (bundled && (typeof business.name !== "string" || !business.name.trim()))
      errors.push(`${rowLabel} name is required.`);
    validateNumber(errors, business.annualTpv, `${rowLabel} annual TPV`);
    for (const key of [
      "currentRate",
      "offeredRate",
      "businessSurcharge",
      "internationalSurcharge",
      "surchargeShare",
      "businessShare",
      "internationalShare",
    ])
      validateNumber(errors, business[key], `${rowLabel} ${key}`, 100);
  }
}

/** Return actionable validation messages; never mutate a deal or coerce invalid data. */
export function validateDeal(deal) {
  const errors = [];
  if (!record(deal)) return ["A merchant record is required."];
  if (typeof deal.businessName !== "string" || !deal.businessName.trim())
    errors.push("Business name is required.");
  for (const key of [
    "businessName",
    "contactName",
    "email",
    "phone",
    "provider",
  ]) {
    validateText(errors, deal[key], key);
  }
  validateText(errors, deal.notes, "Notes", 10000);
  if (!blank(deal.statementAnalysis))
    errors.push(...validateStatementAnalysis(deal.statementAnalysis));
  if (
    !blank(deal.email) &&
    (typeof deal.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deal.email))
  )
    errors.push("Enter a valid contact email address.");
  if (
    !blank(deal.status) &&
    ![
      "lead",
      "meeting booked",
      "proposal sent",
      "negotiation",
      "won",
      "lost",
    ].includes(String(deal.status).toLowerCase())
  )
    errors.push("Choose a valid sales status.");
  const fields = {
    monthlyVolume: "Monthly transaction value",
    currentCharges: "Current charges",
    businessVolume: "Business card value",
    internationalVolume: "International card value",
    amexVolume: "Amex value",
    amexRate: "Current Amex rate",
    commissionAmount: "Commission amount",
  };
  for (const [key, label] of Object.entries(fields)) {
    validateNumber(errors, deal[key], label);
  }
  for (const key of ["businessVolume", "internationalVolume", "amexVolume"]) {
    if (amount(deal[key]) > amount(deal.monthlyVolume))
      errors.push(`${fields[key]} cannot exceed monthly transaction value.`);
  }
  if (amount(deal.amexRate) > 100)
    errors.push("Current Amex rate cannot exceed 100%.");
  validateOptionalDate(errors, deal.meetingDate, "Meeting date");
  validateOptionalDate(errors, deal.saleDate, "Sale date");
  if (isWon(deal) && !validDate(deal.saleDate))
    errors.push("A valid sale date is required for a won sale.");
  if (
    deal.commissionConfirmed !== undefined &&
    typeof deal.commissionConfirmed !== "boolean"
  )
    errors.push("Commission confirmation must be true or false.");
  if (deal.commissionConfirmed && !finite(deal.commissionAmount))
    errors.push("Enter the confirmed commission amount.");
  if (!blank(deal.commissionDetails)) {
    if (!record(deal.commissionDetails))
      errors.push("Commission details must be an object.");
    else {
      const details = deal.commissionDetails;
      for (const key of [
        "baseAmount",
        "ogBonus",
        "standBonus",
        "quickInstallBonus",
        "posUpfrontPaid",
        "transactedSinceInstall",
        "rolling30DayTpv",
        "signedMonthlyTpv",
        "annualTpv",
        "upfrontAmount",
        "amexFirstActiveMonthTpv",
        "firstThreeMonthsTpv",
        "paidCommissionToDate",
        "amexBonusPaid",
      ]) {
        validateNumber(errors, details[key], `Commission ${key}`);
      }
      for (const key of [
        "installedDate",
        "activationDate",
        "tpvThresholdDate",
        "upfrontPaidDate",
        "amexQualificationDate",
        "quickSaleDate",
        "cancellationDate",
        "churnDate",
        "amexRateReducedDate",
      ])
        validateOptionalDate(errors, details[key], `Commission ${key}`);
      if (
        validDate(details.installedDate) &&
        validDate(details.tpvThresholdDate) &&
        details.tpvThresholdDate < details.installedDate
      )
        errors.push(
          "TPV target reached date cannot precede installation qualification.",
        );
      if (
        details.paidInFull !== undefined &&
        typeof details.paidInFull !== "boolean"
      )
        errors.push("POS payment received in full must be true or false.");
      for (const key of [
        "ownGenerated",
        "quickInstall",
        "ihQuickSale",
        "seasonal",
      ]) {
        if (details[key] !== undefined && typeof details[key] !== "boolean")
          errors.push(`Commission ${key} must be true or false.`);
      }
      if (
        !blank(details.model) &&
        !["terminal", "pos", "mpos"].includes(details.model)
      )
        errors.push("Commission model must be terminal, pos, or mpos.");
      if (
        validDate(details.installedDate) &&
        validDate(details.activationDate) &&
        details.activationDate < details.installedDate
      )
        errors.push("Activation date cannot precede physical installation.");
    }
  }
  if (!blank(deal.saleInfo)) {
    if (!record(deal.saleInfo)) errors.push("Sale details must be an object.");
    else {
      const info = deal.saleInfo;
      for (const key of ["expectedMonthlyTpv", "maxTransactionAmount"])
        validateNumber(errors, info[key], `Sale ${key}`);
      validateNumber(errors, info.surchargeShare, "Surcharge share", 100);
      for (const key of ["signatureDate", "installationDate"])
        validateOptionalDate(errors, info[key], `Sale ${key}`);
      for (const key of [
        "companyNumber",
        "registeredName",
        "industry",
        "salesManager",
        "signatoryName",
      ])
        validateText(errors, info[key], `Sale ${key}`);
      for (const key of [
        "registeredAddress",
        "installationAddress",
        "signatoryAddress",
      ])
        validateText(errors, info[key], `Sale ${key}`, 2000);
      validateLink(errors, info.crmLink, "CRM link");
    }
  }
  if (!blank(deal.checklist)) {
    if (!record(deal.checklist))
      errors.push("Sale checklist must be an object.");
    else if (
      Object.values(deal.checklist).some((value) => typeof value !== "boolean")
    )
      errors.push("Sale checklist items must be true or false.");
  }
  validateMeetingNotes(errors, deal.meetingNotes);
  if (!blank(deal.offerSheet)) {
    if (!record(deal.offerSheet)) errors.push("Offer sheet must be an object.");
    else {
      const sheet = deal.offerSheet;
      validateText(errors, sheet.offerId, "Offer sheet offer ID");
      validateOptionalDate(errors, sheet.validUntil, "Offer validity date");
      validateText(errors, sheet.preparedBy, "Offer prepared by");
      validateText(errors, sheet.contactDetails, "Offer contact details", 2000);
      validateText(errors, sheet.message, "Offer message", 10000);
      validateText(errors, sheet.terms, "Offer terms", 10000);
    }
  }
  if (!blank(deal.closingDeal)) {
    if (!record(deal.closingDeal))
      errors.push("Closing deal must be an object.");
    else {
      const closing = deal.closingDeal;
      for (const key of ["rate", "businessSurcharge", "internationalSurcharge"])
        validateNumber(errors, closing[key], `Closing deal ${key}`, 100);
      validateOptionalDate(
        errors,
        closing.validUntil,
        "Closing deal validity date",
      );
      for (const key of ["manager", "approvalReference", "offerId"])
        validateText(errors, closing[key], `Closing deal ${key}`, 2000);
      for (const key of ["reason", "incentive"])
        validateText(errors, closing[key], `Closing deal ${key}`, 10000);
      if (
        closing.approved !== undefined &&
        typeof closing.approved !== "boolean"
      )
        errors.push("Closing deal approval must be true or false.");
    }
  }
  if (deal.offers !== undefined && !Array.isArray(deal.offers))
    errors.push("Offers must be a list.");
  const ids = new Set();
  for (const [index, offer] of (Array.isArray(deal.offers)
    ? deal.offers
    : []
  ).entries()) {
    const label = `Offer ${index + 1}`;
    if (!record(offer)) {
      errors.push(`${label} is invalid.`);
      continue;
    }
    if (
      typeof offer.id !== "string" ||
      !offer.id.trim() ||
      offer.id.length > 300
    )
      errors.push(`${label} must have a valid ID of at most 300 characters.`);
    if (offer.id && ids.has(offer.id)) errors.push("Offer IDs must be unique.");
    if (typeof offer.id === "string" && offer.id.trim()) ids.add(offer.id);
    validateOptionalDate(errors, offer.date, `${label} date`);
    validateNumber(errors, offer.annualTpv, `${label} annual TPV`);
    for (const key of [
      "currentRate",
      "businessSurcharge",
      "internationalSurcharge",
      "surchargeShare",
      "businessShare",
      "internationalShare",
    ])
      validateNumber(errors, offer[key], `${label} ${key}`, 100);
    if (offer.bundle !== undefined && typeof offer.bundle !== "boolean")
      errors.push(`${label} bundle must be true or false.`);
    validateBundleBusinesses(
      errors,
      offer.businesses,
      label,
      offer.bundle === true,
    );
    validateText(errors, offer.manager, `${label} manager`);
    validateText(errors, offer.notes, `${label} notes`, 10000);
    validateText(
      errors,
      offer.additionalHardware,
      `${label} additional hardware`,
      2000,
    );
    for (const key of ["rate", "amexRate"]) {
      if (
        !blank(offer[key]) &&
        (!finite(offer[key]) ||
          Number(offer[key]) < 0 ||
          Number(offer[key]) > 100)
      )
        errors.push(
          `${label} ${key === "rate" ? "Flatpay" : "Amex"} rate must be between 0 and 100%.`,
        );
    }
    if (!blank(offer.hardware) && !record(offer.hardware))
      errors.push(`${label} hardware must be an object.`);
    const hardware = record(offer.hardware) ? offer.hardware : {};
    for (const [key, name] of Object.entries({
      terminal: "terminal",
      posPremium: "POS Premium",
      posPro: "POS Pro",
      mpos: "mPOS",
    })) {
      if (
        !blank(hardware[key]) &&
        (!finite(hardware[key]) ||
          !Number.isInteger(Number(hardware[key])) ||
          Number(hardware[key]) < 0)
      )
        errors.push(
          `${label} ${name} quantity must be a non-negative whole number.`,
        );
    }
    validateLink(errors, offer.acLink, `${label} AC link`);
    validateLink(errors, offer.link, `${label} link`);
  }
  if (deal.offerSheet?.offerId && !ids.has(deal.offerSheet.offerId))
    errors.push(
      "The offer sheet must reference an offer belonging to this merchant.",
    );
  if (deal.closingDeal?.offerId && !ids.has(deal.closingDeal.offerId))
    errors.push(
      "The closing deal must reference an offer belonging to this merchant.",
    );
  if (deal.acceptedOfferId && !ids.has(deal.acceptedOfferId))
    errors.push("The accepted offer must belong to this merchant.");
  if (deal.selectedOfferId && !ids.has(deal.selectedOfferId))
    errors.push("The selected offer must belong to this merchant.");
  return errors;
}

/** Only confirmed manual figures count as commission until verified rules are configured. */
export function monthlySummary(deals, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Choose a month in YYYY-MM format.");
  const won = deals.filter(
    (deal) =>
      isWon(deal) &&
      validDate(deal.saleDate) &&
      deal.saleDate.startsWith(`${month}-`),
  );
  const confirmed = won.filter(
    (deal) =>
      deal.commissionConfirmed === true &&
      finite(deal.commissionAmount) &&
      amount(deal.commissionAmount) >= 0,
  );
  return {
    wonCount: won.length,
    monthlyVolume: won.reduce(
      (sum, deal) => sum + amount(deal.monthlyVolume),
      0,
    ),
    confirmedCommission: money(
      confirmed.reduce((sum, deal) => sum + amount(deal.commissionAmount), 0),
    ),
    pendingCommissionCount: won.length - confirmed.length,
  };
}
