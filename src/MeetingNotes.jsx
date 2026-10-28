import React from "react";
import { Plus, Trash2, NotebookPen, ArrowRight, FileText } from "lucide-react";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function MeetingNotes({ deal, onChange }) {
  const notes = deal.meetingNotes || [];
  const update = (id, key, value) =>
    onChange(notes.map((n) => (n.id === id ? { ...n, [key]: value } : n)));
  return (
    <section className="meeting-notepad">
      <div className="form-section-title split">
        <div>
          <h3>Your meeting notepad</h3>
          <p>
            Capture the conversation, objections and the next step. Notes are
            saved when you save the merchant.
          </p>
        </div>
        <button
          type="button"
          className="button secondary small"
          onClick={() =>
            onChange([
              {
                id: crypto.randomUUID(),
                title: "",
                date: today(),
                body: "",
                actions: "",
                nextFollowUp: "",
              },
              ...notes,
            ])
          }
        >
          <Plus size={16} /> New note
        </button>
      </div>
      {!notes.length && (
        <div className="empty-state">
          <NotebookPen size={30} />
          <h3>Make the conversation count.</h3>
          <p>Add a dated note for each meeting or call.</p>
        </div>
      )}
      {notes.map((n, i) => (
        <article className="notepad-card" key={n.id}>
          <div className="note-top">
            <span>
              MEETING NOTE {String(notes.length - i).padStart(2, "0")}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove note ${i + 1}`}
              onClick={() => onChange(notes.filter((x) => x.id !== n.id))}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Note title</span>
              <input
                value={n.title || ""}
                maxLength={300}
                onChange={(e) => update(n.id, "title", e.target.value)}
                placeholder="Discovery meeting, follow-up call…"
              />
            </label>
            <label className="field">
              <span>Note date</span>
              <input
                type="date"
                value={n.date || ""}
                onChange={(e) => update(n.id, "date", e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>Meeting notes</span>
            <textarea
              className="lined-notes"
              rows={8}
              maxLength={10000}
              value={n.body || ""}
              onChange={(e) => update(n.id, "body", e.target.value)}
              placeholder="What matters to them? Current setup, pain points, decision makers, objections…"
            />
          </label>
          <label className="field">
            <span>Agreed actions & next steps</span>
            <textarea
              rows={3}
              maxLength={5000}
              value={n.actions || ""}
              onChange={(e) => update(n.id, "actions", e.target.value)}
              placeholder="Who is doing what, and by when?"
            />
          </label>
          <label className="field">
            <span>Next follow-up date</span>
            <input
              type="date"
              value={n.nextFollowUp || ""}
              onChange={(e) => update(n.id, "nextFollowUp", e.target.value)}
            />
          </label>
        </article>
      ))}
    </section>
  );
}
export function SalesToolsHub({ deals, onOpen, kind }) {
  const notesMode = kind === "notes";
  const rows = notesMode
    ? deals
        .flatMap((d) =>
          (d.meetingNotes || []).map((n) => ({ deal: d, note: n })),
        )
        .sort((a, b) => (b.note.date || "").localeCompare(a.note.date || ""))
    : deals.map((d) => ({ deal: d }));
  return (
    <>
      <div className="tools-intro">
        <div className="tools-intro-icon">
          {notesMode ? <NotebookPen size={26} /> : <FileText size={26} />}
        </div>
        <div>
          <h2>
            {notesMode
              ? "Every conversation, remembered."
              : "A clear offer to take away."}
          </h2>
          <p>
            {notesMode
              ? "Keep a dated meeting history for each business. Open a merchant to write a note."
              : "Prepare a customer offer from an AC, then print it or save it as a PDF. Keep internal notes and commission figures private."}
          </p>
        </div>
      </div>
      {notesMode && (
        <div className="merchant-note-picker">
          <h3>Write a meeting note</h3>
          <div className="tool-merchant-list">
            {deals.map((d) => (
              <button
                className="button secondary small"
                key={d.id}
                onClick={() => onOpen(d, "Meeting notes")}
              >
                {d.businessName}
                <Plus size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="tools-card-grid">
        {rows.map(({ deal, note }) => (
          <button
            className="tool-record-card"
            key={note?.id || deal.id}
            onClick={() =>
              onOpen(deal, notesMode ? "Meeting notes" : "Offer sheet")
            }
          >
            <span className="eyebrow">
              {notesMode
                ? note.date || "UNDATED NOTE"
                : `${deal.offers?.length || 0} AC OFFERS`}
            </span>
            <h3>
              {notesMode ? note.title || "Meeting note" : deal.businessName}
            </h3>
            {notesMode && <strong>{deal.businessName}</strong>}
            <p>
              {notesMode
                ? note.body || "Add your meeting notes."
                : deal.contactName ||
                  "Create a personalised customer proposal."}
            </p>
            {note?.nextFollowUp && <small>Follow up {note.nextFollowUp}</small>}
            <span className="tool-record-action">
              {notesMode ? "Open notepad" : "Create offer sheet"}
              <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <div className="empty-state">
          <h3>
            {notesMode
              ? "Your notes will appear here."
              : "Add a merchant to prepare an offer."}
          </h3>
          <p>
            {notesMode
              ? "Choose a merchant above and add your first note."
              : "Your saved AC offers are the starting point."}
          </p>
        </div>
      )}
    </>
  );
}
