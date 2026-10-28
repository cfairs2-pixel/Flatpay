import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createAppServer } from "../server.mjs";

const merchant = () => ({
  businessName: "API Test Café",
  contactName: "Test Contact",
  status: "Lead",
  monthlyVolume: 50000,
  currentCharges: 650,
  businessVolume: 5000,
  internationalVolume: 2000,
  amexVolume: 1000,
  amexRate: 2.5,
  offers: [
    {
      id: "offer-1",
      rate: 0.9,
      amexRate: 2.5,
      acLink: "https://example.com/ac/1",
      hardware: { terminal: 2, posPremium: 0, posPro: 0, mpos: 0 },
    },
  ],
});
async function start(dataDir) {
  const app = await createAppServer({ dataDir, frontend: false });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}
async function jsonRequest(base, route, method = "GET", body, headers = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("API creates, edits, exports, persists across restart and deletes merchant records", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flatpay-api-"));
  let app = await start(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  assert.deepEqual((await jsonRequest(app.base, "/api/health")).body, {
    ok: true,
  });
  assert.deepEqual((await jsonRequest(app.base, "/api/deals")).body, []);
  const created = await jsonRequest(app.base, "/api/deals", "POST", {
    ...merchant(),
    id: "cannot-set-this",
    createdAt: "invalid",
  });
  assert.equal(created.status, 201);
  assert.notEqual(created.body.id, "cannot-set-this");
  assert.ok(Number.isFinite(Date.parse(created.body.createdAt)));
  const id = created.body.id;
  const edited = await jsonRequest(app.base, `/api/deals/${id}`, "PUT", {
    ...created.body,
    id: "cannot-change-this",
    createdAt: "invalid",
    status: "Won",
    saleDate: "2026-10-27",
    commissionAmount: 123.45,
    commissionConfirmed: true,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.id, id);
  assert.equal(edited.body.createdAt, created.body.createdAt);
  const exported = await jsonRequest(app.base, "/api/export");
  assert.equal(exported.body.version, 1);
  assert.equal(exported.body.deals.length, 1);
  assert.equal(exported.body.deals[0].commissionAmount, 123.45);
  await app.close();
  app = await start(dataDir);
  const restored = (await jsonRequest(app.base, "/api/deals")).body;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].status, "Won");
  assert.equal(
    (await jsonRequest(app.base, `/api/deals/${id}`, "DELETE")).status,
    200,
  );
  assert.deepEqual((await jsonRequest(app.base, "/api/deals")).body, []);
  assert.equal(
    (await jsonRequest(app.base, `/api/deals/${id}`, "DELETE")).status,
    404,
  );
});

test("API rejects invalid figures, unsafe AC links and cross-origin mutations", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flatpay-validation-"));
  const app = await start(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  assert.equal(
    (
      await jsonRequest(app.base, "/api/deals", "POST", {
        ...merchant(),
        currentCharges: -1,
      })
    ).status,
    400,
  );
  const invalidLink = merchant();
  invalidLink.offers[0].acLink = "javascript:alert(1)";
  assert.equal(
    (await jsonRequest(app.base, "/api/deals", "POST", invalidLink)).status,
    400,
  );
  assert.equal(
    (
      await jsonRequest(app.base, "/api/deals", "POST", merchant(), {
        Origin: "https://unrelated.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await jsonRequest(app.base, "/api/deals", "POST", merchant(), {
        "Sec-Fetch-Site": "cross-site",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await jsonRequest(app.base, "/api/deals", "POST", merchant(), {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  const untrustedHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      `${app.base}/api/deals`,
      { headers: { Host: "untrusted.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.once("error", reject);
  });
  assert.equal(untrustedHostStatus, 403);
  assert.equal(
    (
      await jsonRequest(app.base, "/api/deals", "POST", merchant(), {
        Origin: app.base,
      })
    ).status,
    201,
  );
  const oversized = await fetch(`${app.base}/api/deals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...merchant(), notes: "a".repeat(1024 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await jsonRequest(app.base, "/api/deals")).body.length, 1);
});

test("minimal API records receive safe UI defaults and canonical statuses", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "flatpay-defaults-"));
  const app = await start(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const record = await jsonRequest(app.base, "/api/deals", "POST", {
    businessName: "Minimal Merchant",
  });
  assert.equal(record.status, 201);
  assert.equal(record.body.status, "Lead");
  assert.deepEqual(record.body.offers, []);
  assert.deepEqual(record.body.checklist, {});
  const won = await jsonRequest(
    app.base,
    `/api/deals/${record.body.id}`,
    "PUT",
    { businessName: "Minimal Merchant", status: "won", saleDate: "2026-10-27" },
  );
  assert.equal(won.status, 200);
  assert.equal(won.body.status, "Won");
});
