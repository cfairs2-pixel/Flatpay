import { monthlySummary, validateDeal } from "./domain.mjs";
import { estimateCurrentCommission } from "./official-milestones.mjs";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const pounds = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value || 0);
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export function londonToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type).value)
    .join("-");
}

export function validateChatInput(input, today = londonToday()) {
  if (!isObject(input)) fail("Send an assistant request object.");
  if (
    typeof input.message !== "string" ||
    !input.message.trim() ||
    input.message.length > 8000
  )
    fail("Enter a message of 1 to 8,000 characters.");
  const month = input.month ?? today.slice(0, 7);
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    fail("Choose a reporting month in YYYY-MM format.");
  if (
    input.dealId !== undefined &&
    input.dealId !== "" &&
    (typeof input.dealId !== "string" || input.dealId.length > 300)
  )
    fail("Choose a valid merchant.");
  if (
    input.notes !== undefined &&
    (typeof input.notes !== "string" || input.notes.length > 10000)
  )
    fail("Meeting notes must be text of at most 10,000 characters.");
  if (input.demo !== undefined && typeof input.demo !== "boolean")
    fail("Demo mode must be true or false.");
  if (input.deals !== undefined && input.demo !== true)
    fail("Client-supplied merchants are only accepted for demo mode.");
  if (
    input.demo === true &&
    (!Array.isArray(input.deals) ||
      input.deals.length > 200 ||
      input.deals.some((deal) => validateDeal(deal).length))
  )
    fail("Send up to 200 valid demo merchants.");
  return {
    message: input.message.trim(),
    month,
    dealId: input.dealId || null,
    notes: input.notes || "",
    demo: input.demo === true,
    deals: input.demo === true ? input.deals : undefined,
  };
}

export function validateTargets(targets) {
  if (!isObject(targets)) fail("Targets must be an object.");
  for (const key of ["sales", "commission"]) {
    if (
      targets[key] !== null &&
      (!numeric(targets[key]) ||
        (key === "sales" && !Number.isInteger(targets[key])))
    )
      fail(
        `${key === "sales" ? "Sales" : "Commission"} target must be null or a non-negative ${key === "sales" ? "whole number" : "number"}.`,
      );
  }
  return { sales: targets.sales, commission: targets.commission };
}

/** All financial figures come from the existing deterministic calculators. */
export function followUpDate(deal) {
  if (deal.nextFollowUpDate) return deal.nextFollowUpDate;
  const latest = (Array.isArray(deal.meetingNotes) ? deal.meetingNotes : [])
    .filter((note) => isObject(note) && note.nextFollowUp)
    .sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")),
    )[0];
  return latest?.nextFollowUp || null;
}

export function computeAssistantMetrics(
  deals,
  month,
  targets = { sales: null, commission: null },
  today = londonToday(),
) {
  const summary = monthlySummary(deals, month);
  const active = deals.filter(
    (deal) => !["won", "lost"].includes(String(deal.status).toLowerCase()),
  );
  const stages = {};
  for (const deal of active)
    stages[deal.status || "Lead"] = (stages[deal.status || "Lead"] || 0) + 1;
  const won = deals.filter(
    (deal) => String(deal.status).toLowerCase() === "won",
  );
  const estimates = won.map((deal) => ({
    deal,
    estimate: estimateCurrentCommission(deal, { asOfDate: today }),
  }));
  const monthEstimates = estimates.filter(({ deal }) =>
    deal.saleDate?.startsWith(`${month}-`),
  );
  const payoutRows = estimates.flatMap(({ deal, estimate }) =>
    estimate.breakdown
      .filter((row) => row.payMonth === month && row.eligible !== null)
      .map((row) => ({
        businessName: deal.businessName,
        label: row.label,
        amount: row.eligible,
      })),
  );
  const [year, monthIndex] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const elapsedDays =
    month < today.slice(0, 7)
      ? daysInMonth
      : month > today.slice(0, 7)
        ? 0
        : Number(today.slice(8));
  const projectionKnown = monthEstimates.filter(
    ({ estimate }) => estimate.total !== null,
  );
  return {
    month,
    ...summary,
    activeCount: active.length,
    pipelineMonthlyTpv: round(
      active.reduce((sum, deal) => sum + Number(deal.monthlyVolume || 0), 0),
    ),
    stages,
    projectedCommission: round(
      projectionKnown.reduce((sum, { estimate }) => sum + estimate.total, 0),
    ),
    projectionMissingCount: monthEstimates.length - projectionKnown.length,
    scheduledPayout: round(
      payoutRows.reduce((sum, row) => sum + row.amount, 0),
    ),
    payoutRows,
    targets,
    salesRemaining:
      targets.sales === null
        ? null
        : Math.max(0, targets.sales - summary.wonCount),
    commissionRemaining:
      targets.commission === null
        ? null
        : round(Math.max(0, targets.commission - summary.confirmedCommission)),
    elapsedDays,
    daysInMonth,
    salesPace:
      elapsedDays > 0
        ? round((summary.wonCount / elapsedDays) * daysInMonth)
        : null,
    dueFollowUps: active
      .filter((deal) => followUpDate(deal) && followUpDate(deal) <= today)
      .map((deal) => ({
        id: deal.id,
        businessName: deal.businessName,
        date: followUpDate(deal),
      })),
    missingOfferCount: active.filter((deal) => !deal.offers?.length).length,
  };
}

export function notesFromDeal(deal) {
  const meetings = Array.isArray(deal?.meetingNotes)
    ? deal.meetingNotes
        .map((note) =>
          typeof note === "string"
            ? note
            : note.content || note.body || note.text || "",
        )
        .filter(Boolean)
    : [];
  return [deal?.notes || "", ...meetings].filter(Boolean).join("\n");
}

export function localAssistantReply({
  message,
  notes = "",
  deal,
  deals,
  metrics,
  preferences = [],
}) {
  const text = message.toLowerCase();
  const name = deal?.businessName || "the merchant";
  const actions = [];
  if (
    /note|summari[sz]e|meeting|capture|tidy|follow.?up|draft|email/.test(text)
  ) {
    const source = notes || notesFromDeal(deal);
    if (!source.trim())
      return {
        reply:
          "Paste your meeting notes or select a merchant with saved notes. I can turn them into a reviewable note and a follow-up draft. Nothing is sent or saved to a merchant until you accept it.",
        actions,
      };
    const lines = source
      .trim()
      .split(/\n+|(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const captured = lines
      .slice(0, 12)
      .map((line) => `• ${line}`)
      .join("\n");
    const summary = `Meeting with ${name}\n${captured}${lines.length > 12 ? "\nFurther detail remains in the original notes." : ""}\n\nNext steps to confirm: decision maker, statement period, approved offer and follow-up date.`;
    const preference = preferences
      .map((item) => item.text)
      .join(" ")
      .toLowerCase();
    const greeting = /formal/.test(preference)
      ? `Dear ${deal?.contactName || "customer"},`
      : `Hi ${deal?.contactName || "there"},`;
    const followUp = `${greeting}\n\nThanks for meeting with me about ${name}. Here is a recap for you to check:\n${lines
      .slice(0, 5)
      .map((line) => `• ${line}`)
      .join(
        "\n",
      )}\n\nPlease let me know what you would like to clarify and a suitable time to talk through the approved offer.\n\nThank you`;
    actions.push(
      { type: "note", text: summary },
      { type: "followUp", text: followUp },
    );
    return {
      reply: `I prepared a note and a follow-up draft from the text you supplied. Review them below; the local assistant preserves your wording and does not verify facts or infer pricing approvals.${preferences.length ? " Your saved preferences are available; advanced personalisation needs the AI connection." : ""}`,
      actions,
    };
  }
  if (/push|clos|objection|sign|offer|deal/.test(text) && deal) {
    const offer =
      deal.offers?.find((item) => item.id === deal.selectedOfferId) ||
      deal.offers?.at(-1);
    return {
      reply: `For ${name}, start by asking what is stopping a decision today. Confirm the decision maker and compare the written offer against their current statement.${offer ? ` The selected offer records ${offer.rate === "" || offer.rate === undefined ? "no base rate yet" : `${offer.rate}% base rate`}${offer.manager ? ` and manager ${offer.manager}` : "; no approving manager is recorded"}.` : " No AC offer is recorded yet."}\n\nIf you use a closing offer, keep the original proposal, record the approved concession and any real expiry, then create the customer sheet. Do not invent a deadline, discount or approval. If they need time, agree a follow-up date and leave the offer sheet.`,
      actions,
    };
  }
  const lines = [
    `${metrics.month}: ${metrics.wonCount} sales won and ${pounds(metrics.confirmedCommission)} manually confirmed commission on those wins.`,
    `${metrics.activeCount} active opportunities represent ${pounds(metrics.pipelineMonthlyTpv)} monthly TPV. ${
      Object.entries(metrics.stages)
        .map(([stage, count]) => `${stage}: ${count}`)
        .join(" · ") || "There are no active stages yet."
    }`,
    `Recorded milestone payouts scheduled for this month: ${pounds(metrics.scheduledPayout)}. This is a draft-rule estimate, separate from confirmed commission and payroll.`,
  ];
  if (metrics.targets.sales !== null) {
    lines.push(
      `Sales target: ${metrics.targets.sales}; ${metrics.salesRemaining} still to win.${metrics.salesPace === null ? " The month has not started." : ` Calendar-day pace projects ${metrics.salesPace} sales for the full month; this is a simple run rate, not a forecast.`}`,
    );
  } else lines.push("Set a monthly sales target to track your gap and pace.");
  if (metrics.targets.commission !== null)
    lines.push(
      `Confirmed commission target: ${pounds(metrics.targets.commission)}; gap ${pounds(metrics.commissionRemaining)}. Unconfirmed projections do not close this gap.`,
    );
  if (metrics.projectionMissingCount)
    lines.push(
      `${metrics.projectionMissingCount} won sale(s) lack the inputs needed for a commission projection.`,
    );
  if (metrics.dueFollowUps.length)
    lines.push(
      `Follow up now: ${metrics.dueFollowUps
        .slice(0, 8)
        .map((item) => item.businessName)
        .join(", ")}.`,
    );
  if (metrics.missingOfferCount)
    lines.push(
      `Next action: ${metrics.missingOfferCount} active merchant(s) have no recorded AC offer. Prioritise statement collection and pricing approval.`,
    );
  lines.push(
    "I use saved records and explicit preferences; I do not train a model as you use the app. Connect the AI service for flexible questions and richer drafting.",
  );
  return { reply: lines.join("\n\n"), actions };
}
