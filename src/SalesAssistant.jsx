import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ClipboardList,
  MessageSquare,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { monthlySummary } from "../shared/domain.mjs";
import "./assistant.css";

const money = (value) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
const defaultTargets = { sales: null, commission: null };
const starterPrompts = [
  { text: "How am I tracking this month?", icon: Target },
  { text: "Which deals should I focus on next?", icon: ArrowUpRight },
  { text: "Where is my commission held up?", icon: ClipboardList },
];

async function api(path, method = "GET", body) {
  const response = await fetch(`/api/assistant${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The assistant returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      data.error || "The assistant could not complete that request.",
    );
  return data;
}

function Progress({ value, target, label, format = (v) => v }) {
  const hasTarget =
    target !== null && target !== undefined && Number(target) >= 0;
  const percent = hasTarget
    ? Number(target) === 0
      ? 100
      : Math.min(100, (value / target) * 100)
    : 0;
  return (
    <div className="assistant-progress">
      <div>
        <span>{label}</span>
        <strong>{format(value)}</strong>
      </div>
      <div
        className="assistant-progress-track"
        {...(hasTarget
          ? {
              role: "progressbar",
              "aria-label": label,
              "aria-valuenow": Math.round(percent),
              "aria-valuemin": 0,
              "aria-valuemax": 100,
            }
          : {})}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>
        {hasTarget
          ? `${format(Math.max(0, target - value))} to your ${format(target)} target`
          : "Set your monthly target below"}
      </small>
    </div>
  );
}

export default function SalesAssistant({
  deals = [],
  month,
  onApplyNote,
  onOpenDeal,
}) {
  const [mode, setMode] = useState("loading");
  const [model, setModel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [preferences, setPreferences] = useState([]);
  const [targets, setTargets] = useState(defaultTargets);
  const [targetDraft, setTargetDraft] = useState({ sales: "", commission: "" });
  const [message, setMessage] = useState("");
  const [dealId, setDealId] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preference, setPreference] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef(null);
  const requestGeneration = useRef(0);
  const selected = deals.find((deal) => deal.id === dealId);
  const summary = monthlySummary(deals, month);
  const active = deals.filter((deal) => !["Won", "Lost"].includes(deal.status));

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setMessages([]);
    setPreferences([]);
    setTargets(defaultTargets);
    setTargetDraft({ sales: "", commission: "" });
    setError("");
    setNotice("");
    setMessage("");
    setNotes("");
    setDealId("");
    setBusy(false);
    setMode("loading");
    api("")
      .then((data) => {
        if (generation !== requestGeneration.current) return;
        setMode(data.mode);
        setModel(data.model);
        {
          setMessages(data.messages || []);
          setPreferences(data.preferences || []);
          const savedTargets = data.targets || defaultTargets;
          setTargets(savedTargets);
          setTargetDraft({
            sales: savedTargets.sales ?? "",
            commission: savedTargets.commission ?? "",
          });
        }
      })
      .catch((failure) => {
        if (generation !== requestGeneration.current) return;
        setMode("unavailable");
        setError(failure.message);
      });
    return () => {
      requestGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (dealId && !deals.some((deal) => deal.id === dealId)) setDealId("");
  }, [deals, dealId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, busy]);

  async function ask(text = message) {
    const trimmed = text.trim();
    if (!trimmed || busy || mode === "loading") return;
    const generation = requestGeneration.current;
    const requestDealId = selected?.id;
    const localId = crypto.randomUUID();
    setError("");
    setNotice("");
    setBusy(true);
    setMessage("");
    setMessages((previous) => [
      ...previous,
      { id: localId, role: "user", content: trimmed },
    ]);
    try {
      const data = await api("/chat", "POST", {
        message: trimmed,
        month,
        ...(requestDealId ? { dealId: requestDealId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (generation !== requestGeneration.current) return;
      setMode(data.mode);
      if (data.warning) setNotice(data.warning);
      setMessages((previous) => [
        ...previous,
        {
          ...(data.message || {}),
          id: data.message?.id || crypto.randomUUID(),
          role: "assistant",
          content: data.reply,
          mode: data.mode,
          actions: data.actions || [],
          dealId: requestDealId,
          applied: [],
        },
      ]);
    } catch (failure) {
      if (generation !== requestGeneration.current) return;
      setError(failure.message);
      setMessage(trimmed);
      setMessages((previous) => previous.filter((item) => item.id !== localId));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  async function applyAction(item, action, index) {
    if (!item.dealId || !onApplyNote || applying) return;
    const actionKey = `${item.id}-${index}`;
    setApplying(actionKey);
    setError("");
    try {
      await onApplyNote({
        dealId: item.dealId,
        type: action.type,
        text: action.text,
      });
      setMessages((previous) =>
        previous.map((entry) =>
          entry.id === item.id
            ? { ...entry, applied: [...(entry.applied || []), index] }
            : entry,
        ),
      );
      setNotice("Added to the customer record.");
    } catch (failure) {
      setError(failure.message || "The note could not be saved.");
    } finally {
      setApplying(null);
    }
  }

  async function saveTargets(event) {
    event.preventDefault();
    const nextTargets = {
      sales: targetDraft.sales === "" ? null : Number(targetDraft.sales),
      commission:
        targetDraft.commission === "" ? null : Number(targetDraft.commission),
    };
    if (
      (nextTargets.sales !== null &&
        (!Number.isInteger(nextTargets.sales) || nextTargets.sales < 0)) ||
      (nextTargets.commission !== null &&
        (!Number.isFinite(nextTargets.commission) ||
          nextTargets.commission < 0))
    ) {
      setError(
        "Targets must be positive figures; sales must be a whole number.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/targets", "PUT", nextTargets);
      setTargets(nextTargets);
      setNotice("Monthly targets saved.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function remember(event) {
    event.preventDefault();
    if (!preference.trim()) return;
    setSaving(true);
    setError("");
    try {
      const result = await api("/preferences", "POST", {
        text: preference.trim(),
      });
      // Re-read so the UI reflects the server's canonical memory list.
      const state = await api("");
      setPreferences(state.preferences || result.preferences || []);
      setPreference("");
      setNotice("Preference remembered. You can remove it at any time.");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function forget(id) {
    setSaving(true);
    setError("");
    try {
      await api(`/preferences/${encodeURIComponent(id)}`, "DELETE");
      setPreferences((previous) => previous.filter((item) => item.id !== id));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  async function clearHistory() {
    setSaving(true);
    setError("");
    try {
      await api("/history", "DELETE");
      setMessages([]);
      setNotice(
        "Conversation cleared. Saved merchant notes and preferences are kept.",
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sales-assistant">
      <div className="assistant-layout">
        <section
          className="assistant-chat panel"
          aria-label="Sales assistant conversation"
        >
          <header className="assistant-chat-header">
            <span className="assistant-symbol">
              <Sparkles size={22} />
            </span>
            <div>
              <h2>Your next move, made clearer.</h2>
              <p>Meeting notes, follow-ups and a little sales perspective.</p>
            </div>
            <button
              type="button"
              className="icon-button assistant-settings-toggle"
              aria-label="Assistant settings and memory"
              aria-expanded={settings}
              onClick={() => setSettings((previous) => !previous)}
            >
              <Settings2 size={19} />
            </button>
          </header>
          <div className={`assistant-mode ${mode === "ai" ? "is-ai" : ""}`}>
            <span className="assistant-mode-dot" />
            <strong>
              {mode === "ai"
                ? "AI configured"
                : mode === "local"
                  ? "Local sales assistant"
                  : mode === "loading"
                    ? "Connecting to your assistant…"
                    : "Assistant unavailable"}
            </strong>
            <span>
              {mode === "local"
                ? "Uses recorded figures and guided drafts"
                : mode === "ai"
                  ? "Uses your current sales records"
                  : ""}
            </span>
          </div>
          <div
            className="assistant-messages"
            role="log"
            aria-label="Assistant messages"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="assistant-welcome">
                <div className="assistant-welcome-icon">
                  <MessageSquare size={27} />
                </div>
                <h3>Less admin. More conversations.</h3>
                <p>
                  Ask about your pipeline and commission, or paste meeting notes
                  to turn them into clear next steps.
                </p>
                <div className="assistant-starters">
                  {starterPrompts.map(({ text, icon: Icon }) => (
                    <button
                      type="button"
                      key={text}
                      onClick={() => ask(text)}
                      disabled={
                        busy || mode === "loading" || mode === "unavailable"
                      }
                    >
                      <Icon size={16} />
                      <span>{text}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((item) => (
              <article
                key={item.id}
                className={`assistant-message ${item.role === "user" ? "from-user" : "from-assistant"}`}
              >
                <div className="assistant-message-label">
                  {item.role === "user" ? (
                    "You"
                  ) : (
                    <>
                      <Bot size={15} />
                      {item.mode === "ai"
                        ? "myflatpay AI"
                        : "myflatpay assistant"}
                    </>
                  )}
                </div>
                <div className="assistant-message-body">{item.content}</div>
                {item.role === "assistant" && item.actions?.length > 0 && (
                  <div className="assistant-actions">
                    <strong>Review before adding to the merchant</strong>
                    {item.actions.map((action, index) => (
                      <div
                        className="assistant-action"
                        key={`${item.id}-${index}`}
                      >
                        <small>
                          {action.type === "followUp"
                            ? "Next step"
                            : "Meeting note"}
                        </small>
                        <p>{action.text}</p>
                        <button
                          type="button"
                          className="button secondary"
                          disabled={
                            !item.dealId ||
                            !onApplyNote ||
                            !!applying ||
                            item.applied?.includes(index)
                          }
                          onClick={() => applyAction(item, action, index)}
                        >
                          {item.applied?.includes(index) ? (
                            <>
                              <Check size={14} />
                              Added
                            </>
                          ) : applying === `${item.id}-${index}` ? (
                            "Adding…"
                          ) : (
                            <>
                              <ClipboardList size={14} />
                              Add to merchant
                            </>
                          )}
                        </button>
                        {!item.dealId && (
                          <small>
                            Select a merchant and request a new draft to attach
                            it.
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {busy && (
              <div className="assistant-thinking" role="status">
                <span />
                <span />
                <span />
                Working through your records…
              </div>
            )}
            <div ref={endRef} />
          </div>
          {error && (
            <div className="notice error assistant-feedback" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="notice success assistant-feedback" role="status">
              <Check size={15} />
              {notice}
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss assistant notice"
              >
                <X size={14} />
              </button>
            </div>
          )}
          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <div className="assistant-context">
              <label>
                <span>Conversation context</span>
                <select
                  aria-label="Assistant merchant"
                  value={dealId}
                  onChange={(event) => setDealId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Whole workspace</option>
                  {deals.map((deal) => (
                    <option value={deal.id} key={deal.id}>
                      {deal.businessName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="text-button"
                aria-expanded={showNotes}
                onClick={() => setShowNotes((previous) => !previous)}
              >
                <ClipboardList size={15} />
                Meeting notes
                <ChevronDown size={13} />
              </button>
            </div>
            {showNotes && (
              <label className="assistant-raw-notes">
                <span>Notes to work with</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={10000}
                  placeholder="Paste rough notes, objections, decisions and agreed next steps…"
                  rows={4}
                />
                <small>
                  Included with your next message. Drafts are only saved to a
                  merchant when you add them.
                </small>
              </label>
            )}
            <div className="assistant-message-input">
              <textarea
                aria-label="Message the sales assistant"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={4000}
                rows={2}
                placeholder={
                  selected
                    ? `Ask about ${selected.businessName}…`
                    : "Ask about your sales, commission or next move…"
                }
                disabled={busy}
              />
              <button
                type="submit"
                className="button primary"
                disabled={
                  busy ||
                  !message.trim() ||
                  mode === "loading" ||
                  mode === "unavailable"
                }
                aria-label="Send assistant message"
              >
                <Send size={17} />
                <span>Send</span>
              </button>
            </div>
            <small className="assistant-review-note">
              Check drafts and figures before using them with a customer. Offers
              and approvals stay under your control.
            </small>
          </form>
        </section>
        <aside className="assistant-side">
          <section className="panel assistant-tracking">
            <div className="assistant-side-heading">
              <Target size={18} />
              <h2>Your momentum</h2>
            </div>
            <p>
              {new Intl.DateTimeFormat("en-GB", {
                month: "long",
                year: "numeric",
                timeZone: "Europe/London",
              }).format(new Date(`${month}-01T12:00:00Z`))}
            </p>
            <Progress
              label="Sales won"
              value={summary.wonCount}
              target={targets.sales}
            />
            <Progress
              label="Confirmed commission"
              value={summary.confirmedCommission}
              target={targets.commission}
              format={money}
            />
            <div className="assistant-pipeline-count">
              <span>Active opportunities</span>
              <strong>{active.length}</strong>
            </div>
            <small>
              Commission uses verified amounts on this month’s wins. It is
              separate from expected payroll.
            </small>
            <details className="assistant-target-settings">
              <summary>
                Edit monthly targets
                <ChevronDown size={14} />
              </summary>
              <form onSubmit={saveTargets}>
                <label className="field">
                  <span>Monthly sales target</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={targetDraft.sales}
                    onChange={(event) =>
                      setTargetDraft((previous) => ({
                        ...previous,
                        sales: event.target.value,
                      }))
                    }
                    placeholder="e.g. 12"
                  />
                </label>
                <label className="field">
                  <span>Monthly commission target (£)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={targetDraft.commission}
                    onChange={(event) =>
                      setTargetDraft((previous) => ({
                        ...previous,
                        commission: event.target.value,
                      }))
                    }
                    placeholder="e.g. 4000"
                  />
                </label>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save targets"}
                </button>
                <small>Used as your recurring monthly goals.</small>
              </form>
            </details>
          </section>
          <section className="assistant-hint">
            <Sparkles size={20} />
            <h3>A better brief. A better next step.</h3>
            <p>
              Select a merchant, paste what was discussed, and ask for a
              follow-up. Add the draft to their record when you’re happy with
              it.
            </p>
            {selected && onOpenDeal && (
              <button
                type="button"
                className="text-button"
                onClick={() => onOpenDeal(selected)}
              >
                Open merchant
                <ArrowUpRight size={14} />
              </button>
            )}
          </section>
          {settings && (
            <section
              className="panel assistant-memory"
              aria-label="Assistant settings and memory"
            >
              <div className="assistant-side-heading">
                <Settings2 size={18} />
                <h2>Memory & settings</h2>
              </div>
              <p>
                The assistant uses your latest records each time. Save
                preferences to make future help more useful; this does not train
                the underlying model.
              </p>
              <>
                <form onSubmit={remember}>
                  <label className="field">
                    <span>Remember a preference</span>
                    <textarea
                      value={preference}
                      onChange={(event) => setPreference(event.target.value)}
                      maxLength={500}
                      rows={3}
                      placeholder="e.g. Keep customer follow-ups short and friendly."
                    />
                  </label>
                  <button
                    type="submit"
                    className="button secondary"
                    disabled={saving || !preference.trim()}
                  >
                    Remember preference
                  </button>
                </form>
                {preferences.length ? (
                  <ul className="assistant-preferences">
                    {preferences.map((item) => (
                      <li key={item.id}>
                        <span>{item.text}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Forget preference: ${item.text}`}
                          disabled={saving}
                          onClick={() => forget(item.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="assistant-memory-empty">
                    No saved preferences yet.
                  </div>
                )}
              </>
              <button
                type="button"
                className="assistant-clear"
                onClick={clearHistory}
                disabled={saving || busy || !messages.length}
              >
                <Trash2 size={14} />
                Clear conversation
              </button>
              <details className="assistant-connection">
                <summary>AI connection details</summary>
                {mode === "ai" ? (
                  <p>
                    Configured to use {model || "the selected model"}. Customer
                    context is sent to the configured AI service when you send a
                    message.
                  </p>
                ) : import.meta.env.MODE === "pages" ? (
                  <p>
                    This hosted edition provides local sales calculations and
                    guided drafts. Notes, chat history and preferences stay in
                    this browser. Conversational AI needs a connected server; no
                    API key is stored on this site.
                  </p>
                ) : (
                  <p>
                    Local mode provides sales calculations and guided drafts. To
                    enable AI conversation, configure OPENAI_API_KEY on the app
                    server; OPENAI_MODEL optionally selects the model. Keys stay
                    on the server.
                  </p>
                )}
              </details>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
