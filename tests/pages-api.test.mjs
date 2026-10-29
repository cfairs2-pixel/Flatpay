import test from "node:test";
import assert from "node:assert/strict";
import {
  createPagesFetch,
  installPagesApi,
  PAGES_DEALS_KEY,
  PAGES_ASSISTANT_KEY,
} from "../src/pages-api.mjs";

const merchant = () => ({
  businessName: "Existing Coffee",
  status: "Lead",
  monthlyVolume: 10000,
  currentCharges: 200,
  offers: [{ id: "offer-one", rate: 1, amexRate: 2.5 }],
  selectedOfferId: "offer-one",
});
function harness(initial = {}) {
  const map = new Map(Object.entries(initial));
  let next = 0;
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
  };
  const api = createPagesFetch({
    storage,
    location: { href: "https://cfairs2-pixel.github.io/Flatpay/" },
    now: () => new Date("2026-10-27T12:00:00Z"),
    randomUUID: () => `generated-${++next}`,
    fetchImpl: async () => new Response("network"),
  });
  const request = async (route, method = "GET", body, headers = {}) => {
    const res = await api(route, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  return { api, storage, map, request };
}

test("Pages adapter keeps existing envelope and merchant identifiers through upgrade and edits", async () => {
  const existing = {
    ...merchant(),
    id: "old-id",
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-02T10:00:00Z",
    meetingNotes: [{ id: "old-note", body: "Existing note" }],
  };
  const h = harness({
    [PAGES_DEALS_KEY]: JSON.stringify({
      version: 1,
      deals: [existing],
      legacyExtra: "keep-me",
    }),
  });
  assert.deepEqual((await h.request("/api/deals")).body, [existing]);
  const edit = await h.request("/api/deals/old-id", "PUT", {
    ...existing,
    id: "forged",
    createdAt: "forged",
    meetingNotes: [
      ...existing.meetingNotes,
      { id: "new-note", body: "New meeting note" },
    ],
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.id, "old-id");
  assert.equal(edit.body.createdAt, existing.createdAt);
  assert.equal(edit.body.updatedAt, "2026-10-27T12:00:00.000Z");
  const saved = JSON.parse(h.map.get(PAGES_DEALS_KEY));
  assert.equal(saved.legacyExtra, "keep-me");
  assert.equal(saved.deals[0].meetingNotes.length, 2);
  assert.equal((await h.request("/api/export")).body.deals[0].id, "old-id");
  const restored = createPagesFetch({
    storage: h.storage,
    location: { href: "https://cfairs2-pixel.github.io/Flatpay/" },
  });
  assert.equal(
    (await (await restored("/api/deals")).json())[0].meetingNotes.length,
    2,
  );
});

test("Pages CRUD validates input, canonicalises status and never writes failed changes", async () => {
  const h = harness();
  const created = await h.request("/api/deals", "POST", {
    ...merchant(),
    id: "untrusted",
    createdAt: "untrusted",
    status: "lead",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "generated-1");
  assert.equal(created.body.status, "Lead");
  assert.equal(created.body.createdAt, "2026-10-27T12:00:00.000Z");
  const before = h.map.get(PAGES_DEALS_KEY);
  assert.equal(
    (
      await h.request("/api/deals/generated-1", "PUT", {
        ...created.body,
        currentCharges: -4,
      })
    ).status,
    400,
  );
  assert.equal(
    (await h.request("/api/deals/no-such-id", "PUT", merchant())).status,
    404,
  );
  assert.equal(
    (
      await h.request("/api/deals", "POST", merchant(), {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await h.request("/api/deals", "POST", merchant(), {
        Origin: "https://unrelated.example",
      })
    ).status,
    403,
  );
  assert.equal(h.map.get(PAGES_DEALS_KEY), before);
  assert.equal(
    (await h.request("/api/deals/generated-1", "DELETE")).status,
    200,
  );
  assert.deepEqual((await h.request("/api/deals")).body, []);
  assert.equal(
    (await h.request("/api/deals/generated-1", "DELETE")).status,
    404,
  );
});

test("Pages storage failures retain malformed or full data and report an actionable error", async () => {
  const corrupt = "{not-json";
  const h = harness({ [PAGES_DEALS_KEY]: corrupt });
  assert.equal((await h.request("/api/deals")).status, 500);
  assert.equal((await h.request("/api/deals", "POST", merchant())).status, 500);
  assert.equal(h.map.get(PAGES_DEALS_KEY), corrupt);
  const full = harness({
    [PAGES_DEALS_KEY]: JSON.stringify({ version: 1, deals: [] }),
  });
  full.storage.setItem = () => {
    throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
  };
  const failure = await full.request("/api/deals", "POST", merchant());
  assert.equal(failure.status, 507);
  assert.match(failure.body.error, /No changes were saved/);
  assert.deepEqual(JSON.parse(full.map.get(PAGES_DEALS_KEY)).deals, []);
});

test("Pages assistant persists preferences, targets and history while leaving merchants unchanged", async () => {
  const h = harness({
    [PAGES_DEALS_KEY]: JSON.stringify({
      version: 1,
      deals: [{ ...merchant(), id: "saved-one" }],
    }),
  });
  const original = h.map.get(PAGES_DEALS_KEY);
  const preference = await h.request("/api/assistant/preferences", "POST", {
    text: "Keep follow-ups formal.",
  });
  assert.equal(preference.status, 201);
  await h.request("/api/assistant/targets", "PUT", {
    sales: 8,
    commission: 2000,
  });
  const reply = await h.request("/api/assistant/chat", "POST", {
    message: "Summarise meeting notes",
    dealId: "saved-one",
    notes: "Owner wants a Friday call.",
    month: "2026-10",
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.mode, "local");
  assert.equal(reply.body.actions.length, 2);
  assert.match(reply.body.actions[1].text, /Dear/);
  assert.equal(reply.body.metrics.targets.sales, 8);
  assert.equal(h.map.get(PAGES_DEALS_KEY), original);
  const status = (await h.request("/api/assistant")).body;
  assert.equal(status.mode, "local");
  assert.equal(status.messages.length, 2);
  assert.equal(status.preferences[0].text, "Keep follow-ups formal.");
  assert.equal(status.targets.commission, 2000);
  const persisted = JSON.parse(h.map.get(PAGES_ASSISTANT_KEY));
  assert.equal(persisted.messages.length, 2);
  await h.request(`/api/assistant/preferences/${preference.body.id}`, "DELETE");
  await h.request("/api/assistant/history", "DELETE");
  const cleared = (await h.request("/api/assistant")).body;
  assert.deepEqual(cleared.preferences, []);
  assert.deepEqual(cleared.messages, []);
  assert.equal(cleared.targets.sales, 8);
});

test("Pages assistant rejects demo and injected records without changing saved account data", async () => {
  const h = harness({
    [PAGES_DEALS_KEY]: JSON.stringify({
      version: 1,
      deals: [{ ...merchant(), id: "saved-customer" }],
    }),
  });
  await h.request("/api/assistant/preferences", "POST", {
    text: "Private preference",
  });
  await h.request("/api/assistant/targets", "PUT", {
    sales: 10,
    commission: 1000,
  });
  const recorded = await h.request("/api/assistant/chat", "POST", {
    message: "How am I tracking?",
    month: "2026-10",
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.metrics.activeCount, 1);
  assert.equal(recorded.body.metrics.targets.sales, 10);
  const beforeAssistant = h.map.get(PAGES_ASSISTANT_KEY);
  const beforeCustomers = h.map.get(PAGES_DEALS_KEY);
  const saved = (await h.request("/api/assistant")).body;
  const queried = (await h.request("/api/assistant?demo=true")).body;
  assert.deepEqual(queried, saved);
  assert.equal(queried.preferences[0].text, "Private preference");
  assert.equal(queried.messages.length, 2);
  assert.equal(queried.targets.sales, 10);
  for (const input of [
    { demo: true },
    { demo: true, deals: [{ ...merchant(), id: "injected" }] },
    { deals: [{ ...merchant(), id: "injected" }] },
    { deals: [] },
    { demo: false, deals: null },
  ]) {
    const rejected = await h.request("/api/assistant/chat", "POST", {
      message: "How am I tracking?",
      month: "2026-10",
      ...input,
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /saved workspace/);
    assert.equal(h.map.get(PAGES_ASSISTANT_KEY), beforeAssistant);
    assert.equal(h.map.get(PAGES_DEALS_KEY), beforeCustomers);
  }
});

test("Pages interception is same-origin API only and installation can be restored", async () => {
  const h = harness();
  assert.equal(
    await (await h.api("https://external.example/api/deals")).text(),
    "network",
  );
  assert.equal(await (await h.api("/Flatpay/assets/app.js")).text(), "network");
  const request = new Request("https://cfairs2-pixel.github.io/api/deals");
  assert.deepEqual(await (await h.api(request)).json(), []);
  const previous = globalThis.fetch;
  const restore = installPagesApi({
    storage: h.storage,
    location: { href: "https://cfairs2-pixel.github.io/Flatpay/" },
  });
  assert.notEqual(globalThis.fetch, previous);
  restore();
  assert.equal(globalThis.fetch, previous);
});
