import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "myflatpay_session";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_MS = 72 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 8;
const PASSWORD_PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const isRecord = (input) =>
  input !== null && typeof input === "object" && !Array.isArray(input);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sameSecret = (a, b) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
const iso = (value) => new Date(value).toISOString();
const publicUser = (row) =>
  row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null;

function emailAddress(value) {
  if (
    typeof value !== "string" ||
    value.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  ) {
    throw failure("Enter a valid email address.");
  }
  return value.trim().toLowerCase();
}
function accountDetails(input) {
  if (!isRecord(input)) throw failure("Send account details.");
  const email = emailAddress(input.email);
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 120
  )
    throw failure("Enter a name of 1 to 120 characters.");
  if (
    typeof input.password !== "string" ||
    input.password.length < 12 ||
    input.password.length > 200
  )
    throw failure("Use a password of 12 to 200 characters.");
  return { email, name: input.name.trim(), password: input.password };
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64, PASSWORD_PARAMETERS);
  return `scrypt-v1$${salt}$${Buffer.from(derived).toString("hex")}`;
}
async function passwordMatches(password, encoded) {
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  const valid =
    parts.length === 3 &&
    parts[0] === "scrypt-v1" &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  // Unknown accounts do the same password work, using a dummy hash that can never authenticate.
  const salt = valid ? parts[1] : "49d2de2be8184397a3c586e210869be2";
  const target = valid ? Buffer.from(parts[2], "hex") : Buffer.alloc(64);
  const derived = Buffer.from(
    await scrypt(password, salt, 64, PASSWORD_PARAMETERS),
  );
  return valid && timingSafeEqual(target, derived);
}
function sessionToken(req) {
  const cookies =
    typeof req.headers?.cookie === "string"
      ? req.headers.cookie.split(";")
      : [];
  const entry = cookies.find((cookie) =>
    cookie.trim().startsWith(`${COOKIE_NAME}=`),
  );
  const token = entry?.trim().slice(COOKIE_NAME.length + 1);
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? token
    : null;
}
function verifyMutation(req) {
  if (req.headers?.["sec-fetch-site"] === "cross-site")
    throw failure("Cross-site account changes are not allowed.", 403);
  const origin = req.headers?.origin;
  if (origin) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw failure("Invalid request origin.", 403);
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.host !== req.headers.host
    )
      throw failure("Cross-origin account changes are not allowed.", 403);
  }
}

/** Shared account/session tables for the server-backed myflatpay edition. */
export function createCloudIdentity(
  db,
  {
    setupToken = process.env.SETUP_TOKEN,
    secureCookies = true,
    now = () => Date.now(),
  } = {},
) {
  const milliseconds = () => {
    const value = now();
    const result = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(result)) throw Error("Invalid identity clock.");
    return result;
  };
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'sales')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_account_id ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'sales')),
      created_by TEXT NOT NULL REFERENCES accounts(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      revoked_at INTEGER
    );
  `);
  const setupAvailable =
    typeof setupToken === "string" && setupToken.length >= 32;
  const hasAccounts = () =>
    db.prepare("SELECT 1 FROM accounts LIMIT 1").get() !== undefined;
  const failures = new Map();
  function loginBucket(req, email) {
    const address = req.socket?.remoteAddress || "local";
    // Never trust a caller-supplied X-Forwarded-For header as an authentication throttle key.
    return `${address}|${email}`;
  }
  function checkLimit(key) {
    const current = failures.get(key);
    if (!current) return;
    if (current.until <= milliseconds()) {
      failures.delete(key);
      return;
    }
    if (current.count >= LOGIN_LIMIT)
      throw failure(
        "Too many sign-in attempts. Try again in ten minutes.",
        429,
      );
  }
  function failedLogin(key) {
    const current = failures.get(key);
    if (failures.size >= 1000 && !failures.has(key))
      failures.delete(failures.keys().next().value);
    const stamp = milliseconds();
    failures.set(
      key,
      current && current.until > stamp
        ? { ...current, count: current.count + 1 }
        : { count: 1, until: stamp + LOGIN_WINDOW_MS },
    );
  }
  function cookie(res, token, maxAge) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`,
    );
  }
  function makeSession(userId, stamp) {
    const token = randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(stamp);
    db.prepare(
      "INSERT INTO sessions(token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(digest(token), userId, stamp, stamp + SESSION_MS);
    return token;
  }
  function getUser(req) {
    const token = sessionToken(req);
    if (!token) return null;
    const row = db
      .prepare(
        "SELECT a.id, a.email, a.name, a.role FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?",
      )
      .get(digest(token), milliseconds());
    return publicUser(row);
  }
  function requireUser(user) {
    if (!user) throw failure("Sign in to your myflatpay account.", 401);
    return user;
  }
  function requireOwner(user) {
    requireUser(user);
    if (user.role !== "owner")
      throw failure("Only the team owner can manage accounts.", 403);
    return user;
  }
  function invitationFor(code, email, stamp) {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code))
      throw failure("Enter a valid invitation code.", 403);
    const row = db
      .prepare("SELECT * FROM invitations WHERE token_hash = ?")
      .get(digest(code));
    if (
      !row ||
      row.used_at !== null ||
      row.revoked_at !== null ||
      row.expires_at <= stamp ||
      row.email.toLowerCase() !== email
    )
      throw failure(
        "This invitation is invalid, expired or belongs to a different email address.",
        403,
      );
    return row;
  }
  async function handle(req, res, pathname, { readJson, respond }) {
    const method = req.method.toUpperCase();
    const inviteMatch = pathname.match(
      /^\/api\/team\/invites\/([A-Za-z0-9-]+)$/,
    );
    const known =
      [
        "/api/auth/me",
        "/api/auth/signup",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/team",
        "/api/team/invites",
      ].includes(pathname) || !!inviteMatch;
    if (!known) return false;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method))
      verifyMutation(req);
    if (pathname === "/api/auth/me" && method === "GET") {
      const needsSetup = !hasAccounts();
      respond(res, 200, {
        user: getUser(req),
        needsSetup,
        setupAvailable: needsSetup && setupAvailable,
      });
      return true;
    }
    if (pathname === "/api/auth/signup" && method === "POST") {
      const input = await readJson(req),
        details = accountDetails(input);
      if (
        db.prepare("SELECT id FROM accounts WHERE email = ?").get(details.email)
      )
        throw failure(
          "An account already uses this email address. Sign in instead.",
          409,
        );
      const initialSetup = !hasAccounts();
      if (initialSetup) {
        if (!setupAvailable)
          throw failure("Owner setup is not configured on this server.", 503);
        if (
          typeof input.setupToken !== "string" ||
          input.setupToken.length > 500 ||
          !sameSecret(input.setupToken, setupToken)
        )
          throw failure(
            "Enter the owner setup code configured for this server.",
            403,
          );
      } else invitationFor(input.inviteCode, details.email, milliseconds());
      const passwordHash = await hashPassword(details.password),
        stamp = milliseconds(),
        id = randomUUID();
      let role, token;
      db.exec("BEGIN IMMEDIATE");
      try {
        // Password hashing yields. Recheck setup/invitation ownership while holding the write transaction.
        if (initialSetup) {
          if (hasAccounts())
            throw failure(
              "The owner account is already set up. Use an invitation to join.",
              409,
            );
          role = "owner";
        } else
          role = invitationFor(input.inviteCode, details.email, stamp).role;
        if (
          db
            .prepare("SELECT id FROM accounts WHERE email = ?")
            .get(details.email)
        )
          throw failure(
            "An account already uses this email address. Sign in instead.",
            409,
          );
        db.prepare(
          "INSERT INTO accounts(id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, details.email, details.name, passwordHash, role, stamp);
        if (!initialSetup)
          db.prepare(
            "UPDATE invitations SET used_at = ? WHERE token_hash = ?",
          ).run(stamp, digest(input.inviteCode));
        token = makeSession(id, stamp);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      cookie(res, token, SESSION_MS / 1000);
      respond(res, 201, {
        user: { id, email: details.email, name: details.name, role },
      });
      return true;
    }
    if (pathname === "/api/auth/login" && method === "POST") {
      const input = await readJson(req);
      if (!isRecord(input)) throw failure("Enter your email and password.");
      const email = emailAddress(input.email),
        key = loginBucket(req, email);
      checkLimit(key);
      if (typeof input.password !== "string" || input.password.length > 200) {
        failedLogin(key);
        throw failure("Email or password is incorrect.", 401);
      }
      const row = db
        .prepare("SELECT * FROM accounts WHERE email = ?")
        .get(email);
      if (!(await passwordMatches(input.password, row?.password_hash))) {
        failedLogin(key);
        throw failure("Email or password is incorrect.", 401);
      }
      failures.delete(key);
      const token = makeSession(row.id, milliseconds());
      cookie(res, token, SESSION_MS / 1000);
      respond(res, 200, { user: publicUser(row) });
      return true;
    }
    if (pathname === "/api/auth/logout" && method === "POST") {
      const token = sessionToken(req);
      if (token)
        db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(
          digest(token),
        );
      cookie(res, "", 0);
      respond(res, 200, { ok: true });
      return true;
    }
    if (pathname === "/api/team" && method === "GET") {
      requireOwner(getUser(req));
      const users = db
        .prepare(
          "SELECT id, email, name, role FROM accounts ORDER BY created_at, id",
        )
        .all()
        .map(publicUser);
      const pendingInvitations = db
        .prepare(
          "SELECT id, email, role, expires_at FROM invitations WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
        )
        .all(milliseconds())
        .map((row) => ({
          id: row.id,
          email: row.email,
          role: row.role,
          expiresAt: iso(row.expires_at),
        }));
      respond(res, 200, { users, pendingInvitations });
      return true;
    }
    if (pathname === "/api/team/invites" && method === "POST") {
      const owner = requireOwner(getUser(req)),
        input = await readJson(req);
      if (!isRecord(input)) throw failure("Send invitation details.");
      const email = emailAddress(input.email),
        role = input.role ?? "sales";
      if (!["owner", "sales"].includes(role))
        throw failure("Choose an owner or salesperson role.");
      if (db.prepare("SELECT id FROM accounts WHERE email = ?").get(email))
        throw failure("This person already has a myflatpay account.", 409);
      const stamp = milliseconds(),
        inviteCode = randomBytes(32).toString("base64url"),
        id = randomUUID();
      db.prepare(
        "INSERT INTO invitations(id, token_hash, email, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        digest(inviteCode),
        email,
        role,
        owner.id,
        stamp,
        stamp + INVITE_MS,
      );
      respond(res, 201, {
        inviteId: id,
        inviteCode,
        email,
        role,
        expiresAt: iso(stamp + INVITE_MS),
      });
      return true;
    }
    if (inviteMatch && method === "DELETE") {
      requireOwner(getUser(req));
      const result = db
        .prepare(
          "UPDATE invitations SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
        )
        .run(milliseconds(), inviteMatch[1]);
      if (!result.changes)
        throw failure("Pending invitation was not found.", 404);
      respond(res, 200, { ok: true });
      return true;
    }
    respond(res, 405, { error: "Method not allowed." });
    return true;
  }
  return { getUser, requireUser, requireOwner, handle };
}
