import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { validateDeal } from "./shared/domain.mjs";
import { createAssistantService } from "./shared/assistant.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

function respond(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT)
      throw requestError("Record exceeds the 1 MB limit.", 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Expected object");
    return body;
  } catch {
    throw requestError("Send a valid JSON merchant record.");
  }
}

function verifyMutation(req) {
  if (req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      throw requestError("Invalid request origin.", 403);
    }
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.host !== req.headers.host
    )
      throw requestError("Cross-origin changes are not allowed.", 403);
  }
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw requestError("Cross-site changes are not allowed.", 403);
  if (
    ["POST", "PUT"].includes(req.method) &&
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  ) {
    throw requestError("Use application/json for merchant changes.", 415);
  }
}

/** A local single-user app. Host remains loopback unless explicitly configured. */
export async function createAppServer({
  dataDir = process.env.DATA_DIR || path.join(ROOT, ".data"),
  production = process.env.NODE_ENV === "production",
  frontend = true,
  assistantOptions = {},
  allowedHosts = [
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ],
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "flatpay.sqlite"));
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS deals (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  const allDeals = db.prepare(
    "SELECT payload FROM deals ORDER BY updated_at DESC",
  );
  const findDeal = db.prepare("SELECT payload FROM deals WHERE id = ?");
  const insertDeal = db.prepare(
    "INSERT INTO deals (id, payload, updated_at) VALUES (?, ?, ?)",
  );
  const updateDeal = db.prepare(
    "UPDATE deals SET payload = ?, updated_at = ? WHERE id = ?",
  );
  const deleteDeal = db.prepare("DELETE FROM deals WHERE id = ?");
  const list = () => allDeals.all().map((row) => JSON.parse(row.payload));
  const assistant = createAssistantService(db, {
    ...assistantOptions,
    listDeals: list,
  });
  let vite;

  async function staticFile(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return respond(res, 400, { error: "Invalid path." });
    }
    const dist = path.join(ROOT, "dist");
    let target = path.resolve(dist, `.${decoded}`);
    if (!target.startsWith(`${dist}${path.sep}`) && target !== dist)
      return respond(res, 403, { error: "Invalid path." });
    try {
      if (!(await stat(target)).isFile()) throw new Error("Not a file");
    } catch {
      // SPA navigation gets index; missing assets must not return HTML.
      if (path.extname(decoded))
        return respond(res, 404, { error: "File not found." });
      target = path.join(dist, "index.html");
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(target)] || "application/octet-stream",
        "Cache-Control": target.endsWith("index.html")
          ? "no-cache"
          : "public, max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      respond(res, 503, {
        error: "Build the app with npm run build before starting production.",
      });
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    // A malicious website must not use DNS rebinding to reach local merchant data.
    let hostname;
    try {
      hostname = new URL(`http://${req.headers.host}`).hostname;
    } catch {
      return respond(res, 400, { error: "Invalid request host." });
    }
    if (!allowedHosts.includes(hostname))
      return respond(res, 403, {
        error:
          "This host is not allowed. Configure ALLOWED_HOSTS only for a trusted deployment.",
      });
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return respond(res, 400, { error: "Invalid URL." });
    }
    try {
      if (pathname.startsWith("/api/")) {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method))
          verifyMutation(req);
        if (req.method === "GET" && pathname === "/api/health")
          return respond(res, 200, { ok: true });
        if (req.method === "GET" && pathname === "/api/assistant")
          return respond(
            res,
            200,
            assistant.status({
              demo:
                new URL(req.url, "http://localhost").searchParams.get(
                  "demo",
                ) === "true",
            }),
          );
        if (req.method === "POST" && pathname === "/api/assistant/chat")
          return respond(res, 200, await assistant.chat(await readJson(req)));
        if (req.method === "PUT" && pathname === "/api/assistant/targets")
          return respond(res, 200, assistant.setTargets(await readJson(req)));
        if (req.method === "POST" && pathname === "/api/assistant/preferences")
          return respond(
            res,
            201,
            assistant.addPreference(await readJson(req)),
          );
        const preferenceMatch = pathname.match(
          /^\/api\/assistant\/preferences\/([A-Za-z0-9-]+)$/,
        );
        if (req.method === "DELETE" && preferenceMatch)
          return respond(
            res,
            200,
            assistant.deletePreference(preferenceMatch[1]),
          );
        if (req.method === "DELETE" && pathname === "/api/assistant/history")
          return respond(res, 200, assistant.clearHistory());
        if (req.method === "GET" && pathname === "/api/deals")
          return respond(res, 200, list());
        if (req.method === "GET" && pathname === "/api/export") {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="flatpay-backup.json"',
          );
          return respond(res, 200, {
            version: 1,
            exportedAt: new Date().toISOString(),
            deals: list(),
          });
        }
        const match = pathname.match(/^\/api\/deals\/([A-Za-z0-9-]+)$/);
        if (
          (req.method === "POST" && pathname === "/api/deals") ||
          (req.method === "PUT" && match)
        ) {
          const existing = match ? findDeal.get(match[1]) : null;
          if (match && !existing)
            return respond(res, 404, { error: "Merchant was not found." });
          const payload = await readJson(req);
          const statuses = [
            "Lead",
            "Meeting booked",
            "Proposal sent",
            "Negotiation",
            "Won",
            "Lost",
          ];
          const input = {
            status: "Lead",
            offers: [],
            checklist: {},
            saleInfo: {},
            commissionDetails: {},
            ...payload,
          };
          if (typeof input.status === "string")
            input.status =
              statuses.find(
                (status) => status.toLowerCase() === input.status.toLowerCase(),
              ) || input.status;
          const errors = validateDeal(input);
          if (errors.length)
            return respond(res, 400, { error: errors[0], errors });
          const previous = existing ? JSON.parse(existing.payload) : null;
          const now = new Date().toISOString();
          // Immutable IDs and creation dates come only from the server.
          const deal = {
            ...input,
            id: previous?.id || randomUUID(),
            createdAt: previous?.createdAt || now,
            updatedAt: now,
          };
          if (previous) updateDeal.run(JSON.stringify(deal), now, deal.id);
          else insertDeal.run(deal.id, JSON.stringify(deal), now);
          return respond(res, previous ? 200 : 201, deal);
        }
        if (req.method === "DELETE" && match) {
          const result = deleteDeal.run(match[1]);
          if (!result.changes)
            return respond(res, 404, { error: "Merchant was not found." });
          return respond(res, 200, { ok: true });
        }
        return respond(res, 404, { error: "API route was not found." });
      }
      if (!["GET", "HEAD"].includes(req.method))
        return respond(res, 405, { error: "Method not allowed." });
      if (vite)
        return vite.middlewares(req, res, () =>
          respond(res, 404, { error: "Page not found." }),
        );
      if (frontend) return await staticFile(req, res, pathname);
      return respond(res, 404, { error: "Page not found." });
    } catch (error) {
      if (!error.status) console.error("Request failed:", error.message);
      if (!res.headersSent)
        respond(res, error.status || 500, {
          error: error.status
            ? error.message
            : "An unexpected server error occurred.",
        });
      else res.end();
    }
  });
  if (frontend && !production) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: ROOT,
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
  }
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await vite?.close();
    if (server.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    db.close();
  };
  return { server, close, dataDir };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createAppServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  app.server.listen(port, host, () =>
    console.log(`myflatpay listening on ${host}:${port}`),
  );
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
