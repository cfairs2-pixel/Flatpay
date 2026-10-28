import { validateDeal } from "../shared/domain.mjs";
import {
  londonToday,
  validateChatInput,
  validateTargets,
  computeAssistantMetrics,
  localAssistantReply,
} from "../shared/assistant-logic.mjs";

// Keep the established Pages key so upgrading the app preserves existing merchants.
export const PAGES_DEALS_KEY = "flatpay.sales-workspace.v1";
export const PAGES_ASSISTANT_KEY = "myflatpay.assistant.v1";
const BODY_LIMIT = 1024 * 1024;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const defaults = () => ({
  version: 1,
  messages: [],
  preferences: [],
  targets: { sales: null, commission: null },
});
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const response = (status, value, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

/** Browser-only API for the existing GitHub Pages app. It never sends sales data off-device. */
export function createPagesFetch({
  storage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  location = globalThis.location,
  now = () => new Date(),
  randomUUID = () => globalThis.crypto.randomUUID(),
} = {}) {
  const origin = new URL(
    location?.href || location?.origin || "http://localhost",
  ).origin;
  const base = location?.href || `${origin}/`;
  const store = () => {
    try {
      const result = storage ?? globalThis.localStorage;
      if (!result) throw new Error("No storage");
      return result;
    } catch {
      fail(
        "Browser storage is unavailable. Allow storage for this site to load and save your workspace.",
        503,
      );
    }
  };
  function read(key, fallback) {
    let raw;
    try {
      raw = store().getItem(key);
    } catch (error) {
      if (error.status) throw error;
      fail(
        "Browser storage is unavailable. Allow storage for this site to load and save your workspace.",
        503,
      );
    }
    if (raw === null) return fallback();
    try {
      return JSON.parse(raw);
    } catch {
      fail(
        "Saved browser data could not be read. The original data has been kept unchanged; restore a backup before making changes.",
        500,
      );
    }
  }
  function write(key, value) {
    try {
      store().setItem(key, JSON.stringify(value));
    } catch (error) {
      if (error.status) throw error;
      fail(
        error.name === "QuotaExceededError"
          ? "Browser storage is full. No changes were saved. Export a backup and free space before trying again."
          : "Browser storage could not save this change. No changes were saved. Check this site’s storage settings.",
        error.name === "QuotaExceededError" ? 507 : 503,
      );
    }
  }
  function dealEnvelope() {
    const saved = read(PAGES_DEALS_KEY, () => ({ version: 1, deals: [] }));
    if (
      !object(saved) ||
      saved.version !== 1 ||
      !Array.isArray(saved.deals) ||
      saved.deals.some((d) => !object(d) || typeof d.id !== "string")
    )
      fail(
        "Saved merchant data is not in the supported format. The original data has been kept unchanged.",
        500,
      );
    return saved;
  }
  const list = (envelope) =>
    [...envelope.deals].sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(
        String(a.updatedAt || a.createdAt || ""),
      ),
    );
  function assistantState() {
    const saved = read(PAGES_ASSISTANT_KEY, defaults);
    if (
      !object(saved) ||
      saved.version !== 1 ||
      !Array.isArray(saved.messages) ||
      !Array.isArray(saved.preferences) ||
      !object(saved.targets)
    )
      fail(
        "Saved assistant data could not be read. The original data has been kept unchanged.",
        500,
      );
    if (
      saved.messages.some(
        (m) =>
          !object(m) ||
          typeof m.id !== "string" ||
          !["user", "assistant"].includes(m.role) ||
          typeof m.content !== "string",
      ) ||
      saved.preferences.some(
        (p) =>
          !object(p) || typeof p.id !== "string" || typeof p.text !== "string",
      )
    )
      fail(
        "Saved assistant data could not be read. The original data has been kept unchanged.",
        500,
      );
    validateTargets(saved.targets);
    return saved;
  }
  async function json(req) {
    if (
      req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
    )
      fail("Use application/json for workspace changes.", 415);
    const text = await req.text();
    if (new TextEncoder().encode(text).length > BODY_LIMIT)
      fail("Record exceeds the 1 MB limit.", 413);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      fail("Send a valid JSON workspace record.");
    }
    if (!object(value)) fail("Send a valid JSON workspace record.");
    return value;
  }
  return async function pagesFetch(input, init) {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), base);
    } catch {
      return fetchImpl(input, init);
    }
    // External requests and ordinary assets keep their normal browser behaviour.
    if (url.origin !== origin || !url.pathname.startsWith("/api/"))
      return fetchImpl(input, init);
    let req;
    try {
      req = new Request(input instanceof Request ? input : url.href, init);
      const method = req.method.toUpperCase(),
        pathname = url.pathname;
      const suppliedOrigin = req.headers.get("origin");
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        ((suppliedOrigin && suppliedOrigin !== origin) ||
          req.headers.get("sec-fetch-site") === "cross-site")
      )
        fail("Cross-origin changes are not allowed.", 403);
      if (method === "GET" && pathname === "/api/health")
        return response(200, { ok: true, storage: "browser" });
      if (method === "GET" && pathname === "/api/deals")
        return response(200, list(dealEnvelope()));
      if (method === "GET" && pathname === "/api/export")
        return response(
          200,
          {
            version: 1,
            exportedAt: now().toISOString(),
            deals: list(dealEnvelope()),
          },
          {
            "Content-Disposition":
              'attachment; filename="myflatpay-backup.json"',
          },
        );
      const match = pathname.match(/^\/api\/deals\/([A-Za-z0-9-]+)$/);
      if (
        (method === "POST" && pathname === "/api/deals") ||
        (method === "PUT" && match)
      ) {
        const saved = dealEnvelope(),
          previous = match ? saved.deals.find((d) => d.id === match[1]) : null;
        if (match && !previous) fail("Merchant was not found.", 404);
        const inputRecord = {
          status: "Lead",
          offers: [],
          checklist: {},
          saleInfo: {},
          commissionDetails: {},
          meetingNotes: [],
          ...(await json(req)),
        };
        const statuses = [
          "Lead",
          "Meeting booked",
          "Proposal sent",
          "Negotiation",
          "Won",
          "Lost",
        ];
        if (typeof inputRecord.status === "string")
          inputRecord.status =
            statuses.find(
              (s) => s.toLowerCase() === inputRecord.status.toLowerCase(),
            ) || inputRecord.status;
        const errors = validateDeal(inputRecord);
        if (errors.length) return response(400, { error: errors[0], errors });
        const stamp = now().toISOString();
        const deal = {
          ...inputRecord,
          id: previous?.id || randomUUID(),
          createdAt: previous?.createdAt || stamp,
          updatedAt: stamp,
        };
        const deals = previous
          ? saved.deals.map((d) => (d.id === previous.id ? deal : d))
          : [deal, ...saved.deals];
        write(PAGES_DEALS_KEY, { ...saved, deals });
        return response(previous ? 200 : 201, deal);
      }
      if (method === "DELETE" && match) {
        const saved = dealEnvelope();
        if (!saved.deals.some((d) => d.id === match[1]))
          fail("Merchant was not found.", 404);
        write(PAGES_DEALS_KEY, {
          ...saved,
          deals: saved.deals.filter((d) => d.id !== match[1]),
        });
        return response(200, { ok: true });
      }
      if (method === "GET" && pathname === "/api/assistant") {
        const saved =
          url.searchParams.get("demo") === "true"
            ? defaults()
            : assistantState();
        return response(200, {
          mode: "local",
          model: null,
          storage: "browser",
          messages: saved.messages.slice(-80),
          preferences: saved.preferences,
          targets: saved.targets,
        });
      }
      if (method === "POST" && pathname === "/api/assistant/chat") {
        const request = validateChatInput(await json(req), londonToday(now()));
        const saved = request.demo ? defaults() : assistantState();
        const deals = request.demo ? request.deals : list(dealEnvelope());
        const deal = request.dealId
          ? deals.find((d) => d.id === request.dealId)
          : null;
        if (request.dealId && !deal)
          fail(
            "Selected merchant was not found. Save the merchant first.",
            404,
          );
        const metrics = computeAssistantMetrics(
          deals,
          request.month,
          saved.targets,
          londonToday(now()),
        );
        const result = localAssistantReply({
          ...request,
          deal,
          deals,
          metrics,
          preferences: saved.preferences,
        });
        const answer = { ...result, mode: result.mode || "local", metrics };
        if (!request.demo) {
          const stamp = now().toISOString();
          const message = {
            id: randomUUID(),
            role: "assistant",
            content: result.reply,
            mode: answer.mode,
            actions: answer.actions,
            dealId: answer.context?.selectedDealId || request.dealId,
            createdAt: stamp,
          };
          const user = {
            id: randomUUID(),
            role: "user",
            content: request.message,
            mode: answer.mode,
            createdAt: stamp,
          };
          write(PAGES_ASSISTANT_KEY, {
            ...saved,
            messages: [...saved.messages, user, message].slice(-200),
          });
          answer.message = message;
        }
        return response(200, answer);
      }
      if (method === "PUT" && pathname === "/api/assistant/targets") {
        const targets = validateTargets(await json(req)),
          saved = assistantState();
        write(PAGES_ASSISTANT_KEY, { ...saved, targets });
        return response(200, targets);
      }
      if (method === "POST" && pathname === "/api/assistant/preferences") {
        const inputRecord = await json(req);
        if (
          typeof inputRecord.text !== "string" ||
          !inputRecord.text.trim() ||
          inputRecord.text.length > 1000
        )
          fail("A preference must contain 1 to 1,000 characters.");
        const saved = assistantState();
        if (saved.preferences.length >= 30)
          fail("Keep up to 30 preferences. Remove an older one first.");
        const preference = { id: randomUUID(), text: inputRecord.text.trim() };
        write(PAGES_ASSISTANT_KEY, {
          ...saved,
          preferences: [...saved.preferences, preference],
        });
        return response(201, preference);
      }
      const preferenceMatch = pathname.match(
        /^\/api\/assistant\/preferences\/([A-Za-z0-9-]+)$/,
      );
      if (method === "DELETE" && preferenceMatch) {
        const saved = assistantState();
        if (!saved.preferences.some((p) => p.id === preferenceMatch[1]))
          fail("Preference was not found.", 404);
        write(PAGES_ASSISTANT_KEY, {
          ...saved,
          preferences: saved.preferences.filter(
            (p) => p.id !== preferenceMatch[1],
          ),
        });
        return response(200, { ok: true });
      }
      if (method === "DELETE" && pathname === "/api/assistant/history") {
        const saved = assistantState();
        write(PAGES_ASSISTANT_KEY, { ...saved, messages: [] });
        return response(200, { ok: true });
      }
      return response(404, { error: "API route was not found." });
    } catch (error) {
      return response(error.status || 500, {
        error: error.status
          ? error.message
          : "The browser workspace could not complete that request. Your saved data has been kept unchanged.",
      });
    }
  };
}

/** Install only in the dedicated Pages entrypoint, before React loads its records. */
export function installPagesApi(options = {}) {
  const previous = globalThis.fetch;
  const replacement = createPagesFetch({
    ...options,
    fetchImpl: options.fetchImpl || previous?.bind(globalThis),
  });
  globalThis.fetch = replacement;
  return () => {
    if (globalThis.fetch === replacement) globalThis.fetch = previous;
  };
}
