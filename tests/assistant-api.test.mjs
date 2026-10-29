import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../server.mjs";

async function start(dataDir) {
  const app = await createAppServer({
    dataDir,
    frontend: false,
    assistantOptions: {
      apiKey: "",
      now: () => new Date("2026-10-27T12:00:00Z"),
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}
async function request(app, route, method = "GET", body, headers = {}) {
  const response = await fetch(`${app.base}${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
test("assistant API persists preferences, targets and real chat with origin checks", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flatpay-assistant-"));
  let app = await start(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  assert.equal((await request(app, "/api/assistant")).body.mode, "local");
  const preference = await request(app, "/api/assistant/preferences", "POST", {
    text: "Keep drafts concise",
  });
  assert.equal(preference.status, 201);
  assert.equal(
    (
      await request(app, "/api/assistant/targets", "PUT", {
        sales: 8,
        commission: 2500,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app, "/api/assistant/chat", "POST", {
        message: "How am I tracking?",
        month: "2026-10",
      })
    ).body.metrics.targets.sales,
    8,
  );
  assert.equal(
    (
      await request(
        app,
        "/api/assistant/chat",
        "POST",
        { message: "How am I tracking?" },
        { Origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(app, "/api/assistant/chat", "POST", { message: [] })).status,
    400,
  );
  await app.close();
  app = await start(dataDir);
  const status = (await request(app, "/api/assistant")).body;
  assert.equal(status.messages.length, 2);
  assert.equal(status.preferences[0].text, "Keep drafts concise");
  assert.equal(status.targets.commission, 2500);
  const legacyQueryStatus = (await request(app, "/api/assistant?demo=true"))
    .body;
  assert.deepEqual(
    legacyQueryStatus,
    status,
    "legacy query parameters must not switch, hide or replace persisted account state",
  );
  assert.equal(Object.hasOwn(legacyQueryStatus, "demo"), false);
  assert.equal(
    (
      await request(
        app,
        `/api/assistant/preferences/${preference.body.id}`,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(app, "/api/assistant/history", "DELETE")).status,
    200,
  );
  assert.equal((await request(app, "/api/assistant")).body.messages.length, 0);
});

test("assistant API rejects client demo records without changing merchants, history or account settings", async (t) => {
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "flatpay-assistant-input-"),
  );
  const app = await start(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const merchant = await request(app, "/api/deals", "POST", {
    businessName: "Saved account merchant",
    monthlyVolume: 20000,
    status: "Lead",
  });
  assert.equal(merchant.status, 201);
  await request(app, "/api/assistant/preferences", "POST", {
    text: "Use a concise tone",
  });
  await request(app, "/api/assistant/targets", "PUT", {
    sales: 6,
    commission: 1500,
  });
  const firstChat = await request(app, "/api/assistant/chat", "POST", {
    message: "How am I tracking?",
    month: "2026-10",
  });
  assert.equal(firstChat.status, 200);
  assert.equal(firstChat.body.metrics.activeCount, 1);
  assert.equal(firstChat.body.metrics.pipelineMonthlyTpv, 20000);
  const beforeMerchants = (await request(app, "/api/deals")).body;
  const beforeState = (await request(app, "/api/assistant")).body;
  const rejectedPayloads = [
    { message: "How am I tracking?", demo: true },
    { message: "How am I tracking?", demo: true, deals: [] },
    ...[
      null,
      [],
      {},
      "injected",
      0,
      true,
      [
        {
          ...merchant.body,
          businessName: "Injected replacement",
          monthlyVolume: 999999,
        },
      ],
    ].map((deals) => ({ message: "How am I tracking?", deals })),
  ];
  for (const payload of rejectedPayloads) {
    const result = await request(app, "/api/assistant/chat", "POST", payload);
    assert.equal(
      result.status,
      400,
      `must reject client context: ${JSON.stringify(payload)}`,
    );
    assert.equal(typeof result.body.error, "string");
    assert.match(
      result.body.error,
      /demo|saved|merchant|deal|account|workspace/i,
    );
    assert.deepEqual((await request(app, "/api/deals")).body, beforeMerchants);
    assert.deepEqual((await request(app, "/api/assistant")).body, beforeState);
  }
  const legacyFalse = await request(app, "/api/assistant/chat", "POST", {
    message: "How am I tracking?",
    month: "2026-10",
    demo: false,
  });
  assert.equal(legacyFalse.status, 200);
  assert.equal(Object.hasOwn(legacyFalse.body, "demo"), false);
  assert.equal(legacyFalse.body.metrics.activeCount, 1);
  assert.equal(legacyFalse.body.metrics.pipelineMonthlyTpv, 20000);
  const afterState = (await request(app, "/api/assistant")).body;
  assert.equal(afterState.messages.length, beforeState.messages.length + 2);
  assert.deepEqual(afterState.preferences, beforeState.preferences);
  assert.deepEqual(afterState.targets, beforeState.targets);
  assert.deepEqual(
    (await request(app, "/api/assistant?demo=true")).body,
    afterState,
  );
  assert.deepEqual((await request(app, "/api/deals")).body, beforeMerchants);
});
