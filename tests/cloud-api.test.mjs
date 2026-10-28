import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCloudServer } from "../server-cloud.mjs";
const setupToken = "owner-setup-token-longer-than-thirty-two-characters";
async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "myflatpay-cloud-"));
  const app = await createCloudServer({
    dataDir,
    frontend: false,
    setupToken,
    secureCookies: false,
    assistantOptions: { apiKey: "" },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  async function req(route, { method = "GET", body, cookie } = {}) {
    const r = await fetch(base + route, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const owner = await req("/api/auth/signup", {
    method: "POST",
    body: {
      name: "Owner",
      email: "owner@example.com",
      password: "Long-owner-password!",
      setupToken,
    },
  });
  assert.equal(owner.status, 201);
  const invitation = await req("/api/team/invites", {
    method: "POST",
    cookie: owner.cookie,
    body: { email: "seller@example.com" },
  });
  const seller = await req("/api/auth/signup", {
    method: "POST",
    body: {
      name: "Seller",
      email: "seller@example.com",
      password: "Long-seller-password!",
      inviteCode: invitation.body.inviteCode,
    },
  });
  assert.equal(seller.status, 201);
  return { req, owner, seller };
}
test("cloud accounts isolate sales, exports, assistant memory, and owner team access", async (t) => {
  const { req, owner, seller } = await fixture(t);
  assert.equal((await req("/api/deals")).status, 401);
  const created = await req("/api/deals", {
    method: "POST",
    cookie: owner.cookie,
    body: { businessName: "Private Owner Merchant", provider: "Dojo" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(
    (await req("/api/deals", { cookie: seller.cookie })).body,
    [],
  );
  assert.equal(
    (
      await req(`/api/deals/${created.body.id}`, {
        method: "PUT",
        cookie: seller.cookie,
        body: { businessName: "Takeover" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req(`/api/deals/${created.body.id}`, {
        method: "DELETE",
        cookie: seller.cookie,
      })
    ).status,
    404,
  );
  assert.deepEqual(
    (await req("/api/export", { cookie: seller.cookie })).body.deals,
    [],
  );
  assert.equal(
    (await req("/api/team/summary", { cookie: seller.cookie })).status,
    403,
  );
  assert.equal(
    (await req("/api/team/summary", { cookie: owner.cookie })).body.members
      .length,
    2,
  );
  await req("/api/assistant/preferences", {
    method: "POST",
    cookie: owner.cookie,
    body: { text: "Owner private preference" },
  });
  assert.deepEqual(
    (await req("/api/assistant", { cookie: seller.cookie })).body.preferences,
    [],
  );
});
test("cloud imports preserve browser data without duplicate accounts or cross-user writes", async (t) => {
  const { req, owner, seller } = await fixture(t);
  const legacy = {
    id: "legacy-1",
    businessName: "Imported Coffee",
    provider: "Worldpay",
    offers: [],
    notes: "Original notes",
    status: "Lead",
  };
  const one = await req("/api/deals/import", {
    method: "POST",
    cookie: owner.cookie,
    body: { deals: [legacy] },
  });
  assert.equal(one.status, 201);
  assert.equal(one.body.imported, 1);
  assert.notEqual(one.body.deals[0].id, legacy.id);
  const two = await req("/api/deals/import", {
    method: "POST",
    cookie: owner.cookie,
    body: { deals: [legacy] },
  });
  assert.equal(two.body.skipped, 1);
  assert.equal(two.body.deals.length, 1);
  assert.equal(
    (await req("/api/deals", { cookie: seller.cookie })).body.length,
    0,
  );
});
test("head office documents and feature drafts enforce review and owner publishing", async (t) => {
  const { req, owner, seller } = await fixture(t);
  const d = await req("/api/documents", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "Head office note",
      fileName: "rules.txt",
      mimeType: "text/plain",
      content: "Call the approved support desk.",
      versionLabel: "October",
    },
  });
  assert.equal(d.status, 201);
  assert.equal(
    (await req("/api/documents", { cookie: seller.cookie })).body.documents
      .length,
    0,
  );
  assert.equal(
    (
      await req(`/api/documents/${d.body.id}/review`, {
        method: "POST",
        cookie: seller.cookie,
        body: { approved: true },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req(`/api/documents/${d.body.id}/review`, {
        method: "POST",
        cookie: owner.cookie,
        body: { approved: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await req("/api/documents", { cookie: seller.cookie })).body.documents
      .length,
    1,
  );
  const f = await req("/api/features", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      title: "New calculator",
      description: "A team tool",
      html: "<h1>Hello</h1>",
      css: "",
      javascript: "",
    },
  });
  assert.equal(f.status, 201);
  assert.equal(
    (await req("/api/features", { cookie: seller.cookie })).body.features
      .length,
    0,
  );
  assert.equal(
    (
      await req(`/api/features/${f.body.id}/publish`, {
        method: "POST",
        cookie: owner.cookie,
        body: { published: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await req("/api/features", { cookie: seller.cookie })).body.features
      .length,
    1,
  );
});
test("Condukt applies only reviewed fields to the signed-in account and never completes KYC", async (t) => {
  const { req, owner, seller } = await fixture(t);
  const input =
    "Company name: Customer Cafe\nCurrent provider: Dojo\nContact name: Alex Example\nDocument: Alex Example | Proof of address | Required";
  const preview = await req("/api/condukt/preview", {
    method: "POST",
    cookie: seller.cookie,
    body: { input },
  });
  assert.equal(preview.status, 200);
  const applied = await req("/api/condukt/apply", {
    method: "POST",
    cookie: seller.cookie,
    body: {
      input,
      candidateIndex: 0,
      fieldPaths: preview.body.candidates[0].fieldChanges.map((f) => f.path),
    },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.deal.provider, "Dojo");
  assert.equal(applied.body.deal.condukt.mode, "manual-import");
  assert.deepEqual(applied.body.deal.checklist, {});
  assert.equal(
    (await req("/api/deals", { cookie: owner.cookie })).body.length,
    0,
  );
});
