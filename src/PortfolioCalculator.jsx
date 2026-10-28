import React, { useId, useState } from "react";
import { Calculator, RotateCcw, ExternalLink, Info } from "lucide-react";
import {
  calculatePortfolioCommission,
  SCENARIOS,
} from "../shared/official-commission.mjs";
import "./portfolio.css";

const INPUTS = {
  termInst: { label: "Terminal installations", min: 0, max: 30, step: 1 },
  posInst: {
    label: "POS installations",
    hint: "Premium / Pro merchant deals",
    min: 0,
    max: 30,
    step: 1,
  },
  mposInst: { label: "mPOS installations", min: 0, max: 30, step: 1 },
  termRate: {
    label: "Average Terminal rate",
    hint: "Hard floor 0.49%",
    suffix: "%",
    min: 0.49,
    max: 1.69,
    step: 0.01,
  },
  posRate: {
    label: "Average POS rate",
    hint: "Hard floor 0.89%",
    suffix: "%",
    min: 0.89,
    max: 1.69,
    step: 0.01,
  },
  mposRate: {
    label: "Average mPOS rate",
    hint: "Hard floor 0.89%",
    suffix: "%",
    min: 0.89,
    max: 1.69,
    step: 0.01,
  },
  termTpv: {
    label: "Average annual Terminal TPV",
    suffix: "GBP",
    min: 40000,
    max: 500000,
    step: 1000,
  },
  posTpv: {
    label: "Average annual POS TPV",
    suffix: "GBP",
    min: 40000,
    max: 500000,
    step: 1000,
  },
  mposTpv: {
    label: "Average annual mPOS TPV",
    suffix: "GBP",
    min: 40000,
    max: 500000,
    step: 1000,
  },
  upfront: {
    label: "Average POS upfront collected",
    hint: "Below £500: −£100 per deal",
    suffix: "GBP",
    min: 0,
    max: 3500,
    step: 50,
  },
  mposUpfront: {
    label: "Average mPOS upfront collected",
    hint: "Below £250: −£100 per deal",
    suffix: "GBP",
    min: 0,
    max: 1500,
    step: 50,
  },
  quickInst: {
    label: "Quick installations",
    hint: "Within five days · £50 each",
    min: 0,
    max: 50,
    step: 1,
  },
  ogInst: {
    label: "Own-generated installations",
    hint: "£50 each",
    min: 0,
    max: 50,
    step: 1,
  },
  quickSales: {
    label: "IH quick sales",
    hint: "Within 24 hours · £30 each",
    min: 0,
    max: 25,
    step: 1,
  },
  amex375: {
    label: "Amex 3.89% rate sales",
    hint: "£40 each",
    min: 0,
    max: 25,
    step: 1,
  },
  amex299: {
    label: "Amex 2.99% rate sales",
    hint: "£20 each",
    min: 0,
    max: 25,
    step: 1,
  },
  amex249: {
    label: "Amex 2.49% rate sales",
    hint: "£10 each",
    min: 0,
    max: 25,
    step: 1,
  },
  hitRate: {
    label: "Portfolio reaching the 30-day TPV target",
    hint: "The second half of matrix commission follows this percentage.",
    suffix: "%",
    min: 0,
    max: 100,
    step: 1,
  },
};

function cash(value, signed = false) {
  if (!Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}£${Math.abs(Math.round(value)).toLocaleString("en-GB")}`;
}

function ScenarioInput({ inputKey, value, onChange }) {
  const id = useId();
  const def = INPUTS[inputKey];
  return (
    <div className="portfolio-field">
      <label htmlFor={id}>{def.label}</label>
      <div className="portfolio-input-wrap">
        <input
          id={id}
          type="number"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          onChange={(event) => onChange(inputKey, event.target.value)}
          aria-describedby={def.hint ? `${id}-hint` : undefined}
        />
        {def.suffix && <span aria-hidden="true">{def.suffix}</span>}
      </div>
      {def.hint && <small id={`${id}-hint`}>{def.hint}</small>}
    </div>
  );
}

/** Hypothetical monthly calculator; it never changes a merchant or confirmed earnings. */
export default function PortfolioCalculator() {
  const [inputs, setInputs] = useState({ ...SCENARIOS[0].v });
  const [selected, setSelected] = useState(SCENARIOS[0].name);
  const update = (key, value) => {
    setSelected("Custom scenario");
    setInputs((previous) => ({ ...previous, [key]: value }));
  };
  const selectScenario = (scenario) => {
    setSelected(scenario.name);
    setInputs({ ...scenario.v });
  };
  const invalid = Object.entries(INPUTS).find(
    ([key, def]) =>
      inputs[key] === "" ||
      !Number.isFinite(Number(inputs[key])) ||
      Number(inputs[key]) < def.min ||
      Number(inputs[key]) > def.max ||
      (def.step === 1 && !Number.isInteger(Number(inputs[key]))),
  );
  const result = invalid ? null : calculatePortfolioCommission(inputs);
  const input = (key) => (
    <ScenarioInput
      key={key}
      inputKey={key}
      value={inputs[key]}
      onChange={update}
    />
  );
  const breakdown = result
    ? [
        [
          "Terminal matrix",
          `${result.termInst} deals × ${cash(result.termPer)}`,
          result.termMatrix,
        ],
        [
          "POS matrix",
          `${result.posInst} deals × ${cash(result.posPer)}`,
          result.posMatrix,
        ],
        [
          "mPOS matrix",
          `${result.mposInst} deals × ${cash(result.mposPer)}`,
          result.mposMatrix,
        ],
        [
          "POS upfront",
          "15% at or above £500; otherwise −£100 per deal",
          result.upfront,
        ],
        [
          "POS volume bonus",
          `${inputs.posInst} installed POS merchant deals`,
          result.posVol,
        ],
        [
          "mPOS upfront",
          "15% at or above £250; otherwise −£100 per deal",
          result.mposUp,
        ],
        ["Own-generated installation", `${inputs.ogInst} × £50`, result.og],
        [
          "Quick installation",
          `${inputs.quickInst} × £50`,
          result.quickInstall,
        ],
        ["IH quick sale", `${inputs.quickSales} × £30`, result.quickSale],
        ["Amex 3.89% rate", `${inputs.amex375} × £40`, result.amex375],
        ["Amex 2.99% rate", `${inputs.amex299} × £20`, result.amex299],
        ["Amex 2.49% rate", `${inputs.amex249} × £10`, result.amex249],
      ]
    : [];
  return (
    <section
      className="portfolio-calculator panel"
      aria-labelledby="portfolio-title"
    >
      <div className="portfolio-heading">
        <div>
          <span className="portfolio-kicker">
            <Calculator size={14} /> PLAN YOUR MONTH
          </span>
          <h2 id="portfolio-title">Monthly commission calculator</h2>
          <p>
            Explore a hypothetical portfolio using the official calculator’s
            rules.
          </p>
        </div>
        <span className="portfolio-source">DRAFT v2 · May 2026</span>
      </div>
      <div className="portfolio-scenario-bar">
        <div role="group" aria-label="Commission scenarios">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.name}
              type="button"
              aria-pressed={selected === scenario.name}
              onClick={() => selectScenario(scenario)}
            >
              {scenario.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="portfolio-reset"
          onClick={() => selectScenario(SCENARIOS[0])}
        >
          <RotateCcw size={13} /> Reset
        </button>
      </div>
      <div className="portfolio-layout">
        <div className="portfolio-controls">
          <div className="portfolio-product-grid">
            {[
              ["Terminal", ["termInst", "termRate", "termTpv"]],
              [
                "POS Premium / Pro",
                ["posInst", "posRate", "posTpv", "upfront"],
              ],
              ["mPOS", ["mposInst", "mposRate", "mposTpv", "mposUpfront"]],
            ].map(([title, keys], index) => (
              <section className="portfolio-input-card" key={title}>
                <h3>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {title}
                </h3>
                {keys.map(input)}
              </section>
            ))}
          </div>
          <section className="portfolio-bonus-inputs">
            <h3>Installation & sales bonuses</h3>
            <p>
              Amex bonuses require £123+ TPV in the first month that actually
              takes Amex.
            </p>
            <div className="portfolio-bonus-grid">
              {[
                "quickInst",
                "ogInst",
                "quickSales",
                "amex375",
                "amex299",
                "amex249",
              ].map(input)}
            </div>
          </section>
          <section className="portfolio-target">
            {input("hitRate")}
            <div className="portfolio-target-explainer">
              <Info size={15} />
              <p>
                TPV here is <strong>annual</strong>. Matrix values interpolate
                between rate and TPV bands, round per deal, and cap at £500,000.
                POS volume bonuses count merchant deals, not hardware units.
              </p>
            </div>
          </section>
          {invalid && (
            <div className="portfolio-validation" role="alert">
              Enter {INPUTS[invalid[0]].label.toLowerCase()} between{" "}
              {INPUTS[invalid[0]].min.toLocaleString("en-GB")} and{" "}
              {INPUTS[invalid[0]].max.toLocaleString("en-GB")}
              {INPUTS[invalid[0]].step === 1 ? " as a whole number" : ""}.
            </div>
          )}
        </div>
        <aside
          className="portfolio-result"
          aria-label="Hypothetical commission result"
        >
          <div className="portfolio-result-hero">
            <span>HYPOTHETICAL GROSS MONTHLY SALARY</span>
            <strong data-testid="portfolio-gross" aria-live="polite">
              {cash(result?.realised)}
            </strong>
            <small>{selected} · before tax and deductions</small>
          </div>
          <div className="portfolio-headline">
            <div>
              <span>Headline commission</span>
              <strong data-testid="portfolio-headline">
                {cash(result?.headline)}
              </strong>
            </div>
            <small>Before the 30-day target adjustment and guarantee.</small>
          </div>
          <div className="portfolio-breakdown">
            {breakdown.map(([label, description, value]) => (
              <div className={value < 0 ? "negative" : ""} key={label}>
                <span>
                  {label}
                  <small>{description}</small>
                </span>
                <strong>{cash(value)}</strong>
              </div>
            ))}
          </div>
          <div className="portfolio-adjustments">
            <div>
              <span>30-day target adjustment</span>
              <strong>
                {cash(
                  result
                    ? -result.matrix * 0.5 * (1 - Number(inputs.hitRate) / 100)
                    : undefined,
                )}
              </strong>
            </div>
            <div>
              <span>Minimum guarantee top-up</span>
              <strong data-testid="portfolio-guarantee">
                {cash(result?.guaranteeTopup, true)}
              </strong>
            </div>
            <small>
              The £2,120 minimum is a portfolio-wide guarantee, not an
              additional bonus on each sale.
            </small>
          </div>
        </aside>
      </div>
      <div className="portfolio-footnote">
        <Info size={16} />
        <p>
          This scenario does not change your merchants or confirmed commission.
          It reproduces the executable draft calculator; final eligibility and
          payroll adjustments need manager confirmation.{" "}
          <a
            href="https://sm-commission.pages.dev/SM_4_Calculator"
            target="_blank"
            rel="noreferrer"
          >
            View the official source <ExternalLink size={11} />
          </a>
        </p>
      </div>
    </section>
  );
}
