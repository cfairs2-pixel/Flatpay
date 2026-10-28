import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCloudIdentity } from "../shared/cloud-identity.mjs";

const setupToken = "test-owner-setup-code-with-at-least-32-characters";
const password = "a sufficiently long password";
function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let stamp = Date.parse("2026-10-27T12:00:00Z");
  const identity = createCloudIdentity(db, {
    setupToken,
    now: () => stamp,
    ...options,
  });
  async function call(path, method = "GET", input, cookie, extraHeaders = {}) {
    const req = {
      method,
      headers: {
        host: "myflatpay.example",
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      socket: { remoteAddress: "127.0.0.1" },
    };
    const headers = {};
    const res = {
      setHeader: (key, value) => {
        headers[key.toLowerCase()] = value;
      },
    };
    let status, body;
    const handled = await identity.handle(req, res, path, {
      readJson: async () => input,
      respond: (_res, code, value) => {
        status = code;
        body = value;
      },
    });
    return {
      handled,
      status,
      body,
      headers,
      cookie: headers["set-cookie"]?.split(";")[0],
    };
  }
  const owner = () =>
    call("/api/auth/signup", "POST", {
      name: "Team Owner",
      email: "Owner@Example.com",
      password,
      setupToken,
    });
  return {
    db,
    identity,
    call,
    owner,
    advance: (ms) => {
      stamp += ms;
    },
  };
}
const statusIs = (status) => (error) => error.status === status;

test("cloud identity gates first-owner setup and keeps passwords/session tokens out of records and responses", async (t) => {
  const f = fixture(t);
  assert.deepEqual((await f.call("/api/auth/me")).body, {
    user: null,
    needsSetup: true,
    setupAvailable: true,
  });
  await assert.rejects(
    () =>
      f.call("/api/auth/signup", "POST", {
        name: "Owner",
        email: "owner@example.com",
        password,
        setupToken: "wrong",
      }),
    statusIs(403),
  );
  assert.equal(
    f.db.prepare("SELECT count(*) AS count FROM accounts").get().count,
    0,
  );
  const made = await f.owner();
  assert.equal(made.status, 201);
  assert.deepEqual(Object.keys(made.body.user).sort(), [
    "email",
    "id",
    "name",
    "role",
  ]);
  assert.equal(made.body.user.email, "owner@example.com");
  assert.equal(made.body.user.role, "owner");
  assert.match(
    made.headers["set-cookie"],
    /HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/,
  );
  const account = f.db.prepare("SELECT * FROM accounts").get(),
    session = f.db.prepare("SELECT * FROM sessions").get();
  assert.match(account.password_hash, /^scrypt-v1\$/);
  assert.ok(!account.password_hash.includes(password));
  assert.ok(!JSON.stringify(session).includes(made.cookie.split("=")[1]));
  const me = await f.call("/api/auth/me", "GET", undefined, made.cookie);
  assert.equal(me.body.user.id, made.body.user.id);
  assert.equal(me.body.needsSetup, false);
  assert.equal(me.body.setupAvailable, false);
  assert.equal(
    f.identity.getUser({ headers: { cookie: "myflatpay_session=malformed" } }),
    null,
  );
});

test("an unconfigured owner secret prevents anonymous takeover and concurrent setup creates exactly one owner", async (t) => {
  const disabled = fixture(t, { setupToken: undefined });
  assert.equal(
    (await disabled.call("/api/auth/me")).body.setupAvailable,
    false,
  );
  await assert.rejects(disabled.owner, statusIs(503));
  const f = fixture(t);
  const result = await Promise.allSettled([
    f.call("/api/auth/signup", "POST", {
      name: "First",
      email: "first@example.com",
      password,
      setupToken,
    }),
    f.call("/api/auth/signup", "POST", {
      name: "Second",
      email: "second@example.com",
      password,
      setupToken,
    }),
  ]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(
    result.find((item) => item.status === "rejected").reason.status,
    409,
  );
  assert.equal(
    f.db.prepare("SELECT count(*) AS count FROM accounts").get().count,
    1,
  );
});

test("owner invitations are email-bound, single-use, expiring and revocable, with separate salesperson identity", async (t) => {
  const f = fixture(t),
    owner = await f.owner();
  await assert.rejects(
    () => f.call("/api/team/invites", "POST", { email: "sales@example.com" }),
    statusIs(401),
  );
  const invite = await f.call(
    "/api/team/invites",
    "POST",
    { email: "Sales@Example.com" },
    owner.cookie,
  );
  assert.equal(invite.body.role, "sales");
  assert.equal(invite.body.email, "sales@example.com");
  const stored = f.db.prepare("SELECT * FROM invitations").get();
  assert.ok(!JSON.stringify(stored).includes(invite.body.inviteCode));
  await assert.rejects(
    () =>
      f.call("/api/auth/signup", "POST", {
        name: "Wrong",
        email: "wrong@example.com",
        password,
        inviteCode: invite.body.inviteCode,
      }),
    statusIs(403),
  );
  const sales = await f.call("/api/auth/signup", "POST", {
    name: "Salesperson",
    email: "SALES@example.COM",
    password,
    inviteCode: invite.body.inviteCode,
  });
  assert.equal(sales.body.user.role, "sales");
  assert.notEqual(sales.body.user.id, owner.body.user.id);
  assert.equal(
    (await f.call("/api/auth/me", "GET", undefined, owner.cookie)).body.user
      .role,
    "owner",
  );
  assert.equal(
    (await f.call("/api/auth/me", "GET", undefined, sales.cookie)).body.user
      .role,
    "sales",
  );
  await assert.rejects(
    () => f.call("/api/team", "GET", undefined, sales.cookie),
    statusIs(403),
  );
  await assert.rejects(
    () =>
      f.call(
        "/api/team/invites",
        "POST",
        { email: "other@example.com", role: "owner" },
        sales.cookie,
      ),
    statusIs(403),
  );
  const team = await f.call("/api/team", "GET", undefined, owner.cookie);
  assert.equal(team.body.users.length, 2);
  assert.deepEqual(team.body.pendingInvitations, []);
  assert.ok(!JSON.stringify(team.body).includes("hash"));
  // Even after removing the claimed email, reusing the original code cannot create another account.
  f.db
    .prepare("UPDATE accounts SET email = ? WHERE id = ?")
    .run("changed@example.com", sales.body.user.id);
  await assert.rejects(
    () =>
      f.call("/api/auth/signup", "POST", {
        name: "Reuse",
        email: "sales@example.com",
        password,
        inviteCode: invite.body.inviteCode,
      }),
    statusIs(403),
  );
  const expired = await f.call(
    "/api/team/invites",
    "POST",
    { email: "expired@example.com" },
    owner.cookie,
  );
  f.advance(73 * 60 * 60 * 1000);
  await assert.rejects(
    () =>
      f.call("/api/auth/signup", "POST", {
        name: "Late",
        email: "expired@example.com",
        password,
        inviteCode: expired.body.inviteCode,
      }),
    statusIs(403),
  );
  const revoked = await f.call(
    "/api/team/invites",
    "POST",
    { email: "revoked@example.com" },
    owner.cookie,
  );
  await f.call(
    `/api/team/invites/${revoked.body.inviteId}`,
    "DELETE",
    undefined,
    owner.cookie,
  );
  await assert.rejects(
    () =>
      f.call("/api/auth/signup", "POST", {
        name: "Revoked",
        email: "revoked@example.com",
        password,
        inviteCode: revoked.body.inviteCode,
      }),
    statusIs(403),
  );
});

test("sign-in works on another device, logout revokes only that session, and expiry removes access", async (t) => {
  const f = fixture(t, { secureCookies: false }),
    owner = await f.owner();
  await assert.rejects(
    () =>
      f.call("/api/auth/login", "POST", {
        email: "owner@example.com",
        password: "incorrect password",
      }),
    statusIs(401),
  );
  const otherDevice = await f.call("/api/auth/login", "POST", {
    email: "OWNER@EXAMPLE.COM",
    password,
  });
  assert.notEqual(otherDevice.cookie, owner.cookie);
  assert.doesNotMatch(otherDevice.headers["set-cookie"], /Secure/);
  assert.equal(otherDevice.body.user.id, owner.body.user.id);
  await f.call("/api/auth/logout", "POST", {}, owner.cookie);
  assert.equal(
    (await f.call("/api/auth/me", "GET", undefined, owner.cookie)).body.user,
    null,
  );
  assert.equal(
    (await f.call("/api/auth/me", "GET", undefined, otherDevice.cookie)).body
      .user.id,
    owner.body.user.id,
  );
  f.advance(8 * 24 * 60 * 60 * 1000);
  assert.equal(
    (await f.call("/api/auth/me", "GET", undefined, otherDevice.cookie)).body
      .user,
    null,
  );
});

test("account mutations reject cross-origin requests and failed logins are throttled", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () =>
      f.call(
        "/api/auth/signup",
        "POST",
        { name: "Owner", email: "owner@example.com", password, setupToken },
        undefined,
        { origin: "https://another.example" },
      ),
    statusIs(403),
  );
  for (let i = 0; i < 8; i++)
    await assert.rejects(
      () =>
        f.call("/api/auth/login", "POST", {
          email: "absent@example.com",
          password,
        }),
      statusIs(401),
    );
  await assert.rejects(
    () =>
      f.call("/api/auth/login", "POST", {
        email: "absent@example.com",
        password,
      }),
    statusIs(429),
  );
  f.advance(10 * 60 * 1000 + 1);
  await assert.rejects(
    () =>
      f.call("/api/auth/login", "POST", {
        email: "absent@example.com",
        password,
      }),
    statusIs(401),
  );
  assert.equal((await f.call("/api/other")).handled, false);
});
