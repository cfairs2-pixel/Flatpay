import React, { useState } from "react";
import { Printer, FileCheck2, ArrowRight, Zap, Info } from "lucide-react";
import { buildOfferSnapshot } from "../shared/sales-tools.mjs";
import { estimateCurrentCommission } from "../shared/official-milestones.mjs";
const blank = (v) => v === "" || v === null || v === undefined;
const money = (v) =>
  blank(v)
    ? "To confirm"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(Number(v));
const pct = (v) => (blank(v) ? "To confirm" : `${Number(v).toFixed(2)}%`);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const hardwareNames = {
  terminal: "Standalone terminal",
  posPremium: "POS Premium",
  posPro: "POS Pro",
  mpos: "mPOS",
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const printStyles = `body{font:14px Arial,sans-serif;color:#111;margin:0;padding:36px;max-width:1000px;margin:auto}header{display:flex;justify-content:space-between;border-bottom:3px solid #111;padding-bottom:24px}.logo{font-size:30px;font-weight:900;letter-spacing:-1.5px}h1{font-size:38px;letter-spacing:-1.4px;margin:36px 0 8px}h2{font-size:17px;margin-top:30px}.sub{color:#666}.hero{background:#fedeec;padding:24px;margin-top:24px}table{width:100%;border-collapse:collapse;font-size:12px;margin:18px 0}th,td{border-bottom:1px solid #ddd;padding:12px 8px;text-align:left;vertical-align:top}th{background:#f4f4f4}.mint{background:#c9e6d1;padding:18px}p{line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:32px;border-top:1px solid #ddd;padding-top:16px;font-size:11px;color:#555}button{background:#111;color:#fff;border:0;padding:12px 18px;margin:20px 0;cursor:pointer}@media print{body{padding:0}button{display:none}tr{break-inside:avoid}thead{display:table-header-group}}`;
export function printableOfferHtml(deal, offer, sheet) {
  const s = buildOfferSnapshot(deal, offer);
  if (!s) throw new Error("Choose an AC offer first.");
  const rows = s.businesses
    .map(
      (r) =>
        `<tr><td>${esc(r.name)}<br><span class="sub">Current provider: ${esc(r.provider || "Not recorded")}</span></td><td>${esc(money(r.annualTpv))}</td><td>${esc(pct(r.currentRate))}</td><td>${esc(pct(r.offeredRate))}</td><td>${esc(pct(r.businessSurcharge))}<br>Card share: ${esc(pct(r.businessShare))}</td><td>${esc(pct(r.internationalSurcharge))}<br>Card share: ${esc(pct(r.internationalShare))}</td><td>${esc(pct(r.surchargeShare))}</td></tr>`,
    )
    .join("");
  const hardware = Object.entries(s.hardware)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${esc(n)} × ${esc(hardwareNames[k] || k)}`)
    .join(" · ");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>myflatpay offer — ${esc(deal.businessName)}</title><style>${printStyles}</style></head><body><header><span class="logo">myflatpay</span><span>YOUR PAYMENT PROPOSAL<br>${esc(s.date || today())}</span></header><h1>A simpler way to get paid.</h1><p class="sub">Prepared for ${esc(deal.businessName)}${deal.contactName ? ` · ${esc(deal.contactName)}` : ""}</p><div class="hero"><strong>${s.bundle ? `${s.businesses.length} businesses. One clear proposal.` : `Your proposed base rate: ${esc(pct(offer.rate))}`}</strong><p>${esc(sheet.message || "Thank you for your time. Here is your payment proposal to review, with the details we discussed.")}</p></div><table><thead><tr><th>Business</th><th>Annual TPV</th><th>Current recorded rate</th><th>Offered base rate</th><th>Business uplift</th><th>International uplift</th><th>Surcharge share</th></tr></thead><tbody>${rows}</tbody></table><p class="sub">Uplifts are additional percentage points on applicable processing. Surcharge share is the recorded share of turnover affected. Card categories may overlap; amounts above are not an all-in cost estimate.</p><div class="mint"><strong>Hardware package</strong><p>${hardware || "To confirm"}${s.additionalHardware ? `\n${esc(s.additionalHardware)}` : ""}</p><p>Proposed Amex rate: ${esc(pct(offer.amexRate))}</p></div><h2>Your next step</h2><p>${esc(sheet.preparedBy || "Your sales contact")}${sheet.contactDetails ? `\n${esc(sheet.contactDetails)}` : ""}</p><p>${sheet.validUntil ? `Proposal valid until ${esc(sheet.validUntil)}.` : "Contact us to confirm availability and final terms."}</p><h2>Terms discussed</h2><p>${esc(sheet.terms || "Final pricing, hardware and eligibility are subject to written agreement and approval. This proposal is not a signed contract.")}</p><footer>Prepared using myflatpay · Personal sales workspace. No contract is created by this document. Final agreed terms and applicable card pricing govern.</footer><button id="print">Print / save PDF</button></body></html>`;
}
function Input({ label, value, onChange, type = "text", ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            type === "number" && e.target.value !== ""
              ? Number(e.target.value)
              : e.target.value,
          )
        }
        {...props}
      />
    </label>
  );
}
export function OfferSheet({ deal, onChange }) {
  const sheet = deal.offerSheet || {},
    update = (k, v) => onChange({ ...sheet, [k]: v });
  const offer =
    deal.offers.find((o) => o.id === (sheet.offerId || deal.selectedOfferId)) ||
    deal.offers.at(-1);
  const [error, setError] = useState("");
  function print() {
    setError("");
    if (!offer) return setError("Add an AC offer before printing.");
    const popup = window.open("", "_blank");
    if (!popup)
      return setError("Allow this app to open the offer sheet in a new tab.");
    popup.opener = null;
    popup.document.open();
    popup.document.write(printableOfferHtml(deal, offer, sheet));
    popup.document.close();
    popup.document.getElementById("print").onclick = () => popup.print();
    popup.focus();
  }
  const snapshot = buildOfferSnapshot(deal, offer);
  return (
    <div className="offer-sheet-tool">
      <div className="form-section-title">
        <h3>Leave a good offer behind.</h3>
        <p>
          Create a customer proposal from a saved AC. Print it or save it as a
          PDF to leave with a customer who needs more time.
        </p>
      </div>
      {!deal.offers.length ? (
        <div className="notice">
          <Info size={18} />
          <p>Add an offer in the AC offers tab to get started.</p>
        </div>
      ) : (
        <>
          <label className="field">
            <span>AC for offer sheet</span>
            <select
              value={offer?.id || ""}
              onChange={(e) => update("offerId", e.target.value)}
            >
              {deal.offers.map((o, i) => (
                <option value={o.id} key={o.id}>
                  Offer {i + 1} · {pct(o.rate)} · {o.date || "Undated"}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <Input
              label="Prepared by"
              value={sheet.preparedBy}
              onChange={(v) => update("preparedBy", v)}
            />
            <Input
              label="Offer valid until"
              type="date"
              value={sheet.validUntil}
              onChange={(v) => update("validUntil", v)}
            />
          </div>
          <label className="field">
            <span>Your contact details for the customer</span>
            <textarea
              rows={2}
              value={sheet.contactDetails || ""}
              onChange={(e) => update("contactDetails", e.target.value)}
              placeholder="Your phone number and email"
            />
          </label>
          <label className="field">
            <span>Personal message</span>
            <textarea
              rows={3}
              value={sheet.message || ""}
              onChange={(e) => update("message", e.target.value)}
              placeholder="Summarise how the proposal meets their needs."
            />
          </label>
          <label className="field">
            <span>Customer terms & inclusions</span>
            <textarea
              rows={3}
              value={sheet.terms || ""}
              onChange={(e) => update("terms", e.target.value)}
              placeholder="Agreed inclusions, fees, approval conditions and any genuine expiry."
            />
          </label>
          <article className="offer-paper">
            <div className="paper-brand">
              myflatpay<span>CUSTOMER PROPOSAL</span>
            </div>
            <h2>{deal.businessName || "Your business"}</h2>
            <p>
              {sheet.message || "A clear payment proposal, ready to review."}
            </p>
            <div className="proposal-big-rate">
              {snapshot.bundle ? "Rates by business" : pct(offer.rate)}
              <small>
                {snapshot.bundle
                  ? "See each business below"
                  : "proposed base rate"}
              </small>
            </div>
            <div className="proposal-businesses">
              {snapshot.businesses.map((b, i) => (
                <div key={b.id || i}>
                  <strong>{b.name || "Business name to confirm"}</strong>
                  <span>Current provider: {b.provider || "Not recorded"}</span>
                  <span>{money(b.annualTpv)} annual TPV</span>
                  <span>
                    {pct(b.currentRate)} current → {pct(b.offeredRate)} offered
                  </span>
                  <small>
                    Business +{pct(b.businessSurcharge)} (share{" "}
                    {pct(b.businessShare)}) · International +
                    {pct(b.internationalSurcharge)} (share{" "}
                    {pct(b.internationalShare)}) · Surcharge share{" "}
                    {pct(b.surchargeShare)}
                  </small>
                </div>
              ))}
            </div>
            <p className="paper-footnote">
              The printable version includes hardware, Amex pricing, terms and
              your contact details. Internal notes and commission are excluded.
            </p>
          </article>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary" type="button" onClick={print}>
            <Printer size={17} /> Open printable offer
          </button>
          <p className="tool-caption">
            Use “Print / save PDF” in the new tab. Save the merchant to retain
            these offer sheet settings.
          </p>
        </>
      )}
    </div>
  );
}
export function ClosingDeal({ deal, onChange, onCreate }) {
  const c = deal.closingDeal || {},
    update = (k, v) =>
      onChange({
        ...c,
        [k]: v,
        ...(k !== "approved" ? { approved: false, offerId: "" } : {}),
      }),
    [error, setError] = useState("");
  const offer =
    deal.offers.find((o) => o.id === deal.selectedOfferId) ||
    deal.offers.at(-1);
  const hypothetical =
    offer && !blank(c.rate)
      ? {
          ...deal,
          selectedOfferId: "closing-preview",
          acceptedOfferId: undefined,
          offers: [
            ...deal.offers,
            { ...offer, id: "closing-preview", rate: c.rate },
          ],
        }
      : null;
  const projection = hypothetical
    ? estimateCurrentCommission(hypothetical, { asOfDate: today() })
    : null;
  function create() {
    if (!offer) return setError("Create a standard AC offer first.");
    if (
      blank(c.rate) ||
      !Number.isFinite(Number(c.rate)) ||
      Number(c.rate) < 0 ||
      Number(c.rate) > 100
    )
      return setError("Enter a valid closing rate between 0 and 100%.");
    if (!c.reason?.trim())
      return setError("Record the objection this offer addresses.");
    if (!c.approved || !c.manager?.trim() || !c.approvalReference?.trim())
      return setError(
        "Record manager approval, name and a reference before creating the closing AC.",
      );
    if (c.validUntil && c.validUntil < today())
      return setError(
        "The closing offer has expired. Confirm a current approval.",
      );
    const o = {
      ...structuredClone(offer),
      id: crypto.randomUUID(),
      date: today(),
      rate: Number(c.rate),
      manager: c.manager,
      acLink: "",
      notes: `Closing offer\nObjection: ${c.reason}\nConcession: ${c.incentive || "Rate adjustment"}\nApproval reference: ${c.approvalReference}${c.validUntil ? `\nValid until: ${c.validUntil}` : ""}`,
      businessSurcharge: blank(c.businessSurcharge)
        ? offer.businessSurcharge
        : c.businessSurcharge,
      internationalSurcharge: blank(c.internationalSurcharge)
        ? offer.internationalSurcharge
        : c.internationalSurcharge,
    };
    if (offer.bundle)
      o.businesses = (offer.businesses || []).map((b) => ({
        ...b,
        offeredRate: Number(c.rate),
        businessSurcharge: blank(c.businessSurcharge)
          ? b.businessSurcharge
          : c.businessSurcharge,
        internationalSurcharge: blank(c.internationalSurcharge)
          ? b.internationalSurcharge
          : c.internationalSurcharge,
      }));
    onCreate(o, { ...c, offerId: o.id });
    setError("");
  }
  return (
    <section>
      <div className="closing-intro">
        <Zap size={24} />
        <div>
          <h3>One final, considered offer.</h3>
          <p>
            Address the real objection with an approved concession. Record
            genuine deadlines and keep the original proposal.
          </p>
        </div>
      </div>
      <div className="form-grid">
        <Input
          label="Closing base rate (%)"
          type="number"
          min="0"
          max="100"
          step="any"
          value={c.rate}
          onChange={(v) => update("rate", v)}
        />
        <Input
          label="Closing offer valid until"
          type="date"
          value={c.validUntil}
          onChange={(v) => update("validUntil", v)}
        />
        <Input
          label="Closing business uplift (%)"
          type="number"
          min="0"
          max="100"
          step="any"
          value={c.businessSurcharge}
          onChange={(v) => update("businessSurcharge", v)}
        />
        <Input
          label="Closing international uplift (%)"
          type="number"
          min="0"
          max="100"
          step="any"
          value={c.internationalSurcharge}
          onChange={(v) => update("internationalSurcharge", v)}
        />
      </div>
      <label className="field">
        <span>Objection to overcome</span>
        <textarea
          rows={3}
          value={c.reason || ""}
          onChange={(e) => update("reason", e.target.value)}
          placeholder="What is stopping them from signing?"
        />
      </label>
      <label className="field">
        <span>Approved concession / incentive</span>
        <textarea
          rows={3}
          value={c.incentive || ""}
          onChange={(e) => update("incentive", e.target.value)}
          placeholder="What additional value has been approved?"
        />
      </label>
      <div className="form-grid">
        <Input
          label="Closing approval manager"
          value={c.manager}
          onChange={(v) => update("manager", v)}
        />
        <Input
          label="Closing approval reference"
          value={c.approvalReference}
          onChange={(v) => update("approvalReference", v)}
        />
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={!!c.approved}
          onChange={(e) => update("approved", e.target.checked)}
        />
        <span>My manager has approved this closing proposal.</span>
      </label>
      {offer?.bundle && (
        <div className="notice">
          <Info size={17} />
          <p>
            For a bundle, this closing base rate applies to every business.
            Blank uplift fields keep each business’s existing uplift. Review all
            terms before recording approval.
          </p>
        </div>
      )}
      {projection && (
        <p className="tool-caption">
          Check the commission tab after creating the AC; a lower rate can
          change your projection and may fall below the product floor.
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {c.offerId && (
        <div className="notice">
          <FileCheck2 size={17} />
          <p>
            A closing AC has been created. Save the merchant to keep this
            revision.
          </p>
        </div>
      )}
      <button type="button" className="button primary" onClick={create}>
        Create closing AC <ArrowRight size={17} />
      </button>
      <p className="tool-caption">
        This creates a new offer revision. Record the signature separately when
        the customer agrees.
      </p>
    </section>
  );
}
