/** AC pricing helpers. A percentage is stored as 1.5 for 1.5%. */
const number = (value) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null;
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Includes each business exactly once. Card shares are never added together. */
export function summarizeBundle(businesses = []) {
  const rows = Array.isArray(businesses) ? businesses : [];
  const annualTpv = rows.reduce(
    (sum, row) => sum + (number(row?.annualTpv) ?? 0),
    0,
  );
  const tpvComplete =
    rows.length > 0 && rows.every((row) => number(row?.annualTpv) !== null);
  const ratesComplete =
    tpvComplete &&
    rows.every(
      (row) =>
        number(row?.currentRate) !== null && number(row?.offeredRate) !== null,
    );
  const weighted = (key) =>
    annualTpv > 0 &&
    tpvComplete &&
    rows.every((row) => number(row?.[key]) !== null)
      ? rows.reduce(
          (sum, row) => sum + Number(row.annualTpv) * Number(row[key]),
          0,
        ) / annualTpv
      : null;
  const weightedCurrentRate = weighted("currentRate");
  const weightedOfferedRate = weighted("offeredRate");
  return {
    count: rows.length,
    annualTpv: round(annualTpv),
    tpvComplete,
    ratesComplete,
    weightedCurrentRate,
    weightedOfferedRate,
    // Base-rate comparison only: surcharges, Amex, hardware and fees are excluded.
    annualBaseSavings: ratesComplete
      ? round(
          rows.reduce(
            (sum, row) =>
              sum +
              (Number(row.annualTpv) *
                (Number(row.currentRate) - Number(row.offeredRate))) /
                100,
            0,
          ),
        )
      : null,
  };
}

/** Plain data for a printable offer; no mutation and no implicit commission count. */
export function buildOfferSnapshot(deal, offer) {
  if (!offer) return null;
  const businesses = offer.bundle
    ? (Array.isArray(offer.businesses) ? offer.businesses : []).map((row) => ({
        ...row,
      }))
    : [
        {
          id: deal.id || "primary",
          name: deal.businessName,
          provider: deal.provider || "",
          annualTpv: offer.annualTpv ?? "",
          currentRate: offer.currentRate ?? "",
          offeredRate: offer.rate ?? "",
          businessSurcharge: offer.businessSurcharge ?? "",
          internationalSurcharge: offer.internationalSurcharge ?? "",
          surchargeShare: offer.surchargeShare ?? "",
          businessShare: offer.businessShare ?? "",
          internationalShare: offer.internationalShare ?? "",
        },
      ];
  return {
    offerId: offer.id,
    date: offer.date || "",
    bundle: Boolean(offer.bundle),
    businesses,
    summary: summarizeBundle(businesses),
    hardware: { ...offer.hardware },
    additionalHardware: offer.additionalHardware || "",
  };
}
