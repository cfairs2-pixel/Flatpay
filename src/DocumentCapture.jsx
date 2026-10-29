import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImagePlus,
  ScanLine,
  X,
  Check,
  ShieldCheck,
  RefreshCw,
  FileText,
  CreditCard,
  IdCard,
} from "lucide-react";
import { createWorker } from "tesseract.js";
import {
  parseDocumentText,
  buildDocumentPatch,
} from "../shared/document-prefill.mjs";
import "./capture.css";

const TYPES = [
  { id: "passport", label: "Passport", Icon: IdCard },
  { id: "licence", label: "Driving licence", Icon: CreditCard },
  { id: "bank", label: "Bank statement", Icon: FileText },
];
const readPath = (value, path) =>
  path.split(".").reduce((result, key) => result?.[key], value);
const sameValue = (a, b) =>
  String(a || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase() ===
  String(b || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
function defaultSelection(suggestions, deal) {
  return suggestions
    .filter(
      (suggestion) =>
        suggestion.confidence === "high" &&
        suggestion.value?.trim() &&
        !String(readPath(deal, suggestion.path) || "").trim(),
    )
    .map((suggestion) => suggestion.path);
}
function readerStatus(status) {
  if (/recogniz/i.test(status)) return "Reading your photo";
  if (/language/i.test(status)) return "Preparing the document reader";
  if (/core|initializ|loading/i.test(status))
    return "Starting the document reader";
  return "Preparing your photo";
}
async function prepareImage(file) {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    if (ratio === 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.94),
    );
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export default function DocumentCapture({ deal = {}, onApply }) {
  const [type, setType] = useState("passport");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applying, setApplying] = useState(false);
  const workerRef = useRef(null);
  const cancelReadRef = useRef(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelReadRef.current?.();
      cancelReadRef.current = null;
      operationRef.current += 1;
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) Promise.resolve(worker.terminate()).catch(() => {});
    };
  }, []);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function resetResults() {
    setSuggestions([]);
    setSelected([]);
    setWarnings([]);
    setError("");
    setNotice("");
  }
  function changeType(next) {
    if (busy) return;
    setType(next);
    resetResults();
    if (text.trim()) updateSuggestions(text, next);
  }
  function chooseFile(event) {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next) return;
    resetResults();
    setText("");
    setFile(null);
    setPreviewUrl("");
    if (
      !/^image\//i.test(next.type) &&
      !/\.(jpe?g|png|webp|bmp|gif|avif|heic|heif)$/i.test(next.name)
    ) {
      setError(
        "Choose a photo, such as a JPEG or PNG. Photograph the page if you have a PDF.",
      );
      return;
    }
    if (next.size > 12 * 1024 * 1024) {
      setError(
        "Choose a photo under 12 MB, or take a new photo at a lower resolution.",
      );
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }
  function updateSuggestions(value = text, documentType = type) {
    try {
      const result = parseDocumentText(value, documentType);
      setSuggestions(result.suggestions);
      setSelected(defaultSelection(result.suggestions, deal));
      setWarnings(result.warnings || []);
      setError("");
      if (!result.suggestions.length)
        setNotice(
          "No clear details found yet. Retake the photo or correct the recognised text below.",
        );
      else setNotice("");
    } catch (failure) {
      setError(
        failure.message ||
          "These details could not be read. Try a clearer photo.",
      );
    }
  }
  async function cancel() {
    operationRef.current += 1;
    cancelReadRef.current?.();
    cancelReadRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;
    setBusy(false);
    setStatus("");
    setProgress(0);
    if (worker) await Promise.resolve(worker.terminate()).catch(() => {});
  }
  async function clear() {
    await cancel();
    setFile(null);
    setPreviewUrl("");
    setText("");
    resetResults();
  }
  async function scan() {
    if (!file || busy) return;
    const operation = ++operationRef.current;
    const isCurrent = () =>
      mountedRef.current && operationRef.current === operation;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(0);
    setStatus("Preparing your photo");
    setText("");
    setSuggestions([]);
    setSelected([]);
    setWarnings([]);
    let worker;
    const cancelled = new Promise((_, reject) => {
      cancelReadRef.current = () => reject(new Error("Scan cancelled"));
    });
    try {
      const image = await Promise.race([prepareImage(file), cancelled]);
      if (!isCurrent()) return;
      const base = new URL(
        import.meta.env.BASE_URL || "./",
        window.location.href,
      );
      const assets = new URL("ocr/", base).href;
      const pendingWorker = createWorker("eng", 1, {
        workerPath: `${assets}worker.min.js`,
        corePath: `${assets}core/`,
        langPath: `${assets}lang/`,
        workerBlobURL: false,
        legacyCore: false,
        gzip: true,
        logger: (update) => {
          if (!isCurrent()) return;
          setStatus(readerStatus(update.status || ""));
          if (/recogniz/i.test(update.status || ""))
            setProgress(
              Math.max(
                0,
                Math.min(100, Math.round((update.progress || 0) * 100)),
              ),
            );
        },
      });
      pendingWorker.then(
        (created) => {
          if (!isCurrent())
            Promise.resolve(created.terminate()).catch(() => {});
        },
        () => {},
      );
      worker = await Promise.race([pendingWorker, cancelled]);
      if (!isCurrent()) {
        await worker.terminate();
        return;
      }
      workerRef.current = worker;
      await Promise.race([
        worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        cancelled,
      ]);
      const result = await Promise.race([worker.recognize(image), cancelled]);
      if (!isCurrent()) return;
      const recognised =
        typeof result.data?.text === "string"
          ? result.data.text.slice(0, 50000)
          : "";
      setText(recognised);
      setProgress(100);
      setStatus("Photo read. Check the suggested details.");
      updateSuggestions(recognised);
    } catch {
      if (isCurrent())
        setError(
          "The photo could not be read. Try a sharp, well-lit JPEG or PNG with the whole document visible. You can also paste text copied from your phone’s photo viewer below.",
        );
    } finally {
      if (workerRef.current === worker) workerRef.current = null;
      if (worker) await Promise.resolve(worker.terminate()).catch(() => {});
      if (isCurrent()) {
        cancelReadRef.current = null;
        setBusy(false);
      }
    }
  }
  async function apply() {
    if (!selected.length || !onApply) return;
    setApplying(true);
    setError("");
    try {
      const patch = buildDocumentPatch(suggestions, selected, deal);
      await onApply(patch);
      setFile(null);
      setPreviewUrl("");
      setText("");
      setSuggestions([]);
      setSelected([]);
      setWarnings([]);
      setNotice(
        "Selected details added. Save the customer to keep them. The photo and recognised text have been cleared.",
      );
    } catch (failure) {
      setError(
        failure.message ||
          "These details could not be added. Check the selected fields and try again.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <section
      className="document-capture"
      aria-label="Scan onboarding documents"
    >
      <header className="capture-heading">
        <span className="capture-heading-icon">
          <ScanLine size={24} />
        </span>
        <div>
          <h3>Scan instead of typing</h3>
          <p>
            Take a clear photo, check the details, then choose what to fill in.
          </p>
        </div>
      </header>
      <div className="capture-types" aria-label="Document type">
        {TYPES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={type === id ? "selected" : ""}
            aria-pressed={type === id}
            onClick={() => changeType(id)}
            disabled={busy}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="capture-privacy">
        <ShieldCheck size={17} />
        <p>
          Photos are read on this device. Only the details you choose are saved;
          document photos and numbers are not stored.
        </p>
      </div>
      <div className="capture-tips">
        <strong>
          {type === "passport"
            ? "Include both lines of letters at the bottom."
            : type === "licence"
              ? "Photograph the front, including the name and address."
              : "Include the account holder’s name and address."}
        </strong>
        <p>
          Lay it flat in good light. Keep all edges visible and avoid glare.
        </p>
      </div>
      <input
        ref={cameraRef}
        className="capture-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a document photo"
        onChange={chooseFile}
        disabled={busy}
      />
      <input
        ref={uploadRef}
        className="capture-file-input"
        type="file"
        accept="image/*"
        aria-label="Upload a document photo"
        onChange={chooseFile}
        disabled={busy}
      />
      <div className="capture-actions">
        <button
          type="button"
          className="button primary"
          onClick={() => cameraRef.current?.click()}
          disabled={busy}
        >
          <Camera size={19} /> Take photo
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => uploadRef.current?.click()}
          disabled={busy}
        >
          <ImagePlus size={19} /> Upload photo
        </button>
      </div>
      {previewUrl && (
        <div className="capture-photo">
          <img src={previewUrl} alt="Selected document photo" />
          <button
            type="button"
            className="capture-remove"
            onClick={clear}
            aria-label="Remove document photo"
            disabled={applying}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {file && !busy && (
        <button
          type="button"
          className="button primary capture-read"
          onClick={scan}
        >
          <ScanLine size={18} />
          {text ? "Read photo again" : "Read details from photo"}
        </button>
      )}
      {busy && (
        <div className="capture-progress" role="status">
          <div>
            <strong>{status}</strong>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
          <progress
            max="100"
            value={progress}
            aria-label="Document reading progress"
          />
          <small>
            {progress
              ? `${progress}%`
              : "The first scan may take a little longer while the reader starts."}
          </small>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice capture-notice" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {suggestions.length > 0 && (
        <section className="capture-review" aria-label="Review scanned details">
          <div className="capture-review-heading">
            <h3>Choose details to fill in</h3>
            <small>
              Existing details stay unchanged unless you select a replacement.
            </small>
          </div>
          {suggestions.map((suggestion, index) => {
            const current = String(readPath(deal, suggestion.path) || ""),
              conflict =
                !!current.trim() && !sameValue(current, suggestion.value),
              alreadySaved =
                !!current.trim() && sameValue(current, suggestion.value);
            return (
              <div
                className={`capture-suggestion ${conflict ? "has-conflict" : ""}`}
                key={suggestion.path}
              >
                <label className="capture-field-choice">
                  <input
                    type="checkbox"
                    checked={selected.includes(suggestion.path)}
                    onChange={(event) =>
                      setSelected((values) =>
                        event.target.checked
                          ? [...values, suggestion.path]
                          : values.filter((value) => value !== suggestion.path),
                      )
                    }
                    disabled={alreadySaved || !suggestion.value.trim()}
                  />
                  <span>
                    <strong>{suggestion.label}</strong>
                    <small>
                      {alreadySaved
                        ? "Already saved"
                        : suggestion.confidence === "high"
                          ? "Recognised from this document"
                          : "Please check carefully"}
                    </small>
                  </span>
                </label>
                <input
                  aria-label={`Scanned ${suggestion.label.toLowerCase()}`}
                  value={suggestion.value}
                  maxLength={suggestion.path.includes("Address") ? 2000 : 300}
                  autoComplete="off"
                  onChange={(event) => {
                    const value = event.target.value;
                    setSuggestions((values) =>
                      values.map((item, i) =>
                        i === index ? { ...item, value } : item,
                      ),
                    );
                    if (!value.trim())
                      setSelected((values) =>
                        values.filter((path) => path !== suggestion.path),
                      );
                  }}
                />
                {conflict && (
                  <small className="capture-existing">
                    Currently saved: {current}
                  </small>
                )}
                <small className="capture-source">
                  {suggestion.reason || suggestion.source}
                </small>
              </div>
            );
          })}
          {warnings.map((warning, index) => (
            <p className="capture-warning" key={index}>
              {warning}
            </p>
          ))}
          <button
            type="button"
            className="button primary capture-apply"
            disabled={!selected.length || applying}
            onClick={apply}
          >
            <Check size={18} />
            {applying
              ? "Adding…"
              : `Use ${selected.length || "checked"} ${selected.length === 1 ? "detail" : "details"}`}
          </button>
        </section>
      )}
      {!suggestions.length &&
        warnings.map((warning, index) => (
          <p className="capture-warning" key={index}>
            {warning}
          </p>
        ))}
      <details className="capture-text">
        <summary>
          <FileText size={16} />
          {text
            ? "Check or correct the recognised text"
            : "Or paste text copied from a photo"}
        </summary>
        <label className="field">
          <span>Document text for this scan</span>
          <textarea
            value={text}
            rows={7}
            maxLength={50000}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste text from your phone’s photo viewer, or correct any reading errors here."
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !text.trim()}
          onClick={() => updateSuggestions()}
        >
          <RefreshCw size={15} /> Find details in this text
        </button>
        <small>
          This text stays on this screen and is cleared when you leave.
        </small>
      </details>
      {(file || text) && !busy && (
        <button
          type="button"
          className="text-button capture-clear"
          onClick={clear}
        >
          <X size={15} /> Clear this scan
        </button>
      )}
      <p className="capture-footnote">
        Scanning fills details. It does not verify identity or complete the
        onboarding checklist.
      </p>
    </section>
  );
}
