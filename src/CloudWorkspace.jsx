import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Cloud,
  Users,
  UserPlus,
  LogOut,
  ShieldCheck,
  FileText,
  Upload,
  Check,
  Copy,
  Trash2,
  Code2,
  Play,
  Plus,
  Download,
  X,
  BookOpen,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { monthlySummary } from "../shared/domain.mjs";
import "./cloud.css";

async function api(route, method = "GET", body) {
  const res = await fetch(route, {
    method,
    credentials: "same-origin",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error(
      "The server returned an unreadable response. Please try again.",
    );
  }
  if (!res.ok) {
    if (res.status === 401)
      window.dispatchEvent(new Event("myflatpay:session-expired"));
    throw Error(
      data.errors?.join(" ") ||
        data.error ||
        "The server could not complete this request.",
    );
  }
  return data;
}
const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
const asDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }).format(new Date(value))
    : "—";
const owner = (user) => user?.role === "owner";
function Feedback({ error, notice }) {
  return (
    <>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice cloud-success" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </>
  );
}
function Empty({ icon: Icon = FileText, title, children }) {
  return (
    <div className="cloud-empty">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Loading() {
  return (
    <div className="cloud-loading" role="status">
      <Cloud size={20} /> Connecting to your workspace…
    </div>
  );
}

export function CloudAccountGate({ children }) {
  const [state, setState] = useState(null),
    [mode, setMode] = useState(
      new URLSearchParams(location.search).has("invite") ? "signup" : "login",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    setupToken: "",
    inviteCode: new URLSearchParams(location.search).get("invite") || "",
  });
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));
  async function refresh() {
    try {
      const data = await api("/api/auth/me");
      setState(data);
      if (data.needsSetup) setMode("signup");
    } catch (e) {
      setError(e.message);
      setState({ user: null, needsSetup: false, setupAvailable: false });
    }
  }
  useEffect(() => {
    refresh();
    const expired = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener("myflatpay:session-expired", expired);
    return () =>
      window.removeEventListener("myflatpay:session-expired", expired);
  }, []);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/auth/${mode}`,
        "POST",
        mode === "login"
          ? { email: form.email, password: form.password }
          : form,
      );
      await refresh();
      setForm((s) => ({ ...s, password: "", setupToken: "" }));
      if (location.search.includes("invite="))
        history.replaceState(null, "", location.pathname);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function onSignOut() {
    setBusy(true);
    try {
      await api("/api/auth/logout", "POST", {});
      setState((s) => ({ ...s, user: null }));
      setMode("login");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div className="cloud-auth-page">
        <Loading />
      </div>
    );
  if (state.user)
    return (
      <>
        {error && (
          <div className="cloud-session-error" role="alert">
            {error}
          </div>
        )}
        {typeof children === "function"
          ? children({ user: state.user, onSignOut })
          : children}
      </>
    );
  return (
    <main className="cloud-auth-page">
      <section className="cloud-auth-story">
        <a className="cloud-wordmark" href="./">
          myflatpay
        </a>
        <span className="cloud-kicker">YOUR SALES WORKSPACE</span>
        <h1>
          Your sales.
          <br />
          Wherever you are.
        </h1>
        <p>
          Keep your customers, meeting notes and next moves together. Sign in on
          another device and pick up where you left off.
        </p>
        <div className="cloud-auth-benefits">
          <span>
            <Cloud size={19} />
            Server-saved customer records
          </span>
          <span>
            <Users size={19} />
            Your own account and sales
          </span>
          <span>
            <BookOpen size={19} />
            Head-office guidance in one place
          </span>
        </div>
      </section>
      <section className="cloud-auth-card">
        <span className="cloud-auth-symbol">
          <ShieldCheck size={26} />
        </span>
        <h2>
          {state.needsSetup
            ? "Set up your team workspace"
            : mode === "signup"
              ? "Join your myflatpay team"
              : "Welcome back."}
        </h2>
        <p>
          {state.needsSetup
            ? "Create the first owner account using the workspace setup token."
            : mode === "signup"
              ? "Use the invitation code provided by your team owner."
              : "Sign in to your personal sales account."}
        </p>
        <Feedback error={error} />
        {state.needsSetup && !state.setupAvailable ? (
          <div className="notice">
            Workspace setup is not enabled yet. The server needs its setup token
            configured before the first owner can register.
          </div>
        ) : (
          <form onSubmit={submit} className="cloud-form">
            {mode === "signup" && (
              <label className="field">
                <span>Your name</span>
                <input
                  required
                  maxLength={200}
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                required
                autoComplete="email"
                maxLength={300}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 12 : undefined}
                maxLength={200}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
              {mode === "signup" && <small>Use at least 12 characters.</small>}
            </label>
            {mode === "signup" &&
              (state.needsSetup ? (
                <label className="field">
                  <span>Workspace setup token</span>
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    value={form.setupToken}
                    onChange={(e) => set("setupToken", e.target.value)}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Invitation code</span>
                  <input
                    required
                    autoComplete="off"
                    value={form.inviteCode}
                    onChange={(e) => set("inviteCode", e.target.value)}
                  />
                </label>
              ))}
            <button className="button primary" disabled={busy} type="submit">
              {busy
                ? "Connecting…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
        {!state.needsSetup && (
          <button
            type="button"
            className="text-button cloud-auth-switch"
            onClick={() => {
              setMode(mode === "signup" ? "login" : "signup");
              setError("");
            }}
          >
            {mode === "signup"
              ? "Already have an account? Sign in"
              : "Have an invitation? Create your account"}
          </button>
        )}
      </section>
    </main>
  );
}

export function TeamPage({ user }) {
  const [team, setTeam] = useState(null),
    [summary, setSummary] = useState(null),
    [email, setEmail] = useState(""),
    [invite, setInvite] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      const [data, stats] = await Promise.all([
        api("/api/team"),
        api("/api/team/summary"),
      ]);
      setTeam(data);
      setSummary(stats);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (owner(user)) load();
  }, [user?.id]);
  if (!owner(user))
    return (
      <Empty icon={Users} title="Your personal sales account">
        Your customer records and sales belong to your account. Team
        administration is available to the workspace owner.
      </Empty>
    );
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/team/invites", "POST", {
        email: email.trim(),
      });
      setInvite({ ...result, email: email.trim() });
      setEmail("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    setError("");
    try {
      await api(`/api/team/invites/${id}`, "DELETE");
      setInvite((s) => (s && (s.id === id || s.inviteId === id) ? null : s));
      setNotice("Invitation revoked.");
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied. You can share it with your colleague.");
    } catch {
      setNotice("Select and copy the invitation below.");
    }
  }
  const invitations = team?.pendingInvitations || team?.invitations || [];
  const members = summary?.members || [];
  const inviteLink = invite?.inviteCode
    ? `${location.origin}${location.pathname}?invite=${encodeURIComponent(invite.inviteCode)}`
    : "";
  return (
    <div className="cloud-page">
      <Feedback error={error} notice={notice} />
      <div className="cloud-intro">
        <span className="cloud-intro-icon">
          <Users size={25} />
        </span>
        <div>
          <h2>A team with room to grow.</h2>
          <p>
            Invite colleagues to their own sales account. Each salesperson sees
            their own customers; you can review the team’s progress.
          </p>
        </div>
      </div>
      <div className="cloud-two-column">
        <section className="panel cloud-section">
          <h2>Invite a salesperson</h2>
          <p>
            Create an invitation, then share the link or code with your
            colleague.
          </p>
          <form onSubmit={create} className="cloud-form">
            <label className="field">
              <span>Colleague’s email</span>
              <input
                type="email"
                required
                maxLength={300}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </label>
            <button className="button primary" disabled={busy}>
              <UserPlus size={16} />
              {busy ? "Creating…" : "Create invitation"}
            </button>
          </form>
          {invite && (
            <div className="cloud-invite-result">
              <strong>Invitation for {invite.email}</strong>
              <p>
                Expires {asDate(invite.expiresAt)}. This code is shown once.
              </p>
              <label className="field">
                <span>Invitation link</span>
                <input readOnly value={inviteLink} />
              </label>
              <button
                type="button"
                className="button secondary small"
                onClick={() => copy(inviteLink)}
              >
                <Copy size={14} />
                Copy invitation link
              </button>
              <details>
                <summary>Invitation code</summary>
                <code>{invite.inviteCode}</code>
              </details>
            </div>
          )}
        </section>
        <section className="panel cloud-section">
          <h2>Pending invitations</h2>
          {!team ? (
            <Loading />
          ) : !invitations.length ? (
            <p>No pending invitations.</p>
          ) : (
            <div className="cloud-list">
              {invitations.map((i) => (
                <div className="cloud-list-row" key={i.id}>
                  <div>
                    <strong>{i.email}</strong>
                    <small>Expires {asDate(i.expiresAt || i.expires_at)}</small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Revoke invitation for ${i.email}`}
                    onClick={() => revoke(i.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel cloud-section">
        <div className="cloud-section-heading">
          <div>
            <h2>Team progress</h2>
            <p>
              {summary?.month
                ? `Sales won in ${summary.month}`
                : "Current reporting month"}
            </p>
          </div>
          <button className="text-button" onClick={load}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
        {members.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Salesperson</th>
                  <th>Sales won</th>
                  <th>Active opportunities</th>
                  <th>Signed monthly volume</th>
                  <th>Confirmed commission</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small className="cloud-cell-email">
                        {m.email} · {m.role}
                      </small>
                    </td>
                    <td>{m.wonCount || 0}</td>
                    <td>{m.activeCount || 0}</td>
                    <td>{money(m.monthlyVolume)}</td>
                    <td>{money(m.confirmedCommission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cloud-list">
            {(team?.users || []).map((m) => (
              <div className="cloud-list-row" key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>{m.email}</small>
                </div>
                <span className="cloud-pill">{m.role}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const textExtensions = /\.(txt|md|csv|json)$/i;
const knownMime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("The document could not be read."));
    reader.onload = () =>
      resolve(String(reader.result).split(",").slice(1).join(","));
    reader.readAsDataURL(file);
  });
const blankDocument = () => ({
  title: "",
  source: "Head office",
  effectiveDate: "",
  versionLabel: "",
  content: "",
  fileName: "",
  mimeType: "",
  fileBase64: "",
  supersedesId: "",
});
export function DocumentsPage({ user }) {
  const [documents, setDocuments] = useState(null),
    [draft, setDraft] = useState(blankDocument),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [uploading, setUploading] = useState(false);
  const fileRef = useRef(null),
    set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  async function load() {
    try {
      const data = await api("/api/documents");
      setDocuments(Array.isArray(data) ? data : data.documents || []);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, [user?.id]);
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      if (file.size > 5 * 1024 * 1024)
        throw Error("Choose a document of 5 MB or less.");
      const ext = file.name.split(".").at(-1).toLowerCase();
      if (!knownMime[ext])
        throw Error("Choose a PDF, DOCX, TXT, Markdown, CSV or JSON document.");
      const [fileBase64, content] = await Promise.all([
        fileToBase64(file),
        textExtensions.test(file.name) ? file.text() : Promise.resolve(""),
      ]);
      if (content.length > 200000)
        throw Error(
          "The document text exceeds 200,000 characters. Use a smaller document or upload a reviewed extract.",
        );
      setDraft((s) => ({
        ...s,
        title: s.title || file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: knownMime[ext],
        fileBase64,
        content,
      }));
    } catch (e) {
      setError(e.message);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }
  async function upload(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api("/api/documents", "POST", draft),
        doc = data.document || data;
      setSelected(doc);
      setDraft(blankDocument());
      if (fileRef.current) fileRef.current.value = "";
      setUploading(false);
      setNotice(
        doc.content
          ? "Document uploaded as a draft. Review its text before approving it for the assistant."
          : "Original document uploaded. Add or review extracted text before approval.",
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveReviewedText(doc) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/documents/${doc.id}`, "PUT", {
        content: doc.content,
        title: doc.title,
        source: doc.source,
        effectiveDate: doc.effectiveDate,
        versionLabel: doc.versionLabel,
      });
      setSelected(result.document || result);
      setNotice(
        "Reviewed text saved. You can now approve this document for the assistant.",
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(doc) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/documents/${doc.id}`, "PUT", {
        content: doc.content,
        title: doc.title,
        source: doc.source,
        effectiveDate: doc.effectiveDate,
        versionLabel: doc.versionLabel,
      });
      const result = await api(`/api/documents/${doc.id}/review`, "POST", {
        approved: true,
      });
      setSelected(result.document || result);
      setNotice(
        "Document approved. Its current guidance is available to the assistant.",
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(doc) {
    setError("");
    try {
      await api(`/api/documents/${doc.id}`, "DELETE");
      setSelected(null);
      setNotice("Document removed.");
      await load();
    } catch (e) {
      setError(e.message);
    }
  }
  function newVersion(doc) {
    setDraft({
      ...blankDocument(),
      title: doc.title,
      source: doc.source || "Head office",
      supersedesId: doc.id,
    });
    setSelected(null);
    setUploading(true);
  }
  return (
    <div className="cloud-page">
      <Feedback error={error} notice={notice} />
      <div className="cloud-intro">
        <span className="cloud-intro-icon">
          <BookOpen size={25} />
        </span>
        <div>
          <h2>The latest guidance. A shared reference.</h2>
          <p>
            Head-office documents give your assistant a source to quote. Pricing
            and commission formulas change only after a reviewed code update.
          </p>
        </div>
        {owner(user) && (
          <button
            className="button primary"
            onClick={() => {
              setUploading((s) => !s);
              setSelected(null);
            }}
          >
            <Upload size={16} />
            Upload document
          </button>
        )}
      </div>
      {owner(user) && uploading && (
        <section className="panel cloud-section">
          <div className="cloud-section-heading">
            <h2>
              {draft.supersedesId
                ? "Upload a new version"
                : "Add a head-office document"}
            </h2>
            <button
              className="icon-button"
              aria-label="Close document upload"
              onClick={() => setUploading(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form onSubmit={upload} className="cloud-form">
            <label className="cloud-file-picker">
              <Upload size={23} />
              <strong>{draft.fileName || "Choose a document"}</strong>
              <span>PDF, DOCX, TXT, Markdown, CSV or JSON · up to 5 MB</span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,.json"
                aria-label="Head-office document file"
                onChange={chooseFile}
              />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Document title</span>
                <input
                  required
                  maxLength={300}
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Version label</span>
                <input
                  maxLength={100}
                  value={draft.versionLabel}
                  onChange={(e) => set("versionLabel", e.target.value)}
                  placeholder="e.g. November sales guide"
                />
              </label>
              <label className="field">
                <span>Source</span>
                <input
                  maxLength={300}
                  value={draft.source}
                  onChange={(e) => set("source", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Effective date</span>
                <input
                  type="date"
                  value={draft.effectiveDate}
                  onChange={(e) => set("effectiveDate", e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>Reviewed document text</span>
              <textarea
                rows={8}
                maxLength={200000}
                aria-label="Reviewed document text"
                value={draft.content}
                onChange={(e) => set("content", e.target.value)}
                placeholder="Text files are read here. PDF and Word text is extracted by the server when available; you can paste a reviewed extract."
              />
              <small>
                The original file is preserved. Review extracted text before
                approving it for assistant answers.
              </small>
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={busy || (!draft.content.trim() && !draft.fileBase64)}
            >
              {busy ? "Uploading…" : "Save document draft"}
              <ArrowRight size={16} />
            </button>
          </form>
        </section>
      )}
      {selected && (
        <section className="panel cloud-section cloud-document-reader">
          <div className="cloud-section-heading">
            <div>
              <span
                className={`cloud-pill ${selected.status === "approved" ? "is-approved" : ""}`}
              >
                {selected.status === "approved" ? "Approved" : "Draft"} ·
                Version {selected.versionLabel || selected.version || 1}
              </span>
              <h2>{selected.title}</h2>
              <p>
                {selected.source || "Head office"}
                {selected.effectiveDate
                  ? ` · Effective ${selected.effectiveDate}`
                  : ""}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Close document"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
          </div>
          {owner(user) && selected.status !== "approved" ? (
            <label className="field cloud-reviewed-document">
              <span>Review extracted document text</span>
              <textarea
                aria-label="Review extracted document text"
                rows={12}
                maxLength={200000}
                value={selected.content || ""}
                onChange={(e) =>
                  setSelected((s) => ({ ...s, content: e.target.value }))
                }
                placeholder="Review extracted text, correct errors, or paste an approved extract of the document."
              />
              <small>
                Save your reviewed text before approving this document.
              </small>
            </label>
          ) : selected.content ? (
            <pre>{selected.content}</pre>
          ) : (
            <div className="notice">This file has no searchable text yet.</div>
          )}
          <div className="cloud-actions">
            {owner(user) && selected.status !== "approved" && (
              <button
                className="button secondary small"
                disabled={busy || !selected.content?.trim()}
                onClick={() => saveReviewedText(selected)}
              >
                Save reviewed text
              </button>
            )}
            {selected.hasFile && (
              <a
                className="button secondary small"
                href={`/api/documents/${selected.id}/file`}
                download
              >
                <Download size={15} />
                Download original
              </a>
            )}
            {owner(user) && selected.status !== "approved" && (
              <button
                className="button primary small"
                disabled={busy || !selected.content?.trim()}
                onClick={() => approve(selected)}
              >
                <Check size={15} />
                Approve for assistant
              </button>
            )}
            {owner(user) && (
              <>
                <button
                  className="button secondary small"
                  onClick={() => newVersion(selected)}
                >
                  <Plus size={15} />
                  Upload new version
                </button>
                <button
                  className="text-button cloud-delete"
                  onClick={() => remove(selected)}
                >
                  <Trash2 size={15} />
                  Delete document
                </button>
              </>
            )}
          </div>
          <p className="cloud-small">
            Approved documents guide answers. They do not overwrite the app’s
            commission calculator or automatically change live pricing.
          </p>
        </section>
      )}
      {!documents ? (
        <Loading />
      ) : !documents.length ? (
        <Empty icon={BookOpen} title="Your shared library starts here">
          {owner(user)
            ? "Upload current head-office guidance, review the extracted text, then approve it for your team."
            : "Approved head-office guidance will appear here."}
        </Empty>
      ) : (
        <div className="cloud-document-grid">
          {documents.map((doc) => (
            <button
              className="cloud-document-card"
              key={doc.id}
              onClick={() => setSelected(doc)}
            >
              <span className="cloud-document-icon">
                <FileText size={23} />
              </span>
              <span
                className={`cloud-pill ${doc.status === "approved" ? "is-approved" : ""}`}
              >
                {doc.status === "approved"
                  ? doc.isCurrent === false
                    ? "Previous version"
                    : "Approved"
                  : "Draft"}
              </span>
              <h3>{doc.title}</h3>
              <p>
                {doc.source || "Head office"} ·{" "}
                {doc.versionLabel || `Version ${doc.version || 1}`}
              </p>
              <small>
                {doc.hasText
                  ? "Searchable text available"
                  : "Text review needed"}
                {doc.effectiveDate ? ` · Effective ${doc.effectiveDate}` : ""}
              </small>
              <span className="cloud-record-link">
                Read document
                <ArrowRight size={15} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const starter = {
  title: "My sales tool",
  description: "A custom tool for our team.",
  html: '<main><h1>My sales tool</h1><p id="summary">Your custom workspace starts here.</p></main>',
  css: "body { font: 16px system-ui; padding: 24px; color: #111; } h1 { letter-spacing: -1px; } main { background: #fedeec; padding: 24px; border-radius: 16px; }",
  javascript:
    'window.addEventListener("myflatpay:context", event => {\n  const summary = event.detail;\n  document.getElementById("summary").textContent = `${summary.salesWon ?? 0} sales won this month.`;\n});',
};
export function buildFeatureDocument(feature, channel = "myflatpay-preview") {
  const css = String(feature.css || "").replace(/<\/style/gi, "<\\/style"),
    js = String(feature.javascript || "").replace(/<\/script/gi, "<\\/script");
  const channelLiteral = JSON.stringify(String(channel)).replace(
    /</g,
    "\\u003c",
  );
  const bridge = `(function(){const channel=${channelLiteral};window.addEventListener('message',function(event){if(event.source!==parent||!event.data||event.data.channel!==channel||event.data.type!=='myflatpay:context')return;window.myflatpayContext=event.data.context;window.dispatchEvent(new CustomEvent('myflatpay:context',{detail:event.data.context}));});window.myflatpay={getState:function(){parent.postMessage({type:'myflatpay:get-state',channel},'*');},saveState:function(value){parent.postMessage({type:'myflatpay:save-state',channel,data:value},'*');}};window.addEventListener('message',function(event){if(event.source===parent&&event.data&&event.data.channel===channel&&event.data.type==='myflatpay:state')window.dispatchEvent(new CustomEvent('myflatpay:state',{detail:event.data.data}));});window.addEventListener('error',function(event){parent.postMessage({type:'myflatpay:error',channel,message:String(event.message||'Tool code could not run.').slice(0,500)},'*');});parent.postMessage({type:'myflatpay:ready',channel},'*');})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'; navigate-to 'none'"><style>${css}</style></head><body>${feature.html || ""}<script>${bridge}</script><script>${js}</script></body></html>`;
}
function FeatureFrame({ feature, context, allowState = false, onError }) {
  const frame = useRef(null);
  const channel = useMemo(
    () => crypto.randomUUID(),
    [feature.id, feature.html, feature.css, feature.javascript],
  );
  const srcDoc = useMemo(
    () => buildFeatureDocument(feature, channel),
    [feature.html, feature.css, feature.javascript, channel],
  );
  useEffect(() => {
    let active = true;
    const send = (value) =>
      frame.current?.contentWindow?.postMessage({ ...value, channel }, "*");
    const receive = async (event) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !event.data ||
        typeof event.data !== "object" ||
        event.data.channel !== channel
      )
        return;
      const type = event.data.type;
      if (type === "myflatpay:ready" && context)
        send({ type: "myflatpay:context", context });
      if (type === "myflatpay:error") {
        onError?.(
          String(event.data.message || "Custom tool code could not run.").slice(
            0,
            500,
          ),
        );
        return;
      }
      if (
        !allowState ||
        !feature.id ||
        !["myflatpay:get-state", "myflatpay:save-state"].includes(type)
      )
        return;
      try {
        if (type === "myflatpay:save-state") {
          const json = JSON.stringify(event.data.data);
          if (!json || json.length > 50000)
            throw Error(
              "Custom tool state must be less than 50,000 characters.",
            );
          await api(`/api/features/${feature.id}/state`, "PUT", {
            state: event.data.data,
          });
        }
        const result = await api(`/api/features/${feature.id}/state`);
        if (active)
          send({
            type: "myflatpay:state",
            data: result.state ?? result.data ?? null,
          });
      } catch (e) {
        onError?.(e.message);
      }
    };
    window.addEventListener("message", receive);
    if (context) send({ type: "myflatpay:context", context });
    return () => {
      active = false;
      window.removeEventListener("message", receive);
    };
  }, [feature.id, srcDoc, channel, context, allowState]);
  return (
    <iframe
      ref={frame}
      title={`Custom tool: ${feature.title || "Preview"}`}
      className="cloud-feature-frame"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={() => {
        if (context)
          frame.current?.contentWindow?.postMessage(
            { type: "myflatpay:context", context, channel },
            "*",
          );
      }}
      srcDoc={srcDoc}
    />
  );
}
export function FeatureStudio({ user }) {
  const [features, setFeatures] = useState([]),
    [draft, setDraft] = useState({ ...starter }),
    [tab, setTab] = useState("html"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState({ ...starter });
  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  async function load() {
    try {
      const data = await api("/api/features");
      setFeatures(Array.isArray(data) ? data : data.features || []);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (owner(user)) load();
  }, [user?.id]);
  if (!owner(user))
    return (
      <Empty icon={Code2} title="Feature studio is for workspace owners">
        Published custom tools are available in your team tools area.
      </Empty>
    );
  async function save(event) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/features", "POST", draft),
        feature = result.feature || result;
      setDraft(feature);
      setPreview(feature);
      setNotice("Draft saved. Preview and review it before publishing.");
      await load();
      return feature;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function publish(published) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/features/${draft.id}/publish`, "POST", {
          published,
        }),
        feature = result.feature || result;
      setDraft(feature);
      setNotice(
        published
          ? "Tool published to your team."
          : "Tool unpublished. The draft is kept.",
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/features/${draft.id}`, "DELETE");
      setDraft({ ...starter });
      setPreview({ ...starter });
      setNotice("Custom tool deleted.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cloud-page">
      <Feedback error={error} notice={notice} />
      <div className="cloud-intro">
        <span className="cloud-intro-icon">
          <Code2 size={25} />
        </span>
        <div>
          <h2>Build the tool your team needs.</h2>
          <p>
            Write HTML, CSS and JavaScript, preview your draft, then publish it
            as a custom team tool. Core app and commission changes remain a
            separate reviewed update.
          </p>
        </div>
      </div>
      <div className="cloud-studio-layout">
        <aside className="panel cloud-section cloud-feature-list">
          <button
            className="button secondary"
            onClick={() => {
              setDraft({ ...starter });
              setPreview({ ...starter });
              setNotice("");
            }}
          >
            <Plus size={15} />
            New tool
          </button>
          {features.map((f) => (
            <button
              className={draft.id === f.id ? "selected" : ""}
              key={f.id}
              onClick={() => {
                setDraft(f);
                setPreview(f);
                setNotice("");
              }}
            >
              <strong>{f.title}</strong>
              <span>
                {f.published ? `Published v${f.publishedRevision}` : "Draft"} ·
                Draft v{f.revision}
              </span>
            </button>
          ))}
        </aside>
        <section className="panel cloud-section cloud-editor-panel">
          <form onSubmit={save} className="cloud-form">
            <div className="form-grid">
              <label className="field">
                <span>Tool title</span>
                <input
                  required
                  maxLength={300}
                  value={draft.title || ""}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  maxLength={2000}
                  value={draft.description || ""}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
            </div>
            <div className="cloud-code-tabs">
              {["html", "css", "javascript"].map((t) => (
                <button
                  type="button"
                  className={tab === t ? "selected" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t === "javascript" ? "JavaScript" : t.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="field cloud-code-field">
              <span className="cloud-sr-only">
                {tab === "javascript" ? "JavaScript" : tab.toUpperCase()} code
              </span>
              <textarea
                aria-label={`${tab === "javascript" ? "JavaScript" : tab.toUpperCase()} code`}
                spellCheck={false}
                rows={17}
                maxLength={50000}
                value={draft[tab] || ""}
                onChange={(e) => set(tab, e.target.value)}
              />
            </label>
            <div className="cloud-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setPreview({ ...draft })}
              >
                <Play size={15} />
                Preview draft
              </button>
              <button className="button primary" disabled={busy} type="submit">
                {busy ? "Saving…" : "Save draft"}
              </button>
              {draft.id && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => publish(true)}
                >
                  Publish saved draft
                </button>
              )}
              {draft.id && draft.published && (
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => publish(false)}
                >
                  Unpublish
                </button>
              )}
              {draft.id && (
                <button
                  type="button"
                  className="icon-button cloud-delete"
                  aria-label="Delete custom tool"
                  disabled={busy}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <p className="cloud-small">
              Publishing uses the last saved draft. Editing a draft keeps the
              previous published version available to your team.
            </p>
          </form>
          <details className="cloud-code-help">
            <summary>Tool data API</summary>
            <p>
              Code runs in its own frame. It cannot access the app’s sign-in
              session or customer records. Team members can choose to share an
              aggregate sales summary.
            </p>
            <code>
              window.addEventListener('myflatpay:context', event =&gt;
              console.log(event.detail));{"\n"}window.myflatpay.getState();
              {"\n"}window.addEventListener('myflatpay:state', event =&gt;
              console.log(event.detail));{"\n"}window.myflatpay.saveState(
              {`{ count: 1 }`});
            </code>
            <p>
              Saved state belongs to the signed-in user and this tool. Preview
              drafts do not save state.
            </p>
          </details>
        </section>
      </div>
      <section className="panel cloud-section">
        <div className="cloud-section-heading">
          <div>
            <h2>Draft preview</h2>
            <p>
              Preview runs the code currently shown when you click Preview
              draft.
            </p>
          </div>
          <span className="cloud-pill">Isolated preview</span>
        </div>
        <FeatureFrame feature={preview} onError={setError} />
      </section>
    </div>
  );
}
export function FeatureTools({ user, deals = [], month }) {
  const [features, setFeatures] = useState(null),
    [selected, setSelected] = useState(""),
    [share, setShare] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/features")
      .then((data) => {
        const list = (Array.isArray(data) ? data : data.features || [])
          .filter((f) => f.published !== false)
          .map((f) =>
            f.publishedPayload ? { ...f.publishedPayload, id: f.id } : f,
          );
        setFeatures(list);
        setSelected(list[0]?.id || "");
      })
      .catch((e) => setError(e.message));
  }, [user?.id]);
  const feature = features?.find((f) => f.id === selected);
  const context = useMemo(() => {
    if (!share) return null;
    const period =
      month ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
      })
        .format(new Date())
        .replace("/", "-");
    const summary = monthlySummary(deals, period);
    return {
      month: period,
      salesWon: summary.wonCount,
      confirmedCommission: summary.confirmedCommission,
      monthlyVolume: summary.monthlyVolume,
      activeOpportunities: deals.filter(
        (d) => !["Won", "Lost"].includes(d.status),
      ).length,
    };
  }, [share, deals, month]);
  return (
    <div className="cloud-page">
      <Feedback error={error} />
      <div className="cloud-intro">
        <span className="cloud-intro-icon">
          <Code2 size={25} />
        </span>
        <div>
          <h2>Made for your team.</h2>
          <p>
            Custom tools published by your workspace owner. Each tool can save
            its own data to your account.
          </p>
        </div>
      </div>
      {!features ? (
        <Loading />
      ) : !features.length ? (
        <Empty icon={Code2} title="Your custom tools will appear here">
          Your workspace owner can build and publish tools in Feature studio.
        </Empty>
      ) : (
        <>
          <div className="cloud-tools-picker">
            {features.map((f) => (
              <button
                key={f.id}
                className={selected === f.id ? "selected" : ""}
                onClick={() => {
                  setSelected(f.id);
                  setError("");
                }}
              >
                {f.title}
              </button>
            ))}
          </div>
          {feature && (
            <section className="panel cloud-section">
              <div className="cloud-section-heading">
                <div>
                  <h2>{feature.title}</h2>
                  <p>{feature.description}</p>
                </div>
                <label className="cloud-context-toggle">
                  <input
                    type="checkbox"
                    checked={share}
                    onChange={(e) => setShare(e.target.checked)}
                  />
                  <span>Share my sales summary</span>
                </label>
              </div>
              <p className="cloud-small">
                Sharing includes your aggregate sales and commission totals.
                Customer names, contacts and sign-in details are excluded.
              </p>
              <FeatureFrame
                key={`${feature.id}-${share}`}
                feature={feature}
                context={context}
                allowState
                onError={setError}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
