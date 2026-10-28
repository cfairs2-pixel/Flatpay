import React, { useState } from "react";
import {
  ExternalLink,
  ClipboardList,
  Upload,
  Check,
  ArrowRight,
} from "lucide-react";
import { conduktDocumentSummary } from "../shared/condukt.mjs";
async function api(path, body) {
  const r = await fetch(`/api/condukt/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
export default function ConduktWorkspace({ deals = [], onSaved }) {
  const [input, setInput] = useState(""),
    [preview, setPreview] = useState(null),
    [selected, setSelected] = useState(0),
    [fields, setFields] = useState([]),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const candidate = preview?.candidates?.[selected];
  function choose(p, index = 0) {
    setSelected(index);
    const c = p.candidates[index];
    setFields(
      c?.fieldChanges.filter((f) => !f.conflict).map((f) => f.path) || [],
    );
    setTarget(c?.match?.dealId || "");
  }
  async function review() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const p = await api("preview", { input });
      setPreview(p);
      choose(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const result = await api("apply", {
        input,
        candidateIndex: selected,
        fieldPaths: fields,
        dealId: target || undefined,
        includeDocumentTasks: true,
      });
      onSaved(result.deals);
      setNotice(
        "Reviewed details and document statuses saved to your account.",
      );
      setPreview(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="condukt-workspace">
      <div className="tools-intro">
        <ClipboardList size={28} />
        <div>
          <h2>Condukt details and document follow-up</h2>
          <p>
            Website access · reviewed manual updates. Statuses below reflect the
            last saved check.
          </p>
        </div>
        <a
          className="button secondary"
          href="https://portal.condukt.co/"
          target="_blank"
          rel="noreferrer"
        >
          Open Condukt <ExternalLink size={16} />
        </a>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          <Check size={17} />
          {notice}
        </div>
      )}
      <section className="panel condukt-import">
        <h3>Prepopulate a customer</h3>
        <p>
          Paste labelled details copied from Condukt, or load a myflatpay
          interchange JSON file. You review every field before saving. This does
          not sign in to Condukt or fetch live statuses.
        </p>
        <label className="field">
          <span>Copied Condukt details or interchange JSON</span>
          <textarea
            rows={7}
            maxLength={200000}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setPreview(null);
            }}
            placeholder={
              "Company name: Example Coffee\nContact name: Alex Example\nCurrent provider: Dojo\nRequest ID: case-reference\nDocument: Alex Example | Proof of address | Required"
            }
          />
        </label>
        <div className="cloud-actions">
          <label className="button secondary">
            Load JSON file <Upload size={16} />
            <input
              hidden
              type="file"
              accept="application/json,.json,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 200000)
                    throw Error("Choose a file under 200 KB.");
                  setInput(await file.text());
                  setPreview(null);
                } catch (error) {
                  setError(error.message);
                }
                e.target.value = "";
              }}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !input.trim()}
            onClick={review}
          >
            {busy ? "Reading…" : "Review suggested details"}
            <ArrowRight size={16} />
          </button>
        </div>
        <small>
          Only recognised company/contact fields and status references are
          stored. Keep identity scans and bank documents in the authorised
          onboarding system.
        </small>
      </section>
      {candidate && (
        <section className="panel condukt-import">
          <h3>Review before applying</h3>
          {preview.candidates.length > 1 && (
            <label className="field">
              <span>Imported customer</span>
              <select
                value={selected}
                onChange={(e) => choose(preview, Number(e.target.value))}
              >
                {preview.candidates.map((c, i) => (
                  <option key={c.candidateId} value={i}>
                    {c.suggestedFields.businessName || `Customer ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Customer to update</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Create a new customer</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.businessName}
                </option>
              ))}
            </select>
          </label>
          <p>
            Existing values are preserved unless you select a replacement.
            Verify the chosen customer before applying.
          </p>
          {candidate.fieldChanges.map((f) => (
            <label className="check-row" key={f.path}>
              <input
                type="checkbox"
                checked={fields.includes(f.path)}
                onChange={(e) =>
                  setFields((s) =>
                    e.target.checked
                      ? [...s, f.path]
                      : s.filter((x) => x !== f.path),
                  )
                }
              />
              <span>
                <strong>{f.label}</strong>: {f.suggestedValue}
                {f.conflict && (
                  <small>Replaces recorded value: {f.currentValue}</small>
                )}
              </span>
            </label>
          ))}
          <h3>Recorded document requirements</h3>
          {candidate.documentTasks.length ? (
            candidate.documentTasks.map((t) => (
              <p key={t.id}>
                {t.personName || "Business"} · {t.label || t.type} ·{" "}
                <strong>{t.status}</strong>
              </p>
            ))
          ) : (
            <p>No explicit document requirements recognised.</p>
          )}
          {candidate.warnings?.map((w, i) => (
            <p className="tool-caption" key={i}>
              {w}
            </p>
          ))}
          <button className="button primary" disabled={busy} onClick={apply}>
            Apply reviewed details
            <Check size={16} />
          </button>
        </section>
      )}
      <div className="tools-card-grid">
        {deals
          .filter((d) => d.condukt)
          .map((d) => {
            const s = conduktDocumentSummary(d);
            return (
              <article className="panel condukt-case" key={d.id}>
                <h3>{d.businessName}</h3>
                <small>
                  Last recorded check:{" "}
                  {s.lastCheckedAt
                    ? new Date(s.lastCheckedAt).toLocaleString("en-GB")
                    : "Not recorded"}
                </small>
                <p>
                  {s.outstanding.length} outstanding · {s.awaitingReview.length}{" "}
                  submitted · {s.needsReview.length} need review
                </p>
                {s.outstanding.map((t) => (
                  <p key={t.id}>
                    <strong>{t.personName || "Business"}</strong> ·{" "}
                    {t.label || t.type} · {t.status}
                  </p>
                ))}
                {d.condukt.url && (
                  <a
                    className="text-button"
                    href={d.condukt.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open saved request
                    <ExternalLink size={14} />
                  </a>
                )}
              </article>
            );
          })}
      </div>
      {!deals.some((d) => d.condukt) && (
        <div className="empty-state">
          <h3>Your document follow-ups will appear here.</h3>
          <p>
            Review a Condukt snapshot to start tracking who needs to supply
            documents.
          </p>
        </div>
      )}
    </div>
  );
}
