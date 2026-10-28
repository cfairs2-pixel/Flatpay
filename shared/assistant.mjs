import { randomUUID } from "node:crypto";
import {
  DEFAULT_ASSISTANT_MODEL,
  runAdvancedAssistant,
} from "./advanced-assistant.mjs";
import {
  computeAssistantMetrics,
  localAssistantReply,
  londonToday,
  validateChatInput,
  validateTargets,
} from "./assistant-logic.mjs";
export {
  computeAssistantMetrics,
  localAssistantReply,
  londonToday,
  validateChatInput,
  validateTargets,
} from "./assistant-logic.mjs";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};

/** No deal write tools are supplied to the model. Notes and follow-ups are suggestions only. */
export function createAssistantService(
  db,
  {
    listDeals,
    getKnowledge = () => [],
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL || DEFAULT_ASSISTANT_MODEL,
    fetchImpl = fetch,
    now = () => new Date(),
  } = {},
) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS assistant_settings (key TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS assistant_messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, mode TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  const getSetting = db.prepare(
    "SELECT payload FROM assistant_settings WHERE key = ?",
  );
  const putSetting = db.prepare(
    "INSERT INTO assistant_settings(key, payload) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload",
  );
  const settings = (key, fallback) => {
    const found = getSetting.get(key);
    return found ? JSON.parse(found.payload) : fallback;
  };
  const preferences = () => settings("preferences", []);
  const targets = () => settings("targets", { sales: null, commission: null });
  const history = () =>
    db
      .prepare(
        "SELECT id, role, content, mode, created_at AS createdAt FROM assistant_messages ORDER BY rowid DESC LIMIT 80",
      )
      .all()
      .reverse();
  const storeMessage = (role, content, mode) => {
    const item = {
      id: randomUUID(),
      role,
      content,
      mode,
      createdAt: now().toISOString(),
    };
    db.prepare(
      "INSERT INTO assistant_messages (id, role, content, mode, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(item.id, role, content, mode, item.createdAt);
    db.exec(
      "DELETE FROM assistant_messages WHERE rowid NOT IN (SELECT rowid FROM assistant_messages ORDER BY rowid DESC LIMIT 200)",
    );
    return item;
  };
  const configured = typeof apiKey === "string" && apiKey.trim().length > 0;
  const safeModel =
    typeof model === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(model)
      ? model
      : DEFAULT_ASSISTANT_MODEL;
  return {
    status: ({ demo = false } = {}) => ({
      mode: configured ? "ai" : "local",
      model: configured ? safeModel : null,
      messages: demo ? [] : history(),
      preferences: demo ? [] : preferences(),
      targets: demo ? { sales: null, commission: null } : targets(),
    }),
    addPreference(input) {
      if (
        !isObject(input) ||
        typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.length > 1000
      )
        fail("A preference must contain 1 to 1,000 characters.");
      const items = preferences();
      if (items.length >= 30)
        fail("Keep up to 30 preferences. Remove an older one first.");
      const item = { id: randomUUID(), text: input.text.trim() };
      putSetting.run("preferences", JSON.stringify([...items, item]));
      return item;
    },
    deletePreference(id) {
      const items = preferences();
      if (!items.some((item) => item.id === id))
        fail("Preference was not found.", 404);
      putSetting.run(
        "preferences",
        JSON.stringify(items.filter((item) => item.id !== id)),
      );
      return { ok: true };
    },
    setTargets(input) {
      const result = validateTargets(input);
      putSetting.run("targets", JSON.stringify(result));
      return result;
    },
    clearHistory() {
      db.exec("DELETE FROM assistant_messages");
      return { ok: true };
    },
    async chat(input) {
      const today = londonToday(now());
      const request = validateChatInput(input, today);
      const deals = request.demo ? request.deals : listDeals();
      const deal = request.dealId
        ? deals.find((item) => item.id === request.dealId)
        : null;
      if (request.dealId && !deal)
        fail("Selected merchant was not found. Save the merchant first.", 404);
      const savedPreferences = request.demo ? [] : preferences();
      const knowledge = request.demo ? [] : await getKnowledge();
      const metrics = computeAssistantMetrics(
        deals,
        request.month,
        request.demo ? { sales: null, commission: null } : targets(),
        today,
      );
      const context = {
        ...request,
        deal,
        deals,
        metrics,
        preferences: savedPreferences,
      };
      let result,
        mode = "local",
        warning;
      if (configured) {
        try {
          result = await runAdvancedAssistant(
            {
              message: request.message,
              month: request.month,
              dealId: request.dealId,
              notes: request.notes,
              deals,
              history: request.demo ? [] : history(),
              preferences: savedPreferences,
              knowledge,
              targets: request.demo
                ? { sales: null, commission: null }
                : targets(),
            },
            { apiKey, model: safeModel, fetchImpl, today },
          );
          mode = "ai";
        } catch (error) {
          warning = `${error?.status ? error.message : "The AI service could not respond."} This reply uses the local calculator and drafting tools.`;
        }
      }
      result ??= localAssistantReply(context);
      const answer = {
        ...result,
        mode,
        metrics,
        ...(warning ? { warning } : {}),
      };
      if (!request.demo) {
        storeMessage("user", request.message, mode);
        answer.message = storeMessage("assistant", result.reply, mode);
      }
      return answer;
    },
  };
}
