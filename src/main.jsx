import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  BookOpen,
  Plus,
  Search,
  ChevronDown,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  X,
  Check,
  Download,
  ExternalLink,
  CalendarDays,
  Terminal,
  Store,
  MonitorSmartphone,
  Smartphone,
  Trash2,
  CheckCircle2,
  Info,
  Menu,
  Settings2,
  NotebookPen,
  FileText,
  MessageSquare,
} from "lucide-react";
import {
  calculateMerchant,
  offerSummary,
  monthlySummary,
  validateDeal,
} from "../shared/domain.mjs";
import {
  PROCESS_STEPS,
  SALE_FIELDS,
  HARDWARE_HELP,
} from "../shared/process.mjs";
import { estimateCurrentCommission } from "../shared/official-milestones.mjs";
import AcDetails from "./AcDetails.jsx";
import { MeetingNotes, SalesToolsHub } from "./MeetingNotes.jsx";
import { OfferSheet, ClosingDeal } from "./OfferTools.jsx";
import SalesAssistant from "./SalesAssistant.jsx";
import {
  CloudAccountGate,
  TeamPage,
  DocumentsPage,
  FeatureStudio,
  FeatureTools,
} from "./CloudWorkspace.jsx";
import ConduktWorkspace from "./ConduktWorkspace.jsx";
import "./workspace-tools.css";
import "./sales-tools.css";
import PortfolioCalculator from "./PortfolioCalculator.jsx";
import { demoDeals } from "./demo.mjs";
import "./styles.css";
import { installPagesApi } from "./pages-api.mjs";
const pagesMode = import.meta.env.MODE === "pages";
const cloudMode = import.meta.env.MODE === "cloud";
if (pagesMode) installPagesApi();

const money = (v, compact = false) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(v || 0);
const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
const isoToday = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type).value)
    .join("-");
};
const STATUSES = [
  "Lead",
  "Meeting booked",
  "Proposal sent",
  "Negotiation",
  "Won",
  "Lost",
];
const hardwareNames = {
  terminal: "Terminal only",
  posPremium: "POS Premium",
  posPro: "POS Pro",
  mpos: "mPOS",
};
const blankDeal = () => ({
  businessName: "",
  contactName: "",
  email: "",
  phone: "",
  provider: "",
  meetingDate: isoToday(),
  status: "Lead",
  monthlyVolume: "",
  currentCharges: "",
  businessVolume: "",
  internationalVolume: "",
  amexVolume: "",
  amexRate: "",
  saleDate: "",
  commissionAmount: "",
  commissionConfirmed: false,
  offers: [],
  checklist: {},
  saleInfo: {},
  notes: "",
  meetingNotes: [],
  offerSheet: {},
  closingDeal: {},
});
const saleIsComplete = (d) =>
  PROCESS_STEPS.every((s) => d.checklist?.[s.id]) &&
  SALE_FIELDS.filter((f) => f.required).every(
    (f) =>
      d.saleInfo?.[f.key] !== undefined &&
      d.saleInfo?.[f.key] !== null &&
      String(d.saleInfo?.[f.key]).trim() !== "",
  );
function Status({ value }) {
  return (
    <span
      className={`status status-${value.toLowerCase().replaceAll(" ", "-")}`}
    >
      <i />
      {value}
    </span>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  suffix,
  hint,
  required = false,
  ...props
}) {
  return (
    <label className={`field ${props.className || ""}`}>
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      <div className="input-wrap">
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) =>
            onChange(
              type === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value,
            )
          }
          required={required}
          {...(type === "number" ? { min: 0, step: "any" } : {})}
          {...Object.fromEntries(
            Object.entries(props).filter(([key]) => key !== "className"),
          )}
        />
        {suffix && <em>{suffix}</em>}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}
function App({ user, onSignOut } = {}) {
  const [records, setRecords] = useState([]),
    [loading, setLoading] = useState(true),
    [demo, setDemo] = useState(false),
    [page, setPage] = useState("Overview"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All statuses"),
    [month, setMonth] = useState(isoToday().slice(0, 7)),
    [editor, setEditor] = useState(null),
    [editorTab, setEditorTab] = useState("Merchant"),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    fetch("/api/deals")
      .then(async (r) => {
        if (!r.ok) throw Error("Could not load your workspace.");
        return r.json();
      })
      .then((d) => {
        setRecords(d);
        setDemo(d.length === 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const [sample, setSample] = useState(demoDeals);
  const deals = demo ? sample : records,
    summary = monthlySummary(deals, month),
    active = deals.filter((d) => !["Won", "Lost"].includes(d.status)),
    display = deals.filter(
      (d) =>
        (filter === "All statuses" || d.status === filter) &&
        `${d.businessName} ${d.contactName} ${d.provider}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const pending = deals.filter(
    (d) =>
      d.status === "Won" && d.saleDate?.startsWith(month) && !saleIsComplete(d),
  ).length;
  const pipelineValue = active.reduce(
    (sum, d) => sum + Number(d.monthlyVolume || 0),
    0,
  );
  const navigate = (p) => {
    setPage(p);
    setMobile(false);
    setQuery("");
    setFilter("All statuses");
  };
  const notify = (t) => setToast(t);
  const openEditor = (deal, tab = "Merchant") => {
    setEditorTab(tab);
    setEditor(structuredClone(deal));
  };
  const add = () => {
    setDemo(false);
    openEditor(blankDeal());
  };
  async function save(deal) {
    if (demo && deal.id?.startsWith("demo-")) {
      setSample((s) => s.map((d) => (d.id === deal.id ? deal : d)));
      notify("Demo merchant updated for this session.");
      return;
    }
    const res = await fetch(deal.id ? `/api/deals/${deal.id}` : "/api/deals", {
      method: deal.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deal),
    });
    const data = await res.json();
    if (!res.ok)
      throw Error(
        data.errors?.join(" ") || data.error || "Unable to save merchant.",
      );
    setRecords((s) =>
      deal.id ? s.map((d) => (d.id === data.id ? data : d)) : [data, ...s],
    );
    notify("Merchant saved.");
  }
  async function remove(deal) {
    if (demo) {
      setSample((s) => s.filter((d) => d.id !== deal.id));
      return;
    }
    const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    if (!res.ok) throw Error("Unable to delete merchant.");
    setRecords((s) => s.filter((d) => d.id !== deal.id));
    notify("Merchant deleted.");
  }
  function exportData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      demo,
      deals,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `flatpay-${demo ? "demo-" : ""}${isoToday()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Workspace exported. Keep the backup secure.");
  }
  return (
    <div className={`app-shell ${cloudMode ? "cloud-app" : ""}`}>
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          myflatpay
        </a>
        <div className="workspace-tag">
          <span className="workspace-icon">S</span>
          <div>
            Sales workspace<small>Personal workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            [LayoutDashboard, "Overview"],
            [BriefcaseBusiness, "Sales pipeline"],
            [ChartNoAxesCombined, "Commission"],
            [NotebookPen, "Meeting notes"],
            [FileText, "Offer sheets"],
            [MessageSquare, "Sales assistant"],
            [BookOpen, "Sales playbook"],
            ...(cloudMode
              ? [
                  [FileText, "Head-office documents"],
                  [Store, "My tools"],
                  [BriefcaseBusiness, "Condukt"],
                  ...(user?.role === "owner"
                    ? [
                        [ChartNoAxesCombined, "Team"],
                        [Settings2, "Feature studio"],
                      ]
                    : []),
                ]
              : []),
          ].map(([Icon, title]) => (
            <button
              className={page === title ? "active" : ""}
              key={title}
              onClick={() => navigate(title)}
            >
              <Icon size={19} />
              {title}
              {title === "Sales pipeline" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-help">
            <div className="side-help-icon">
              <ArrowUpRight size={19} />
            </div>
            <strong>A little more momentum.</strong>
            <p>Every conversation is a new opportunity.</p>
            <button onClick={add}>
              Add a merchant <Plus size={15} />
            </button>
          </div>
          <div className="profile">
            <span>ME</span>
            <div>
              {user?.name || "My workspace"}
              <small>
                {user?.role === "owner" ? "Team owner" : "Field sales"}
              </small>
            </div>
            {cloudMode ? (
              <button onClick={onSignOut} aria-label="Sign out">
                Sign out
              </button>
            ) : (
              <span className="online-dot" />
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              onClick={() => setMobile(!mobile)}
              aria-label="Toggle menu"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="saved-dot" />
            {loading
              ? "Connecting…"
              : demo
                ? "Demo session · not saved"
                : cloudMode
                  ? "Saved to your account"
                  : pagesMode
                    ? "Saved in this browser"
                    : "Saved on this device’s server"}
            <span className="avatar">ME</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div className="eyebrow">YOUR SALES, IN ONE PLACE</div>
            <div className="heading-row">
              <div>
                <h1>
                  {page === "Overview"
                    ? "A clearer view of your sales."
                    : page === "Sales pipeline"
                      ? "From first hello to signed deal."
                      : page === "Commission"
                        ? "Make every sale count."
                        : page === "Meeting notes"
                          ? "Good conversations. Clear next steps."
                          : page === "Offer sheets"
                            ? "An offer worth thinking about."
                            : page === "Sales assistant"
                              ? "Your next move, made clearer."
                              : {
                                  "Head-office documents":
                                    "Your team's latest guidance.",
                                  "My tools": "Tools built for your day.",
                                  "Feature studio":
                                    "Build your next useful tool.",
                                  Team: "Every salesperson. One clear view.",
                                  Condukt:
                                    "The details and documents to follow up.",
                                }[page] || "Your next step, made simple."}
                </h1>
                <p>
                  {page === "Overview"
                    ? "Keep your pipeline moving and your next win in sight."
                    : page === "Sales pipeline"
                      ? "Every merchant, every offer, every opportunity."
                      : page === "Commission"
                        ? "Track confirmed earnings and the milestones still to come."
                        : page === "Meeting notes"
                          ? "Your meeting notes and follow-ups, together."
                          : page === "Offer sheets"
                            ? "Personal proposals to leave with your customers."
                            : page === "Sales assistant"
                              ? "Turn notes into next steps and see how your month is tracking."
                              : "A practical guide based on your Flatpay sales training."}
                </p>
              </div>
              <button className="button primary" onClick={add}>
                <Plus size={17} /> Add merchant
              </button>
            </div>
          </div>
          {error && <div className="notice error">{error}</div>}
          <div className={`workspace-banner ${demo ? "is-demo" : ""}`}>
            <span>
              <Info size={15} />
              {demo ? (
                <>
                  <strong>Demo workspace</strong> · Fictional merchants to show
                  you around.
                </>
              ) : (
                <>
                  <strong>Your workspace</strong> ·{" "}
                  {pagesMode
                    ? "Customer records are saved in this browser. Export regular backups."
                    : cloudMode
                      ? "Your customer records sync across devices when you sign in."
                      : "Customer records are saved locally to this server."}
                </>
              )}
            </span>
            <button onClick={() => setDemo(!demo)}>
              {demo ? "Start my workspace" : "Explore demo"}
              <ArrowRight size={14} />
            </button>
          </div>
          {(page === "Overview" || page === "Commission") && (
            <>
              <div className="section-heading">
                <h2>
                  {page === "Overview"
                    ? "This month at a glance"
                    : "Monthly earnings"}
                </h2>
                <label className="month-picker">
                  <CalendarDays size={15} />
                  <input
                    aria-label="Reporting month"
                    type="month"
                    value={month}
                    onChange={(e) => e.target.value && setMonth(e.target.value)}
                  />
                </label>
              </div>
              <div className="stats-grid">
                <Stat
                  label="Sales won"
                  value={summary.wonCount}
                  icon={BriefcaseBusiness}
                  footer={`${pending} awaiting checklist completion`}
                  tone="green"
                />
                <Stat
                  label="Signed monthly volume"
                  value={money(summary.monthlyVolume, true)}
                  icon={ChartNoAxesCombined}
                  footer="Transaction value from this month’s wins"
                />
                <Stat
                  label="Confirmed commission"
                  value={money(summary.confirmedCommission)}
                  icon={Store}
                  footer={`${summary.pendingCommissionCount} ${summary.pendingCommissionCount === 1 ? "sale" : "sales"} awaiting confirmation`}
                  tone="lime"
                />
                <Stat
                  label="Active opportunities"
                  value={active.length}
                  icon={ArrowUpRight}
                  footer={`${money(pipelineValue, true)} monthly volume in pipeline`}
                />
              </div>
            </>
          )}
          {page === "Overview" && (
            <div className="insights-grid">
              <section className="panel pipeline-card">
                <div className="panel-heading">
                  <div>
                    <h2>Your pipeline</h2>
                    <p>A little progress, every day.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("Sales pipeline")}
                  >
                    View pipeline <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="pipeline-bar">
                  {STATUSES.filter((s) => s !== "Lost").map((s, i) => (
                    <div
                      key={s}
                      style={{
                        flex: deals.filter((d) => d.status === s).length,
                        display: deals.some((d) => d.status === s)
                          ? "block"
                          : "none",
                        background: [
                          "#dddddd",
                          "#c9e6d1",
                          "#fedeec",
                          "#909090",
                          "#111111",
                        ][i],
                      }}
                    />
                  ))}
                </div>
                <div className="stage-legend">
                  {STATUSES.filter((s) => s !== "Lost").map((s, i) => (
                    <button
                      onClick={() => {
                        navigate("Sales pipeline");
                        setFilter(s);
                      }}
                      key={s}
                    >
                      <i
                        style={{
                          background: [
                            "#dddddd",
                            "#c9e6d1",
                            "#fedeec",
                            "#909090",
                            "#111111",
                          ][i],
                        }}
                      />
                      <span>{s}</span>
                      <strong>
                        {deals.filter((d) => d.status === s).length}
                      </strong>
                    </button>
                  ))}
                </div>
              </section>
              <section className="next-card">
                <div className="mini-tag">
                  <span /> KEEP THINGS MOVING
                </div>
                <h2>
                  Your next win starts
                  <br />
                  with a conversation.
                </h2>
                <p>
                  {deals.filter((d) => d.status === "Meeting booked").length}{" "}
                  meetings booked. Make the most of each one.
                </p>
                <button onClick={() => navigate("Sales playbook")}>
                  Open sales playbook <ArrowUpRight size={16} />
                </button>
                <div className="next-decoration">
                  <ArrowUpRight strokeWidth={0.65} />
                </div>
              </section>
            </div>
          )}
          {(page === "Overview" || page === "Sales pipeline") && (
            <section className="panel merchants-panel">
              <div className="panel-heading">
                <div className="title-with-count">
                  <h2>
                    {page === "Overview" ? "Your merchants" : "Sales pipeline"}
                  </h2>
                  <span>{deals.length}</span>
                </div>
                <button className="text-button export" onClick={exportData}>
                  <Download size={15} /> Export
                </button>
              </div>
              <div className="table-toolbar">
                <label className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="Search merchants"
                    placeholder="Search merchants or contacts…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <label className="filter-select">
                  <Settings2 size={15} />
                  <select
                    aria-label="Filter by status"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {["All statuses", ...STATUSES].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th>Current provider</th>
                      <th>Status</th>
                      <th>Monthly volume</th>
                      <th>Current rate</th>
                      <th>Proposed rate</th>
                      <th>Meeting</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {display.map((d) => {
                      const offer =
                        d.offers.find((o) => o.id === d.selectedOfferId) ||
                        d.offers.at(-1);
                      return (
                        <tr
                          key={d.id}
                          onClick={() => openEditor(d)}
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && openEditor(d)}
                        >
                          <td>
                            <div className="merchant-cell">
                              <span
                                style={{ background: d.color || "#efefef" }}
                              >
                                {d.initials ||
                                  d.businessName
                                    .split(" ")
                                    .map((w) => w[0])
                                    .slice(0, 2)
                                    .join("")
                                    .toUpperCase()}
                              </span>
                              <div>
                                <strong>{d.businessName}</strong>
                                <small>
                                  {d.contactName || "No contact added"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td className="provider-cell">
                            {d.provider?.trim() || (
                              <span className="muted">Not recorded</span>
                            )}
                          </td>
                          <td>
                            <Status value={d.status} />
                            {d.status === "Won" && (
                              <small className="sale-substatus">
                                {saleIsComplete(d)
                                  ? "Checklist complete"
                                  : "Awaiting completion"}
                              </small>
                            )}
                          </td>
                          <td className="numeric">
                            {money(d.monthlyVolume, true)}
                          </td>
                          <td className="numeric muted">
                            {d.monthlyVolume
                              ? pct(calculateMerchant(d).currentRate)
                              : "—"}
                          </td>
                          <td>
                            <span className="proposed">
                              {offer?.rate !== undefined && offer.rate !== ""
                                ? pct(offer.rate)
                                : "—"}
                            </span>
                          </td>
                          <td className="muted">
                            {d.meetingDate
                              ? new Date(
                                  d.meetingDate + "T12:00:00",
                                ).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                })
                              : "—"}
                          </td>
                          <td>
                            <button
                              className="row-open"
                              aria-label={`Open ${d.businessName}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditor(d);
                              }}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {display.length === 0 && (
                <div className="empty-state">
                  <BriefcaseBusiness size={28} />
                  <h3>
                    {query || filter !== "All statuses"
                      ? "No merchants match your search"
                      : "Your next chapter starts here"}
                  </h3>
                  <p>
                    {query || filter !== "All statuses"
                      ? "Try a different name or status."
                      : "Add your first merchant to start tracking your sales."}
                  </p>
                  {!query && filter === "All statuses" && (
                    <button className="button primary" onClick={add}>
                      <Plus size={15} />
                      Add merchant
                    </button>
                  )}
                </div>
              )}
              <div className="table-footer">
                <span>
                  {display.length}{" "}
                  {display.length === 1 ? "merchant" : "merchants"}
                  {demo ? " · Demo data" : ""}
                </span>
                <span>Every opportunity, a step forward.</span>
              </div>
            </section>
          )}
          {page === "Commission" && (
            <CommissionPage
              deals={deals}
              month={month}
              onEdit={openEditor}
              demo={demo}
            />
          )}
          {page === "Meeting notes" && (
            <SalesToolsHub deals={deals} onOpen={openEditor} kind="notes" />
          )}
          {page === "Offer sheets" && (
            <SalesToolsHub deals={deals} onOpen={openEditor} kind="offers" />
          )}
          {page === "Sales assistant" && (
            <SalesAssistant
              key={demo ? "demo" : "real"}
              deals={deals}
              demo={demo}
              month={month}
              onOpenDeal={(deal) => openEditor(deal, "Meeting notes")}
              onApplyNote={async ({ dealId, type, text }) => {
                const deal = deals.find((d) => d.id === dealId);
                if (!deal)
                  throw Error("Choose a merchant before applying this draft.");
                const updated =
                  type === "followUp"
                    ? {
                        ...deal,
                        notes:
                          `${deal.notes || ""}\n\nAssistant follow-up draft:\n${text}`.trim(),
                      }
                    : {
                        ...deal,
                        meetingNotes: [
                          {
                            id: crypto.randomUUID(),
                            title: "Assistant meeting summary",
                            date: isoToday(),
                            body: text,
                            actions: "",
                            nextFollowUp: "",
                          },
                          ...(deal.meetingNotes || []),
                        ],
                      };
                await save(updated);
              }}
            />
          )}
          {page === "Sales playbook" && <Playbook />}
          {cloudMode && page === "Head-office documents" && (
            <DocumentsPage user={user} />
          )}
          {cloudMode && page === "My tools" && (
            <FeatureTools user={user} deals={records} month={month} />
          )}
          {cloudMode && page === "Feature studio" && user?.role === "owner" && (
            <FeatureStudio user={user} />
          )}
          {cloudMode && page === "Team" && user?.role === "owner" && (
            <TeamPage user={user} />
          )}
          {cloudMode && page === "Condukt" && (
            <ConduktWorkspace deals={records} onSaved={setRecords} />
          )}
          {cloudMode && (
            <label className="button secondary cloud-import-button">
              Import a browser backup
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 8 * 1024 * 1024)
                      throw Error("Choose a backup under 8 MB.");
                    const backup = JSON.parse(await file.text());
                    if (backup.demo)
                      throw Error(
                        "Demo backups cannot be imported as customer records.",
                      );
                    const res = await fetch("/api/deals/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ deals: backup.deals }),
                    });
                    const result = await res.json();
                    if (!res.ok) throw Error(result.error);
                    setRecords(result.deals);
                    setDemo(false);
                    notify(
                      `${result.imported} customers imported; ${result.skipped} already present.`,
                    );
                  } catch (error) {
                    notify(error.message);
                  } finally {
                    e.target.value = "";
                  }
                }}
              />
            </label>
          )}
          <footer className="page-footer">
            <span className="footer-brand">myflatpay</span>
            <span>A little less admin. A lot more selling.</span>
            <span>Personal sales workspace</span>
          </footer>
        </main>
      </div>
      {editor && (
        <DealEditor
          initial={editor}
          initialTab={editorTab}
          demo={demo}
          onClose={() => setEditor(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value, icon: Icon, footer, tone = "" }) {
  return (
    <section className={`stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{footer}</small>
    </section>
  );
}
function Playbook() {
  return (
    <div className="playbook-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>A confident conversation</h2>
            <p>Five phases from the field sales training.</p>
          </div>
          <BookOpen size={20} />
        </div>
        <div className="phase-list">
          {[
            [
              "Introduce & discover",
              "Set an agenda, understand the merchant’s needs, and agree what a good outcome looks like.",
            ],
            [
              "Demonstrate the product",
              "Show the terminal, POS, mPOS and portal. Identify the best fit.",
            ],
            [
              "Explain the package",
              "Walk through relevant Flatpay services and compare with the current solution.",
            ],
            [
              "Review the statement",
              "Use the same statement period for charges and transaction value. Calculate the effective rate and card mix.",
            ],
            [
              "Agree & close",
              "Reconfirm the solution. Record each manager AC call, its offer and link. Follow the document checklist after signature.",
            ],
          ].map(([t, d], i) => (
            <div key={t}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>From signature to installation</h2>
            <p>Record completion in each merchant’s sale details.</p>
          </div>
        </div>
        <div className="process-list">
          {PROCESS_STEPS.map((s) => (
            <div key={s.id}>
              <CheckCircle2 size={18} />
              <div>
                <h3>{s.label}</h3>
                <p>{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="notice full-width">
        <Info size={18} />
        <div>
          <strong>Your documents remain the source of truth.</strong>
          <p>
            Based on Field Sales University Days 2 and 3, the POS brochure and
            pre-filled POS contract. This tracker records progress and
            references. Keep contracts, ID, bank documents and customer
            verification in the approved Flatpay systems. It does not submit a
            sale or replace an AC approval.
          </p>
        </div>
      </section>
    </div>
  );
}
function CommissionPage({ deals, month, onEdit, demo }) {
  const won = deals.filter(
    (d) => d.status === "Won" && d.saleDate?.startsWith(month),
  );
  return (
    <>
      <div className="notice">
        <Info size={18} />
        <div>
          <strong>Confirmed amounts, clear expectations.</strong>
          <p>
            Monthly totals use manually confirmed commission on sales won in
            this month, not a payroll forecast. Automatic estimates now follow
            the linked SM launch calculator (draft v2). The calculator below is
            a planning scenario; dated merchant earnings appear separately.{" "}
            <a
              href="https://sm-commission.pages.dev/SM_1_Introduction"
              target="_blank"
              rel="noreferrer"
            >
              Open the official calculator <ExternalLink size={12} />
            </a>
          </p>
        </div>
      </div>
      <PortfolioCalculator />
      <section className="panel">
        <div className="panel-heading">
          <h2>This month’s sales</h2>
          <span className="subtle">
            {demo ? "Demo figures" : "Confirmed earnings only"}
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Sale date</th>
                <th>Monthly volume</th>
                <th>Offer projection</th>
                <th>Confirmed commission</th>
                <th>Confirmation</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {won.map((d) => (
                <tr key={d.id} onClick={() => onEdit(structuredClone(d))}>
                  <td>
                    <strong>{d.businessName}</strong>
                  </td>
                  <td>{d.saleDate}</td>
                  <td>{money(d.monthlyVolume)}</td>
                  <td>
                    {estimateCurrentCommission(d, { asOfDate: isoToday() })
                      .total === null
                      ? "Complete setup"
                      : money(
                          estimateCurrentCommission(d, { asOfDate: isoToday() })
                            .total,
                        )}
                  </td>
                  <td>
                    {d.commissionConfirmed
                      ? money(d.commissionAmount)
                      : "Pending"}
                  </td>
                  <td>
                    <span
                      className={`status ${d.commissionConfirmed ? "status-won" : "status-meeting-booked"}`}
                    >
                      {d.commissionConfirmed
                        ? "Confirmed manually"
                        : "Needs confirmation"}
                    </span>
                  </td>
                  <td>
                    <ArrowUpRight size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!won.length && (
          <div className="empty-state">
            <ChartNoAxesCombined size={28} />
            <h3>No sales won in this month yet</h3>
            <p>
              Update a merchant to Won to record sale details and commission.
            </p>
          </div>
        )}
      </section>
      <PayoutSchedule deals={deals} month={month} />
      <div className="rules-grid">
        <div className="panel rule-card">
          <span>01</span>
          <h3>Installation milestone</h3>
          <p>
            For current sales, activation requires 0.5% of declared annual card
            turnover. Record installation and activation dates separately. The
            first half of matrix commission is due the month after activation.
          </p>
        </div>
        <div className="panel rule-card">
          <span>02</span>
          <h3>Volume milestone</h3>
          <p>
            The remaining half requires rolling 30-day turnover to reach annual
            declared TPV ÷ 12 within six months of installation. It is due the
            following month. Churn and rate changes can cause reversals.
          </p>
        </div>
        <div className="panel rule-card">
          <span>03</span>
          <h3>POS & payment timing</h3>
          <p>
            The calculator pays 15% upfront at £500+ for POS and £250+ for mPOS;
            lower amounts produce a £100 penalty. The upfront bonus requires
            full payment. The POS volume ladder counts installed merchant deals,
            not devices.
          </p>
        </div>
      </div>
    </>
  );
}

function DealEditor({
  initial,
  initialTab = "Merchant",
  demo,
  onClose,
  onSave,
  onDelete,
}) {
  const [d, setD] = useState(structuredClone(initial)),
    [tab, setTab] = useState(initialTab),
    [errors, setErrors] = useState([]),
    [busy, setBusy] = useState(false),
    [deletePrompt, setDeletePrompt] = useState(false);
  const set = (k, v) => setD((s) => ({ ...s, [k]: v }));
  const calc = calculateMerchant(d);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const fn = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", fn);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", fn);
    };
  }, [busy]);
  async function submit(e) {
    e.preventDefault();
    const issues = validateDeal(d);
    setErrors(issues);
    if (issues.length) return;
    setBusy(true);
    try {
      await onSave(d);
      onClose();
    } catch (e) {
      setErrors([e.message]);
    } finally {
      setBusy(false);
    }
  }
  const offerSet = (id, k, v) =>
    setD((s) => ({
      ...s,
      offers: s.offers.map((o) => (o.id === id ? { ...o, [k]: v } : o)),
    }));
  function addOffer() {
    const previous = d.offers.at(-1);
    const offer = {
      id: crypto.randomUUID(),
      date: isoToday(),
      rate: previous?.rate ?? "",
      amexRate: previous?.amexRate ?? "",
      annualTpv: previous?.annualTpv ?? d.commissionDetails?.annualTpv ?? "",
      currentRate: previous?.currentRate ?? "",
      businessSurcharge: previous?.businessSurcharge ?? "",
      internationalSurcharge: previous?.internationalSurcharge ?? "",
      surchargeShare: previous?.surchargeShare ?? "",
      businessShare: previous?.businessShare ?? "",
      internationalShare: previous?.internationalShare ?? "",
      bundle: previous?.bundle ?? false,
      businesses: structuredClone(previous?.businesses || []),
      manager: "",
      acLink: "",
      notes: "",
      hardware: previous
        ? { ...previous.hardware }
        : { terminal: 0, posPremium: 0, posPro: 0, mpos: 0 },
      additionalHardware: previous?.additionalHardware || "",
    };
    setD((s) => ({
      ...s,
      selectedOfferId: offer.id,
      offers: [...s.offers, offer],
    }));
  }
  return (
    <div className="modal-overlay">
      <section
        className="editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <form onSubmit={submit}>
          <header className="editor-header">
            <div className="eyebrow">
              {demo && d.id?.startsWith("demo-")
                ? "DEMO MERCHANT"
                : "MERCHANT WORKSPACE"}
            </div>
            <div>
              <h2 id="editor-title">{d.businessName || "A new opportunity"}</h2>
              <button
                type="button"
                className="icon-button"
                onClick={onClose}
                aria-label="Close merchant"
              >
                <X size={22} />
              </button>
            </div>
            <p>All the details. One clear picture.</p>
          </header>
          <div className="editor-tabs">
            {[
              "Merchant",
              "Statement",
              "AC offers",
              "Meeting notes",
              "Offer sheet",
              "Closing deal",
              "Sale details",
              "Commission",
            ].map((t) => (
              <button
                type="button"
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
                {t === "AC offers" && <span>{d.offers.length}</span>}
              </button>
            ))}
          </div>
          <div className="editor-content">
            {errors.length > 0 && (
              <div className="notice error" role="alert">
                <ul>
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {tab === "Merchant" && (
              <>
                <div className="form-section-title">
                  <h3>Meet the merchant</h3>
                  <p>Start with the people behind the business.</p>
                </div>
                <div className="form-grid">
                  <Field
                    label="Business name"
                    value={d.businessName}
                    onChange={(v) => set("businessName", v)}
                    required
                    placeholder="e.g. The Greenhouse Kitchen"
                  />
                  <Field
                    label="Contact person"
                    value={d.contactName}
                    onChange={(v) => set("contactName", v)}
                    placeholder="Full name"
                  />
                  <Field
                    label="Contact email"
                    type="email"
                    value={d.email}
                    onChange={(v) => set("email", v)}
                    placeholder="name@business.co.uk"
                  />
                  <Field
                    label="Contact phone"
                    type="tel"
                    value={d.phone}
                    onChange={(v) => set("phone", v)}
                    placeholder="Phone number"
                  />
                  <Field
                    label="Meeting date"
                    type="date"
                    value={d.meetingDate}
                    onChange={(v) => set("meetingDate", v)}
                  />
                  <Field
                    label="Current provider"
                    value={d.provider}
                    onChange={(v) => set("provider", v)}
                    placeholder="Choose or type their payment provider"
                    list="provider-suggestions"
                    maxLength={300}
                  />
                  <datalist id="provider-suggestions">
                    {[
                      "Dojo",
                      "Worldpay",
                      "SumUp",
                      "Zettle",
                      "Square",
                      "Barclaycard",
                      "Elavon",
                      "Global Payments",
                      "Clover",
                      "Takepayments",
                      "Teya",
                      "Stripe",
                      "Lloyds Cardnet",
                      "Adyen",
                      "Revolut",
                    ].map((provider) => (
                      <option key={provider} value={provider} />
                    ))}
                  </datalist>
                  <label className="field full-width">
                    <span>Sales status</span>
                    <select
                      value={d.status}
                      onChange={(e) => {
                        set("status", e.target.value);
                        if (e.target.value === "Won") {
                          set("saleDate", d.saleDate || isoToday());
                          setTab("Sale details");
                        }
                      }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field full-width">
                    <span>Notes & next steps</span>
                    <textarea
                      value={d.notes}
                      onChange={(e) => set("notes", e.target.value)}
                      placeholder="What matters to this merchant? What happens next?"
                      rows={4}
                    />
                  </label>
                </div>
                <div className="notice">
                  <Info size={17} />
                  <p>
                    When you mark a merchant as <strong>Won</strong>, we’ll
                    prompt you for sale details and the document checklist.
                  </p>
                </div>
              </>
            )}
            {tab === "Statement" && (
              <>
                <div className="form-section-title">
                  <h3>Understand their current costs</h3>
                  <p>
                    Use one month’s statement, including Amex in total value and
                    total charges.
                  </p>
                </div>
                <div className="form-grid">
                  <Field
                    label="Total transaction value"
                    suffix="GBP / month"
                    type="number"
                    value={d.monthlyVolume}
                    onChange={(v) => set("monthlyVolume", v)}
                  />
                  <Field
                    label="Total charges"
                    suffix="GBP / month"
                    type="number"
                    value={d.currentCharges}
                    onChange={(v) => set("currentCharges", v)}
                  />
                </div>
                <div className="rate-result">
                  <div>
                    <span>Current effective rate</span>
                    <strong>
                      {d.monthlyVolume ? pct(calc.currentRate) : "—"}
                    </strong>
                  </div>
                  <span>Total charges ÷ transaction value × 100</span>
                </div>
                <div className="form-section-title">
                  <h3>Know the card mix</h3>
                  <p>
                    Enter transaction values, not the number of payments.
                    Categories can overlap.
                  </p>
                </div>
                <div className="card-mix-grid">
                  {[
                    ["businessVolume", "Business cards", calc.businessShare],
                    [
                      "internationalVolume",
                      "International cards",
                      calc.internationalShare,
                    ],
                    ["amexVolume", "Amex cards", calc.amexShare],
                  ].map(([k, label, share]) => (
                    <div key={k} className="mix-card">
                      <Field
                        label={label}
                        type="number"
                        suffix="GBP"
                        value={d[k]}
                        onChange={(v) => set(k, v)}
                      />
                      <div>
                        <span>Share of total</span>
                        <strong>{pct(share)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="form-grid">
                  <Field
                    label="Current Amex rate"
                    suffix="%"
                    type="number"
                    max="100"
                    value={d.amexRate}
                    onChange={(v) => set("amexRate", v)}
                  />
                </div>
                <div className="notice">
                  <Info size={17} />
                  <p>
                    Business and international cards may include Amex. Shares
                    are calculated independently and should not be added
                    together.
                  </p>
                </div>
              </>
            )}
            {tab === "AC offers" && (
              <>
                <div className="form-section-title split">
                  <div>
                    <h3>A record of every offer</h3>
                    <p>
                      Keep the first proposal and every manager-approved
                      revision.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={addOffer}
                  >
                    <Plus size={15} />
                    New offer
                  </button>
                </div>
                {d.offers.length === 0 && (
                  <div className="empty-state">
                    <BriefcaseBusiness size={28} />
                    <h3>Start the conversation</h3>
                    <p>
                      Add a proposed rate, hardware and the manager’s AC link.
                    </p>
                    <button
                      type="button"
                      className="button primary"
                      onClick={addOffer}
                    >
                      Add first offer <Plus size={15} />
                    </button>
                  </div>
                )}
                {d.offers.map((o, i) => {
                  const savings = offerSummary(d, o);
                  return (
                    <div
                      className={`offer-card ${d.selectedOfferId === o.id ? "chosen" : ""}`}
                      key={o.id}
                    >
                      <header>
                        <div>
                          <span className="offer-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <h3>Offer {i + 1}</h3>
                        </div>
                        <button
                          type="button"
                          className={`select-offer ${d.selectedOfferId === o.id ? "is-selected" : ""}`}
                          onClick={() => set("selectedOfferId", o.id)}
                        >
                          {d.selectedOfferId === o.id ? (
                            <>
                              <Check size={14} />
                              Selected offer
                            </>
                          ) : (
                            "Select offer"
                          )}
                        </button>
                      </header>
                      <div className="form-grid">
                        <Field
                          label="Flatpay proposed rate"
                          type="number"
                          max="100"
                          suffix="%"
                          value={o.rate}
                          onChange={(v) => offerSet(o.id, "rate", v)}
                        />
                        <Field
                          label="Proposed Amex rate"
                          type="number"
                          max="100"
                          suffix="%"
                          value={o.amexRate}
                          onChange={(v) => offerSet(o.id, "amexRate", v)}
                        />
                        <Field
                          label="AC date"
                          type="date"
                          value={o.date}
                          onChange={(v) => offerSet(o.id, "date", v)}
                        />
                        <Field
                          label="Approving manager"
                          value={o.manager}
                          onChange={(v) => offerSet(o.id, "manager", v)}
                        />
                        <Field
                          label="AC link"
                          className="full-width"
                          type="url"
                          value={o.acLink}
                          onChange={(v) => offerSet(o.id, "acLink", v)}
                          placeholder="https://…"
                        />
                      </div>
                      {o.acLink && /^https?:\/\//i.test(o.acLink) && (
                        <a
                          className="inline-link"
                          target="_blank"
                          rel="noreferrer"
                          href={o.acLink}
                        >
                          Open AC <ExternalLink size={13} />
                        </a>
                      )}
                      <AcDetails
                        deal={d}
                        offer={o}
                        onChange={(key, value) => offerSet(o.id, key, value)}
                      />
                      {!o.bundle &&
                        o.annualTpv !== "" &&
                        o.annualTpv !== undefined && (
                          <div className="ac-commission-sync">
                            <p className="tool-caption">
                              Commission uses the declared annual TPV in the
                              Commission tab:{" "}
                              {d.commissionDetails?.annualTpv === "" ||
                              d.commissionDetails?.annualTpv === undefined
                                ? "not entered"
                                : money(d.commissionDetails.annualTpv)}
                              .
                            </p>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                setD((s) => ({
                                  ...s,
                                  commissionDetails: {
                                    ...s.commissionDetails,
                                    annualTpv: o.annualTpv,
                                  },
                                }))
                              }
                            >
                              Use this AC TPV for commission{" "}
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      <div className="hardware-title">
                        Hardware package{" "}
                        <small>
                          POS bundles include a terminal; standalone terminals
                          are additional.
                        </small>
                      </div>
                      <div className="hardware-grid">
                        {Object.entries(hardwareNames).map(
                          ([key, label], j) => {
                            const Icon = [
                              Terminal,
                              Store,
                              MonitorSmartphone,
                              Smartphone,
                            ][j];
                            return (
                              <div key={key} title={HARDWARE_HELP[key]}>
                                <Icon size={20} />
                                <Field
                                  label={label}
                                  type="number"
                                  step="1"
                                  value={o.hardware?.[key] || 0}
                                  onChange={(v) =>
                                    offerSet(o.id, "hardware", {
                                      ...o.hardware,
                                      [key]: v,
                                    })
                                  }
                                />
                              </div>
                            );
                          },
                        )}
                      </div>
                      <Field
                        label="Additional hardware"
                        value={o.additionalHardware}
                        onChange={(v) =>
                          offerSet(o.id, "additionalHardware", v)
                        }
                        placeholder="e.g. 2 receipt printers, 1 cash drawer"
                      />
                      <label className="field">
                        <span>Offer notes</span>
                        <textarea
                          rows={2}
                          value={o.notes || ""}
                          onChange={(e) =>
                            offerSet(o.id, "notes", e.target.value)
                          }
                          placeholder="Manager feedback, terms or reason for revision"
                        />
                      </label>
                      {Number(d.monthlyVolume) > 0 && (
                        <div className="savings-line">
                          <span>
                            Estimated monthly processing savings{" "}
                            <small>
                              Excludes hardware, rentals and other additional
                              fees.
                            </small>
                          </span>
                          <strong>
                            {savings.monthlySavings === null
                              ? "Complete rates"
                              : money(savings.monthlySavings)}
                          </strong>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {tab === "Meeting notes" && (
              <MeetingNotes
                deal={d}
                onChange={(notes) => set("meetingNotes", notes)}
              />
            )}
            {tab === "Offer sheet" && (
              <OfferSheet
                deal={d}
                onChange={(sheet) => set("offerSheet", sheet)}
              />
            )}
            {tab === "Closing deal" && (
              <ClosingDeal
                deal={d}
                onChange={(closing) => set("closingDeal", closing)}
                onCreate={(offer, closing) => {
                  setD((s) => ({
                    ...s,
                    offers: [...s.offers, offer],
                    selectedOfferId: offer.id,
                    closingDeal: closing,
                    offerSheet: { ...s.offerSheet, offerId: offer.id },
                  }));
                  setTab("AC offers");
                }}
              />
            )}
            {tab === "Sale details" && (
              <>
                <div className="form-section-title">
                  <h3>
                    {d.status === "Won"
                      ? "A win worth getting right."
                      : "Get ready for the next step."}
                  </h3>
                  <p>
                    A signed deal awaiting documents remains incomplete until
                    the required checks are done.
                  </p>
                </div>
                {d.status === "Won" && (
                  <div className="notice success">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>
                        Sale recorded —{" "}
                        {
                          PROCESS_STEPS.filter((s) => d.checklist?.[s.id])
                            .length
                        }{" "}
                        of {PROCESS_STEPS.length} checks complete
                      </strong>
                      <p>
                        Complete the details below and submit documents through
                        the approved Flatpay systems.
                      </p>
                    </div>
                  </div>
                )}
                <div className="form-grid">
                  <Field
                    label="Sale / signature date"
                    type="date"
                    value={d.saleDate}
                    onChange={(v) => set("saleDate", v)}
                    required={d.status === "Won"}
                  />
                  {SALE_FIELDS.map((f) => (
                    <Field
                      key={f.key}
                      label={f.label}
                      type={f.type || "text"}
                      value={d.saleInfo?.[f.key]}
                      onChange={(v) =>
                        set("saleInfo", { ...d.saleInfo, [f.key]: v })
                      }
                    />
                  ))}
                </div>
                <div className="notice">
                  <Info size={17} />
                  <p>
                    {
                      SALE_FIELDS.filter(
                        (f) => f.required && !d.saleInfo?.[f.key],
                      ).length
                    }{" "}
                    required contract details remain to be recorded. You can
                    save a sale awaiting documents and return to complete it.
                  </p>
                </div>
                <div className="form-section-title">
                  <h3>Sale completion checklist</h3>
                  <p>
                    Record verification only. Do not upload identity or bank
                    documents here.
                  </p>
                </div>
                <div className="checklist">
                  {PROCESS_STEPS.map((s) => (
                    <label key={s.id}>
                      <input
                        type="checkbox"
                        checked={!!d.checklist?.[s.id]}
                        onChange={(e) =>
                          set("checklist", {
                            ...d.checklist,
                            [s.id]: e.target.checked,
                          })
                        }
                      />
                      <div>
                        <strong>{s.label}</strong>
                        <small>{s.description}</small>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
            {tab === "Commission" && (
              <>
                <div className="form-section-title">
                  <h3>Your commission, without the guesswork.</h3>
                  <p>
                    Record the amount verified by your manager or the official
                    calculator.
                  </p>
                </div>
                <div className="notice">
                  <Info size={18} />
                  <div>
                    <strong>Automatic calculator rules are connected</strong>
                    <p>
                      Choose the commission model below to calculate this offer
                      automatically. Confirm a final amount separately when
                      approved by your manager.
                    </p>
                    <a
                      className="inline-link"
                      href="https://sm-commission.pages.dev/SM_1_Introduction"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open commission calculator <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
                <div className="form-grid">
                  <Field
                    label="Total verified commission"
                    type="number"
                    suffix="GBP"
                    value={d.commissionAmount}
                    onChange={(v) => set("commissionAmount", v)}
                  />
                </div>
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={d.commissionConfirmed}
                    onChange={(e) =>
                      set("commissionConfirmed", e.target.checked)
                    }
                  />
                  <span>
                    I have verified this amount with the official calculator or
                    my manager.
                  </span>
                </label>
                <p className="helper">
                  Confirmed amounts count toward the month of the sale. Actual
                  payout depends on installation, transaction milestones and
                  payroll adjustments.
                </p>
                <CommissionMilestones d={d} set={set} />
              </>
            )}
          </div>
          <footer className="editor-footer">
            <div>
              {d.id && (
                <button
                  type="button"
                  className="delete-button"
                  onClick={() => setDeletePrompt(true)}
                  aria-label="Delete merchant"
                >
                  <Trash2 size={17} />
                </button>
              )}
              {deletePrompt && (
                <span className="delete-confirm">
                  Delete this merchant?{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onDelete(d);
                        onClose();
                      } catch (e) {
                        setErrors([e.message]);
                        setDeletePrompt(false);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setDeletePrompt(false)}>
                    Keep
                  </button>
                </span>
              )}
            </div>
            <div>
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button disabled={busy} className="button primary" type="submit">
                {busy
                  ? "Saving…"
                  : demo && d.id?.startsWith("demo-")
                    ? "Save demo changes"
                    : "Save merchant"}
                <Check size={16} />
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
function CommissionMilestones({ d, set }) {
  const details = d.commissionDetails || {};
  const update = (k, v) => set("commissionDetails", { ...details, [k]: v });
  const result = estimateCurrentCommission(d, { asOfDate: isoToday() });
  const offer =
    d.offers.find((o) => o.id === (d.acceptedOfferId || d.selectedOfferId)) ||
    d.offers.at(-1);
  const annualFallback =
    Number(d.saleInfo?.expectedMonthlyTpv || d.monthlyVolume || 0) * 12;
  const check = (key, label, hint) => (
    <label className="confirmation" key={key}>
      <input
        type="checkbox"
        checked={!!details[key]}
        onChange={(e) => update(key, e.target.checked)}
      />
      <span>
        {label}
        {hint && <small className="checkbox-hint">{hint}</small>}
      </span>
    </label>
  );
  return (
    <>
      <div className="form-section-title">
        <h3>Automatic offer commission</h3>
        <p>
          Uses the selected AC’s rate and declared annual turnover. One merchant
          counts as one deal, regardless of hardware quantities.
        </p>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Commission model</span>
          <select
            value={details.model || ""}
            onChange={(e) => update("model", e.target.value)}
          >
            <option value="">Choose a model</option>
            <option value="terminal">Terminal only</option>
            <option value="pos">POS Premium / POS Pro</option>
            <option value="mpos">mPOS</option>
          </select>
        </label>
        <Field
          label="Declared annual card turnover"
          type="number"
          suffix="GBP / year"
          value={details.annualTpv ?? (annualFallback || "")}
          hint="Defaults to contracted monthly turnover × 12, or statement monthly value × 12."
          onChange={(v) => update("annualTpv", v)}
        />
        {details.model !== "terminal" && (
          <Field
            label="Full upfront POS price"
            type="number"
            suffix="GBP"
            value={details.upfrontAmount ?? details.posUpfrontPaid}
            onChange={(v) => update("upfrontAmount", v)}
          />
        )}
        <div className="selected-rate-summary">
          <small>Selected AC rate</small>
          <strong>
            {offer?.rate !== undefined && offer.rate !== ""
              ? pct(offer.rate)
              : "Choose an AC offer"}
          </strong>
          <span>Matrix rate from your selected offer.</span>
        </div>
      </div>
      {check(
        "ownGenerated",
        "Own-generated merchant",
        "£50 installation bonus.",
      )}
      {check(
        "quickInstall",
        "Quick installation",
        "£50 when installed within 5 days of receiving the link.",
      )}
      {check(
        "ihQuickSale",
        "IH quick sale",
        "£30 for an in-house lead closed within 24 hours. Do not combine with own-generated.",
      )}
      <div className="form-section-title">
        <h3>Record each earning milestone</h3>
        <p>
          Dates determine the payout month. Activation is 0.5% of declared
          annual turnover under the current scheme.
        </p>
      </div>
      <div className="form-grid">
        <Field
          label="Actual installation date"
          type="date"
          value={details.installedDate}
          onChange={(v) => update("installedDate", v)}
        />
        <Field
          label="Transacted since installation"
          type="number"
          suffix="GBP"
          value={details.transactedSinceInstall}
          onChange={(v) => update("transactedSinceInstall", v)}
        />
        <Field
          label="Activation threshold reached date"
          type="date"
          value={details.activationDate}
          onChange={(v) => update("activationDate", v)}
        />
        <Field
          label="Rolling 30-day TPV"
          type="number"
          suffix="GBP"
          value={details.rolling30DayTpv}
          onChange={(v) => update("rolling30DayTpv", v)}
        />
        <Field
          label="TPV target reached date"
          type="date"
          value={details.tpvThresholdDate}
          onChange={(v) => update("tpvThresholdDate", v)}
        />
        <Field
          label="POS payment received in full date"
          type="date"
          value={details.upfrontPaidDate}
          onChange={(v) => update("upfrontPaidDate", v)}
        />
        <Field
          label="IH quick sale qualification date"
          type="date"
          value={details.quickSaleDate}
          onChange={(v) => update("quickSaleDate", v)}
        />
        <Field
          label="Amex TPV in first Amex-active month"
          type="number"
          suffix="GBP"
          value={details.amexFirstActiveMonthTpv}
          onChange={(v) => update("amexFirstActiveMonthTpv", v)}
        />
        <Field
          label="Amex qualification date"
          type="date"
          value={details.amexQualificationDate}
          onChange={(v) => update("amexQualificationDate", v)}
        />
      </div>
      {check(
        "paidInFull",
        "Flatpay has received the upfront POS payment in full.",
      )}
      <div className="milestones">
        <span className={result.activationMet ? "complete" : ""}>
          <CheckCircle2 size={17} />
          Activation:{" "}
          {result.activationThreshold === null
            ? "complete annual TPV"
            : money(result.activationThreshold)}{" "}
          transacted
        </span>
        <span className={result.tpvTargetMet ? "complete" : ""}>
          <CheckCircle2 size={17} />
          30-day target:{" "}
          {result.tpvTarget === null
            ? "complete annual TPV"
            : money(result.tpvTarget)}
        </span>
      </div>
      <div className="estimate-summary">
        <div>
          <span>Total official-rule projection</span>
          <strong>
            {result.total === null ? "Incomplete" : money(result.total)}
          </strong>
        </div>
        <div>
          <span>Eligible by recorded milestones</span>
          <strong>
            {result.eligibleNow === null
              ? "Incomplete"
              : money(result.eligibleNow)}
          </strong>
        </div>
      </div>
      <div className="commission-breakdown">
        {result.breakdown.map((row) => (
          <div key={row.id}>
            <span>{row.label}</span>
            <strong>{row.total === null ? "Unknown" : money(row.total)}</strong>
            <small>
              {row.eligible !== null && row.eligible !== 0
                ? row.payMonth
                  ? `Due ${row.payMonth}`
                  : "Record earning date"
                : "Not yet eligible"}
            </small>
          </div>
        ))}
      </div>
      <details className="commission-notes">
        <summary>Calculator source & conditions</summary>
        {result.notes.map((note, i) => (
          <p key={i}>{note}</p>
        ))}
        <p>
          Source: SM launch scheme, draft v2 (May 2026), checked 27 October
          2026. Monthly POS volume bonuses and the £2,120 salary guarantee are
          calculated at portfolio level above, not per merchant.
        </p>
      </details>
      <div className="form-section-title">
        <h3>Churn & adjustments</h3>
        <p>
          Record actual events and paid amounts. Projected commission does not
          automatically change a manager-confirmed figure.
        </p>
      </div>
      <div className="form-grid">
        <Field
          label="Cancellation date"
          type="date"
          value={details.cancellationDate}
          onChange={(v) => update("cancellationDate", v)}
        />
        <Field
          label="Actual TPV in first three months"
          type="number"
          suffix="GBP"
          value={details.firstThreeMonthsTpv}
          onChange={(v) => update("firstThreeMonthsTpv", v)}
        />
        <Field
          label="Churn recorded date"
          type="date"
          value={details.churnDate}
          onChange={(v) => update("churnDate", v)}
        />
        <Field
          label="Commission already paid"
          type="number"
          suffix="GBP"
          value={details.paidCommissionToDate}
          onChange={(v) => update("paidCommissionToDate", v)}
        />
        <Field
          label="Amex rate reduced / removed date"
          type="date"
          value={details.amexRateReducedDate}
          onChange={(v) => update("amexRateReducedDate", v)}
        />
        <Field
          label="Amex bonus already paid"
          type="number"
          suffix="GBP"
          value={details.amexBonusPaid}
          onChange={(v) => update("amexBonusPaid", v)}
        />
      </div>
      {check(
        "seasonal",
        "Seasonal business",
        "Exempt from the three-month low-volume churn test, but not cancellation churn.",
      )}
      {(result.churnRisk || details.amexRateReducedDate) && (
        <div className="notice error">
          <Info size={16} />
          <div>
            <strong>Review a potential commission reversal</strong>
            <p>
              {result.churnReasons?.join(" ")} Recorded clawback:{" "}
              {result.clawback === null
                ? "Enter the actual paid commission to calculate"
                : money(result.clawback)}
              .
            </p>
          </div>
        </div>
      )}
    </>
  );
}
function PayoutSchedule({ deals, month }) {
  const won = deals.filter((d) => d.status === "Won");
  const rows = won.flatMap((d) =>
    estimateCurrentCommission(d, { asOfDate: isoToday() })
      .breakdown.filter(
        (row) =>
          row.eligible !== null && row.eligible !== 0 && row.payMonth === month,
      )
      .map((row) => ({
        ...row,
        merchant: d.businessName,
        id: `${d.id}-${row.id}`,
      })),
  );
  const missing = won.filter((d) => {
    const estimate = estimateCurrentCommission(d, { asOfDate: isoToday() });
    return (
      estimate.missingInputs.length > 0 ||
      estimate.breakdown.some(
        (row) => row.eligible !== null && row.eligible !== 0 && !row.payMonth,
      )
    );
  }).length;
  return (
    <section className="panel payout-panel">
      <div className="panel-heading">
        <div>
          <h2>Milestone earnings due this month</h2>
          <p>
            Current-rule estimate from recorded events. Portfolio bonuses and
            the salary guarantee appear in the planning calculator separately.
          </p>
        </div>
        <strong className="payout-total">
          {money(rows.reduce((sum, row) => sum + row.eligible, 0))}
        </strong>
      </div>
      {rows.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Earning component</th>
                <th>Estimated payout</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.merchant}</td>
                  <td>{row.label}</td>
                  <td>{money(row.eligible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="payout-empty">
          No dated eligible milestones fall in this payout month.
        </p>
      )}
      <div className="table-footer">
        <span>
          {missing} won {missing === 1 ? "sale has" : "sales have"} incomplete
          amount or milestone inputs.
        </span>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(
  cloudMode ? (
    <CloudAccountGate>
      {({ user, onSignOut }) => <App user={user} onSignOut={onSignOut} />}
    </CloudAccountGate>
  ) : (
    <App />
  ),
);
