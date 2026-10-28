import React from "react";
import { Plus, Trash2, Layers3 } from "lucide-react";
import { summarizeBundle } from "../shared/sales-tools.mjs";

const money = (v) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(v);
const rate = (v) => (v === null ? "Not complete" : `${v.toFixed(2)}%`);

function NumberField({
  label,
  value,
  onChange,
  percentage = false,
  hint,
  placeholder,
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type="number"
          min="0"
          max={percentage ? "100" : undefined}
          step="any"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? "" : Number(event.target.value),
            )
          }
        />
        <em>{percentage ? "%" : "£"}</em>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function AcDetails({ deal, offer, onChange }) {
  const businesses = Array.isArray(offer.businesses) ? offer.businesses : [];
  const summary = summarizeBundle(businesses);
  const makeBusiness = (primary = false) => ({
    id: crypto.randomUUID(),
    name: primary ? deal.businessName || "" : "",
    provider: primary ? deal.provider || "" : "",
    annualTpv: primary
      ? (offer.annualTpv ?? deal.commissionDetails?.annualTpv ?? "")
      : "",
    currentRate: primary ? (offer.currentRate ?? "") : "",
    offeredRate: offer.rate ?? "",
    businessSurcharge: offer.businessSurcharge ?? "",
    internationalSurcharge: offer.internationalSurcharge ?? "",
    surchargeShare: offer.surchargeShare ?? "",
    businessShare: primary ? (offer.businessShare ?? "") : "",
    internationalShare: primary ? (offer.internationalShare ?? "") : "",
  });
  const updateRow = (id, key, value) =>
    onChange(
      "businesses",
      businesses.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  return (
    <section className="ac-details" aria-label="AC pricing and business bundle">
      <div className="form-section-title">
        <h3>AC pricing details</h3>
        <p>Record the annual TPV and agreed surcharge terms for this offer.</p>
      </div>
      <div className="form-grid">
        <NumberField
          label="AC annual TPV"
          value={offer.annualTpv}
          onChange={(v) => onChange("annualTpv", v)}
          hint="Declared annual turnover. Commission uses its own declared TPV in the Commission tab."
        />
        <NumberField
          label="Current processing rate"
          value={offer.currentRate}
          onChange={(v) => onChange("currentRate", v)}
          percentage
          hint="Record the quoted current rate; blended statement rate is shown in Statement."
        />
        <NumberField
          label="Business card surcharge"
          value={offer.businessSurcharge}
          onChange={(v) => onChange("businessSurcharge", v)}
          percentage
        />
        <NumberField
          label="International card surcharge"
          value={offer.internationalSurcharge}
          onChange={(v) => onChange("internationalSurcharge", v)}
          percentage
        />
        <NumberField
          label="Business card share"
          value={offer.businessShare}
          onChange={(v) => onChange("businessShare", v)}
          percentage
          hint="Share of annual card turnover from business cards."
        />
        <NumberField
          label="International card share"
          value={offer.internationalShare}
          onChange={(v) => onChange("internationalShare", v)}
          percentage
          hint="Share of annual card turnover from international cards. May overlap business cards."
        />
        <NumberField
          label="Surcharge share"
          value={offer.surchargeShare}
          onChange={(v) => onChange("surchargeShare", v)}
          percentage
          hint="Share of card turnover affected by a surcharge. Do not add overlapping card shares."
        />
      </div>
      <p className="ac-help">
        Surcharges are additional processing-rate uplifts in percentage points.
        Business and international card categories may overlap; these figures
        are recorded separately and excluded from the savings estimate.
      </p>
      <label className="check-row bundle-toggle">
        <input
          type="checkbox"
          checked={Boolean(offer.bundle)}
          onChange={(event) => {
            onChange("bundle", event.target.checked);
            if (event.target.checked && businesses.length === 0)
              onChange("businesses", [makeBusiness(true), makeBusiness()]);
          }}
        />
        <span>
          <strong>Bundle deal with multiple businesses</strong>
          <small>
            Keep each business’s turnover, rates and surcharge terms in this AC.
          </small>
        </span>
      </label>
      {offer.bundle && (
        <div className="bundle-businesses">
          <div className="form-section-title split">
            <div>
              <h3>
                <Layers3 size={17} /> Businesses in this bundle
              </h3>
              <p>
                Include the primary business once. Additional businesses do not
                automatically count as separate commission sales.
              </p>
            </div>
            <button
              type="button"
              className="button secondary small"
              onClick={() =>
                onChange("businesses", [...businesses, makeBusiness()])
              }
            >
              <Plus size={15} /> Add business
            </button>
          </div>
          {businesses.map((row, index) => (
            <section
              className="bundle-business"
              key={row.id}
              aria-label={`Bundle business ${index + 1}`}
            >
              <div className="bundle-business-heading">
                <strong>
                  {index === 0 ? "Primary business" : `Business ${index + 1}`}
                </strong>
                {index > 0 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove bundle business ${index + 1}`}
                    onClick={() =>
                      onChange(
                        "businesses",
                        businesses.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="form-grid">
                <label className="field full-width">
                  <span>Business name</span>
                  <div className="input-wrap">
                    <input
                      type="text"
                      value={row.name || ""}
                      maxLength={300}
                      onChange={(event) =>
                        updateRow(row.id, "name", event.target.value)
                      }
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Current provider</span>
                  <div className="input-wrap">
                    <input
                      value={row.provider || ""}
                      maxLength={300}
                      onChange={(e) =>
                        updateRow(row.id, "provider", e.target.value)
                      }
                      placeholder="Payment provider for this business"
                    />
                  </div>
                </label>
                <NumberField
                  label="Annual TPV"
                  value={row.annualTpv}
                  onChange={(v) => updateRow(row.id, "annualTpv", v)}
                />
                <NumberField
                  label="Current rate"
                  value={row.currentRate}
                  onChange={(v) => updateRow(row.id, "currentRate", v)}
                  percentage
                />
                <NumberField
                  label="Rate offered"
                  value={row.offeredRate}
                  onChange={(v) => updateRow(row.id, "offeredRate", v)}
                  percentage
                />
                <NumberField
                  label="Business card surcharge"
                  value={row.businessSurcharge}
                  onChange={(v) => updateRow(row.id, "businessSurcharge", v)}
                  percentage
                />
                <NumberField
                  label="International card surcharge"
                  value={row.internationalSurcharge}
                  onChange={(v) =>
                    updateRow(row.id, "internationalSurcharge", v)
                  }
                  percentage
                />
                <NumberField
                  label="Business card share"
                  value={row.businessShare}
                  onChange={(v) => updateRow(row.id, "businessShare", v)}
                  percentage
                />
                <NumberField
                  label="International card share"
                  value={row.internationalShare}
                  onChange={(v) => updateRow(row.id, "internationalShare", v)}
                  percentage
                  hint="Card categories may overlap; shares are not added together."
                />
                <NumberField
                  label="Surcharge share"
                  value={row.surchargeShare}
                  onChange={(v) => updateRow(row.id, "surchargeShare", v)}
                  percentage
                  hint="Share of this business’s turnover affected by a surcharge."
                />
              </div>
            </section>
          ))}
          <div className="bundle-summary" aria-live="polite">
            <div>
              <span>
                Combined annual TPV
                {!summary.tpvComplete ? " · entered values" : ""}
              </span>
              <strong>{money(summary.annualTpv)}</strong>
            </div>
            <div>
              <span>TPV-weighted current rate</span>
              <strong>{rate(summary.weightedCurrentRate)}</strong>
            </div>
            <div>
              <span>TPV-weighted offered rate</span>
              <strong>{rate(summary.weightedOfferedRate)}</strong>
            </div>
          </div>
          <p className="ac-help">
            Bundle totals use these business rows only. Update the primary row
            if you change the headline AC fields above. Blank rates stay
            incomplete rather than being treated as 0%.
          </p>
        </div>
      )}
    </section>
  );
}
