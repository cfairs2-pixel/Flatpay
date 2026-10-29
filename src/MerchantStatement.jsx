import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Upload,
  FileSearch,
  Check,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  STATEMENT_FIELDS,
  parseMerchantStatement,
  calculateStatement,
  buildStatementPatch,
} from "../shared/merchant-statement.mjs";
import { readMerchantStatement } from "./statement-reader.mjs";
import { validateDeal } from "../shared/domain.mjs";
import "./statement.css";

const present = (value) =>
  value !== "" && value !== null && value !== undefined;
const currency = (value) =>
  !present(value) || !Number.isFinite(Number(value))
    ? "Not available"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
      }).format(Number(value));
const percent = (value) =>
  !present(value) || !Number.isFinite(Number(value))
    ? "Not available"
    : `${Number(value).toFixed(2)}%`;
const TARGETS = {
  businessName: "businessName",
  provider: "provider",
  turnover: "monthlyVolume",
  totalCharges: "currentCharges",
  businessVolume: "businessVolume",
  internationalVolume: "internationalVolume",
  amexVolume: "amexVolume",
  amexRate: "amexRate",
};
const AMOUNTS = new Set([
  "turnover",
  "totalCharges",
  "businessVolume",
  "internationalVolume",
  "amexVolume",
]);
const PRIMARY = ["periodMonths", "turnover", "totalCharges"];
const CARD_MIX = [
  "businessVolume",
  "internationalVolume",
  "amexVolume",
  "amexRate",
  "transactionCount",
];
const FEES = [
  "processingFees",
  "terminalRental",
  "pciFees",
  "otherFees",
  "vat",
];

function defaultSelection(values, deal) {
  return Object.keys(values).filter(
    (key) =>
      present(values[key]) && (!TARGETS[key] || !present(deal[TARGETS[key]])),
  );
}

function CalculatedFigures({ figures, saved = false }) {
  return (
    <div
      className="statement-calculations"
      aria-label={
        saved ? "Saved statement figures" : "Calculated statement figures"
      }
    >
      <h3>
        {saved ? "Reviewed statement figures" : "Your calculated figures"}
      </h3>
      <dl>
        <div className="statement-result-main">
          <dt>Current effective rate</dt>
          <dd>{percent(figures.effectiveRate)}</dd>
        </div>
        <div>
          <dt>Monthly card turnover</dt>
          <dd>{currency(figures.monthlyVolume)}</dd>
        </div>
        <div>
          <dt>Monthly charges</dt>
          <dd>{currency(figures.monthlyCharges)}</dd>
        </div>
        <div>
          <dt>Annual TPV run rate</dt>
          <dd>{currency(figures.annualTpv)}</dd>
        </div>
        <div>
          <dt>Annual charges run rate</dt>
          <dd>
            {currency(
              present(figures.monthlyCharges)
                ? figures.monthlyCharges * 12
                : null,
            )}
          </dd>
        </div>
        <div>
          <dt>Average transaction value</dt>
          <dd>{currency(figures.averageTransactionValue)}</dd>
        </div>
        <div>
          <dt>Business card share</dt>
          <dd>{percent(figures.businessShare)}</dd>
        </div>
        <div>
          <dt>International card share</dt>
          <dd>{percent(figures.internationalShare)}</dd>
        </div>
        <div>
          <dt>Amex card share</dt>
          <dd>{percent(figures.amexShare)}</dd>
        </div>
      </dl>
      <p>
        Effective rate = total charges ÷ card turnover × 100. Run rates scale
        the reviewed period; they are estimates, not a declared annual TPV or a
        seasonal forecast. Card categories can overlap.
      </p>
    </div>
  );
}

export default function MerchantStatement({ deal = {}, onApply }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [values, setValues] = useState({});
  const [evidence, setEvidence] = useState({});
  const [selected, setSelected] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [hasResults, setHasResults] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [textDirty, setTextDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const uploadRef = useRef(null);
  const cameraRef = useRef(null);
  const controllerRef = useRef(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);
  const figures = calculateStatement(values);
  const requiresPeriod = selected.some((key) => AMOUNTS.has(key));
  const validPeriod =
    Number(values.periodMonths) > 0 &&
    Number.isFinite(Number(values.periodMonths));
  const periodReady = validPeriod && selected.includes("periodMonths");
  const saved = deal.statementAnalysis;
  const savedFigures = saved?.values ? calculateStatement(saved.values) : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  function cancel() {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setStatus("");
    setProgress(0);
  }
  function clear() {
    cancel();
    setFile(null);
    setText("");
    setValues({});
    setEvidence({});
    setSelected([]);
    setWarnings([]);
    setHasResults(false);
    setReviewed(false);
    setTextDirty(false);
    setError("");
    setNotice("");
  }
  function chooseFile(event) {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next) return;
    clear();
    if (next.size > 25 * 1024 * 1024) {
      setError(
        "Choose a statement under 25 MB, or photograph its summary page.",
      );
      return;
    }
    if (
      next.type !== "application/pdf" &&
      !/^image\//i.test(next.type) &&
      !/\.(pdf|png|jpe?g|webp|avif|bmp|heic|heif)$/i.test(next.name)
    ) {
      setError("Choose a PDF or a clear photo of the merchant statement.");
      return;
    }
    setFile(next);
  }
  function parse(value, readerWarnings = []) {
    const result = parseMerchantStatement(value);
    setValues(result.values || {});
    setEvidence(result.evidence || {});
    setSelected(defaultSelection(result.values || {}, deal));
    setWarnings([...readerWarnings, ...(result.warnings || [])]);
    setReviewed(false);
    setTextDirty(false);
    setHasResults(true);
    setError("");
    setNotice(
      Object.keys(result.values || {}).length
        ? "Check the figures against the statement before adding them."
        : "No clear totals found. Enter the figures below, or correct the recognised text.",
    );
  }
  async function read() {
    if (!file || busy) return;
    const operation = ++operationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setStatus("Opening your statement");
    setProgress(0);
    try {
      const result = await readMerchantStatement(file, {
        signal: controller.signal,
        onProgress: (message, value) => {
          if (!mountedRef.current || operationRef.current !== operation) return;
          setStatus(message);
          setProgress(Math.max(0, Math.min(100, Number(value) || 0)));
        },
      });
      if (!mountedRef.current || operationRef.current !== operation) return;
      setText(result.text || "");
      parse(result.text || "", result.warnings || []);
      setProgress(100);
    } catch (failure) {
      if (!mountedRef.current || operationRef.current !== operation) return;
      setError(
        failure.message ||
          "This statement could not be read. Try a clearer photo or paste its text below.",
      );
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }
  function changeValue(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setSelected((current) =>
      present(value)
        ? [...new Set([...current, key])]
        : current.filter((item) => item !== key),
    );
    setReviewed(false);
  }
  function toggle(key, checked) {
    setSelected((current) =>
      checked
        ? [...new Set([...current, key])]
        : current.filter((item) => item !== key),
    );
    setReviewed(false);
  }
  async function apply() {
    if (
      !reviewed ||
      textDirty ||
      !selected.length ||
      (requiresPeriod && !periodReady)
    )
      return;
    setApplying(true);
    setError("");
    try {
      const patch = buildStatementPatch(values, selected, deal);
      const draft = { ...deal, ...patch };
      const issues = validateDeal(draft).filter(
        (issue) =>
          present(draft.businessName) || issue !== "Business name is required.",
      );
      if (issues.length) throw new Error(issues.join(" "));
      await onApply(patch);
      clear();
      setNotice(
        "Reviewed figures added. Save the customer to keep them. The original statement and recognised text have been cleared.",
      );
    } catch (failure) {
      setError(failure.message || "Check the selected figures and try again.");
    } finally {
      setApplying(false);
    }
  }

  function renderField(key) {
    const field = STATEMENT_FIELDS.find((item) => item.key === key);
    if (!field) return null;
    const numeric = !["text", "date"].includes(field.type);
    const target = TARGETS[key];
    const existing = target && present(deal[target]);
    return (
      <div
        className={`statement-field ${existing ? "statement-existing" : ""}`}
        key={key}
      >
        <label className="statement-field-toggle">
          <input
            type="checkbox"
            checked={selected.includes(key)}
            onChange={(event) => toggle(key, event.target.checked)}
            disabled={!present(values[key]) || busy || applying}
            aria-label={`Use ${field.label.toLowerCase()} from statement`}
          />
          <span>{field.label}</span>
        </label>
        <input
          className="statement-value"
          aria-label={`Statement ${field.label.toLowerCase()}`}
          type={numeric ? "number" : field.type}
          inputMode={numeric ? "decimal" : undefined}
          min={numeric ? "0" : undefined}
          step={numeric ? "any" : undefined}
          max={field.type === "rate" ? "100" : undefined}
          value={values[key] ?? ""}
          onChange={(event) => changeValue(key, event.target.value)}
          placeholder={
            key === "periodMonths"
              ? "Confirm number of months"
              : "Not found — enter if known"
          }
          disabled={busy || applying}
        />
        {evidence[key] && (
          <small className="statement-evidence">
            Found: {String(evidence[key]).slice(0, 180)}
          </small>
        )}
        {key === "periodMonths" && (
          <small>
            One full monthly statement = 1. For a partial month, enter its
            fraction of a month. Annual TPV uses this period as a run rate.
          </small>
        )}
        {existing && (
          <small className="statement-replace">
            Current saved value:{" "}
            {numeric && field.type !== "rate"
              ? currency(deal[target])
              : String(deal[target])}
            . Select this field to replace it.
          </small>
        )}
      </div>
    );
  }

  const allWarnings = [...new Set([...warnings, ...(figures.warnings || [])])];
  return (
    <section
      className="merchant-statement"
      aria-label="Merchant statement analysis"
    >
      <header className="statement-heading">
        <span>
          <FileSearch size={25} />
        </span>
        <div>
          <h3>Let the statement do the work</h3>
          <p>
            Upload the merchant’s current card-processing statement. Review the
            totals, then fill in their figures.
          </p>
        </div>
      </header>
      <div className="statement-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => uploadRef.current?.click()}
          disabled={busy || applying}
        >
          <Upload size={18} /> Upload merchant statement
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => cameraRef.current?.click()}
          disabled={busy || applying}
        >
          <Camera size={18} /> Take statement photo
        </button>
      </div>
      <input
        className="statement-file-input"
        ref={uploadRef}
        type="file"
        accept="application/pdf,image/*"
        aria-label="Upload merchant statement file"
        onChange={chooseFile}
        disabled={busy || applying}
      />
      <input
        className="statement-file-input"
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take merchant statement photo"
        onChange={chooseFile}
        disabled={busy || applying}
      />
      <p className="statement-format-hint">
        PDF or photo · up to 25 MB / 20 PDF pages. Include the summary, fee
        totals and card breakdown.
      </p>
      <div className="statement-privacy">
        <ShieldCheck size={16} />
        <p>
          The statement is read on this device. Only the reviewed figures you
          choose are saved; the original file and recognised text are not
          stored.
        </p>
      </div>
      {file && (
        <div className="statement-file">
          <FileSearch size={20} />
          <span>{file.name}</span>
          <button
            type="button"
            aria-label="Remove merchant statement"
            onClick={clear}
            disabled={busy || applying}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {file && !busy && (
        <button
          type="button"
          className="button primary statement-read"
          onClick={read}
          disabled={applying}
        >
          <FileSearch size={18} />
          {hasResults ? "Read statement again" : "Read statement and calculate"}
        </button>
      )}
      {busy && (
        <div className="statement-progress" role="status">
          <div>
            <strong>{status}</strong>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
          <progress
            max="100"
            value={progress}
            aria-label="Statement reading progress"
          />
          <small>
            The first photo scan may take longer while the reader starts.
          </small>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="statement-notice" role="status">
          <Check size={16} />
          <p>{notice}</p>
        </div>
      )}
      {saved && !hasResults && (
        <div className="statement-saved">
          <strong>A reviewed statement is recorded for this customer.</strong>
          <p>
            The totals below are available for rate comparisons. Upload a new
            statement to update them.
          </p>
          {savedFigures && <CalculatedFigures figures={savedFigures} saved />}
        </div>
      )}
      {hasResults && (
        <section
          className="statement-review"
          aria-label="Review merchant statement figures"
        >
          <h3>Check the statement figures</h3>
          <p>
            Amounts are for the full statement period in GBP. Tick the details
            to add. Existing customer figures require you to select a
            replacement.
          </p>
          <div className="statement-fields">{PRIMARY.map(renderField)}</div>
          <details
            className="statement-detail"
            open={present(values.provider) || present(values.businessName)}
          >
            <summary>Business, provider & dates</summary>
            <div className="statement-fields">
              {["businessName", "provider", "periodStart", "periodEnd"].map(
                renderField,
              )}
            </div>
          </details>
          <details
            className="statement-detail"
            open={CARD_MIX.some((key) => present(values[key]))}
          >
            <summary>Card mix & transaction count</summary>
            <div className="statement-fields">{CARD_MIX.map(renderField)}</div>
          </details>
          <details
            className="statement-detail"
            open={FEES.some((key) => present(values[key]))}
          >
            <summary>Fee breakdown</summary>
            <p>
              These are recorded separately. They are not added to the total
              charges again.
            </p>
            <div className="statement-fields">{FEES.map(renderField)}</div>
          </details>
          {allWarnings.length > 0 && (
            <div className="statement-warnings">
              <strong>Details to check</strong>
              <ul>
                {allWarnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <CalculatedFigures figures={figures} />
          {requiresPeriod && !periodReady && (
            <p className="statement-missing" role="status">
              Enter how many months the statement covers and tick that field
              before adding its amounts.
            </p>
          )}
          {textDirty && (
            <p className="statement-missing" role="status">
              The statement text has changed. Find its figures again before
              adding them.
            </p>
          )}
          <label className="statement-confirm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              disabled={busy || applying}
            />
            <span>
              I’ve checked the selected figures and statement period against the
              original.
            </span>
          </label>
          <button
            type="button"
            className="button primary statement-apply"
            disabled={
              !reviewed ||
              textDirty ||
              !selected.length ||
              (requiresPeriod && !periodReady) ||
              applying ||
              busy
            }
            onClick={apply}
          >
            <Check size={18} />
            {applying ? "Adding figures…" : "Use selected statement figures"}
          </button>
          <p className="statement-format-hint">
            Figures fill the customer draft. Save the customer to keep them. AC
            prices and declared commission TPV stay separate.
          </p>
        </section>
      )}
      <details className="statement-detail statement-text">
        <summary>Paste or correct the statement text</summary>
        <p>
          Use this if a photo is unclear or a PDF cannot be read. Include the
          totals and statement period.
        </p>
        <textarea
          aria-label="Merchant statement text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setReviewed(false);
            setTextDirty(true);
          }}
          rows={7}
          maxLength={200000}
          placeholder="Paste the card-processing statement text here"
          disabled={busy || applying}
        />
        <button
          type="button"
          className="button secondary"
          onClick={() => parse(text)}
          disabled={!text.trim() || busy || applying}
        >
          Find statement figures in this text
        </button>
      </details>
    </section>
  );
}
