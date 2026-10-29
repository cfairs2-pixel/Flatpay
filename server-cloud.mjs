import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { validateDeal, monthlySummary } from "./shared/domain.mjs";
import { createCloudIdentity } from "./shared/cloud-identity.mjs";
import { createCloudContent } from "./shared/cloud-content.mjs";
import { createAssistantService } from "./shared/assistant.mjs";
import {
  previewConduktImport,
  buildConduktPatch,
  sanitiseConduktSnapshot,
} from "./shared/condukt.mjs";
import { londonToday } from "./shared/assistant-logic.mjs";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const problem = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function respond(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw problem("Request exceeds the allowed size.", 413);
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw problem("Send valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw problem("Send a JSON object.");
  return body;
}
function verifyMutation(req) {
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw problem("Cross-site changes are not allowed.", 403);
  if (req.headers.origin) {
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      throw problem("Invalid origin.", 403);
    }
    if (
      origin.host !== req.headers.host ||
      !["http:", "https:"].includes(origin.protocol)
    )
      throw problem("Cross-origin changes are not allowed.", 403);
  }
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  )
    throw problem("Use application/json.", 415);
}
async function extractHeadOfficeText(input) {
  if (input.content?.trim() || !input.fileBase64) return input;
  const buffer = Buffer.from(input.fileBase64, "base64");
  if (buffer.length > 5 * 1024 * 1024)
    throw problem("Documents can be at most 5 MB.", 413);
  try {
    if (
      input.mimeType === "application/pdf" ||
      /\.pdf$/i.test(input.fileName || "")
    ) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return { ...input, content: result.text.slice(0, 200000) };
      } finally {
        await parser.destroy();
      }
    }
    if (/\.docx$/i.test(input.fileName || "")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { ...input, content: result.value.slice(0, 200000) };
    }
  } catch {
    return {
      ...input,
      content: "",
      extractionWarning:
        "Automatic text extraction failed. Add reviewed text before approval.",
    };
  }
  return input;
}
export async function createCloudServer({
  dataDir = process.env.DATA_DIR || path.join(ROOT, ".data-cloud"),
  frontend = true,
  setupToken = process.env.SETUP_TOKEN,
  secureCookies = process.env.COOKIE_SECURE !== "false",
  assistantOptions = {},
  allowedHosts = [
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ...(process.env.PUBLIC_ORIGIN
      ? [new URL(process.env.PUBLIC_ORIGIN).hostname]
      : []),
  ],
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(path.join(dataDir, "assistant"), {
    recursive: true,
    mode: 0o700,
  });
  const db = new DatabaseSync(path.join(dataDir, "myflatpay.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS cloud_deals(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,payload TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS cloud_deals_owner ON cloud_deals(owner_id,updated_at); CREATE TABLE IF NOT EXISTS cloud_audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,record_id TEXT,created_at TEXT NOT NULL)",
  );
  const identity = createCloudIdentity(db, { setupToken, secureCookies }),
    content = createCloudContent(db),
    assistants = new Map();
  const list = (userId) =>
    db
      .prepare(
        "SELECT payload FROM cloud_deals WHERE owner_id=? ORDER BY updated_at DESC",
      )
      .all(userId)
      .map((r) => JSON.parse(r.payload));
  const find = (userId, id) => {
    const r = db
      .prepare("SELECT payload FROM cloud_deals WHERE id=? AND owner_id=?")
      .get(id, userId);
    return r ? JSON.parse(r.payload) : null;
  };
  const audit = (user, action, id) =>
    db
      .prepare("INSERT INTO cloud_audit VALUES(?,?,?,?,?)")
      .run(randomUUID(), user.id, action, id || null, new Date().toISOString());
  function assistant(user) {
    let item = assistants.get(user.id);
    if (!item) {
      const adb = new DatabaseSync(
        path.join(dataDir, "assistant", `${user.id}.sqlite`),
      );
      adb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
      item = {
        db: adb,
        service: createAssistantService(adb, {
          ...assistantOptions,
          listDeals: () => list(user.id),
          getKnowledge: () => content.knowledge(user),
        }),
      };
      assistants.set(user.id, item);
    }
    return item.service;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    try {
      const url = new URL(req.url, "http://localhost"),
        route = url.pathname;
      if (route === "/api/health" && req.method === "GET")
        return respond(res, 200, {
          ok: true,
          storage: "server",
          accounts: true,
        });
      let hostname;
      try {
        hostname = new URL(`http://${req.headers.host}`).hostname;
      } catch {
        throw problem("Invalid host.", 400);
      }
      if (!allowedHosts.includes(hostname))
        throw problem("This host is not configured for this deployment.", 403);
      if (route.startsWith("/api/")) {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method))
          verifyMutation(req);
        if (await identity.handle(req, res, route, { readJson, respond }))
          return;
        const user = identity.getUser(req);
        if (!user) throw problem("Sign in to your myflatpay account.", 401);
        if (route === "/api/deals" && req.method === "GET")
          return respond(res, 200, list(user.id));
        if (route === "/api/export" && req.method === "GET")
          return respond(res, 200, {
            version: 1,
            exportedAt: new Date().toISOString(),
            deals: list(user.id),
          });
        if (route === "/api/deals/import" && req.method === "POST") {
          const input = await readJson(req, 8 * 1024 * 1024);
          if (!Array.isArray(input.deals) || input.deals.length > 500)
            throw problem("Import up to 500 merchants at a time.");
          const errors = input.deals.flatMap((d, i) =>
            validateDeal(d).map((e) => `Merchant ${i + 1}: ${e}`),
          );
          if (errors.length)
            return respond(res, 400, { errors, error: errors[0] });
          const existing = list(user.id),
            known = new Set(
              existing.map((d) => d.importSourceId).filter(Boolean),
            ),
            created = [];
          let skipped = 0;
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const d of input.deals) {
              if (d.id && known.has(d.id)) {
                skipped++;
                continue;
              }
              const now = new Date().toISOString(),
                deal = {
                  ...d,
                  id: randomUUID(),
                  importSourceId: d.id || null,
                  createdAt: now,
                  updatedAt: now,
                };
              db.prepare("INSERT INTO cloud_deals VALUES(?,?,?,?)").run(
                deal.id,
                user.id,
                JSON.stringify(deal),
                now,
              );
              created.push(deal);
              if (d.id) known.add(d.id);
            }
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            throw e;
          }
          audit(user, "deals.import", null);
          return respond(res, 201, {
            imported: created.length,
            skipped,
            deals: list(user.id),
          });
        }
        const dealMatch = route.match(/^\/api\/deals\/([A-Za-z0-9-]+)$/);
        if (
          (route === "/api/deals" && req.method === "POST") ||
          (dealMatch && req.method === "PUT")
        ) {
          const previous = dealMatch ? find(user.id, dealMatch[1]) : null;
          if (dealMatch && !previous) throw problem("Merchant not found.", 404);
          const input = {
            status: "Lead",
            offers: [],
            checklist: {},
            saleInfo: {},
            commissionDetails: {},
            ...(await readJson(req)),
          };
          if (input.condukt !== undefined)
            input.condukt = sanitiseConduktSnapshot(input.condukt);
          const errors = validateDeal(input);
          if (errors.length)
            return respond(res, 400, { errors, error: errors[0] });
          const now = new Date().toISOString(),
            deal = {
              ...input,
              id: previous?.id || randomUUID(),
              createdAt: previous?.createdAt || now,
              updatedAt: now,
            };
          db.prepare(
            "INSERT INTO cloud_deals(id,owner_id,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
          ).run(deal.id, user.id, JSON.stringify(deal), now);
          audit(user, previous ? "deal.update" : "deal.create", deal.id);
          return respond(res, previous ? 200 : 201, deal);
        }
        if (dealMatch && req.method === "DELETE") {
          const result = db
            .prepare("DELETE FROM cloud_deals WHERE id=? AND owner_id=?")
            .run(dealMatch[1], user.id);
          if (!result.changes) throw problem("Merchant not found.", 404);
          audit(user, "deal.delete", dealMatch[1]);
          return respond(res, 200, { ok: true });
        }
        if (route === "/api/team/summary" && req.method === "GET") {
          identity.requireOwner(user);
          const month =
            url.searchParams.get("month") || londonToday().slice(0, 7);
          const users = db
            .prepare("SELECT id,name,email,role FROM accounts")
            .all();
          return respond(res, 200, {
            month,
            members: users.map((u) => {
              const deals = list(u.id);
              return {
                ...u,
                ...monthlySummary(deals, month),
                activeCount: deals.filter(
                  (d) => !["Won", "Lost"].includes(d.status),
                ).length,
              };
            }),
          });
        }
        if (route === "/api/condukt/preview" && req.method === "POST") {
          const body = await readJson(req);
          return respond(
            res,
            200,
            previewConduktImport(body.input, list(user.id), user.id),
          );
        }
        if (route === "/api/condukt/apply" && req.method === "POST") {
          const body = await readJson(req),
            preview = previewConduktImport(body.input, list(user.id), user.id),
            candidate = preview.candidates[Number(body.candidateIndex ?? 0)];
          if (!candidate) throw problem("Choose an imported customer.");
          const targetId = body.dealId || candidate.match.dealId,
            previous = targetId ? find(user.id, targetId) : null;
          if (targetId && !previous) throw problem("Customer not found.", 404);
          if (!targetId && candidate.match.status === "ambiguous")
            throw problem("Choose which customer to update.");
          const patch = buildConduktPatch(candidate, {
              fieldPaths: body.fieldPaths,
              includeDocumentTasks: body.includeDocumentTasks !== false,
            }),
            now = new Date().toISOString(),
            deal = {
              status: "Lead",
              offers: [],
              checklist: {},
              saleInfo: {},
              commissionDetails: {},
              ...previous,
              ...patch,
              saleInfo: { ...previous?.saleInfo, ...patch.saleInfo },
              condukt: { ...previous?.condukt, ...patch.condukt },
              id: previous?.id || randomUUID(),
              createdAt: previous?.createdAt || now,
              updatedAt: now,
            };
          const errors = validateDeal(deal);
          if (errors.length)
            return respond(res, 400, { error: errors[0], errors });
          db.prepare(
            "INSERT INTO cloud_deals VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
          ).run(deal.id, user.id, JSON.stringify(deal), now);
          audit(user, "condukt.manual-import", deal.id);
          return respond(res, 200, { deal, deals: list(user.id) });
        }
        if (route === "/api/documents" && req.method === "GET")
          return respond(res, 200, { documents: content.listDocuments(user) });
        if (route === "/api/documents" && req.method === "POST") {
          identity.requireOwner(user);
          const input = await extractHeadOfficeText(
            await readJson(req, 8 * 1024 * 1024),
          );
          const d = content.addDocument(user, input);
          audit(user, "document.upload", d.id);
          return respond(res, 201, d);
        }
        const doc = route.match(
          /^\/api\/documents\/([A-Za-z0-9-]+)(?:\/(review|file))?$/,
        );
        if (doc && doc[2] === "file" && req.method === "GET") {
          const d = content.getDocument(user, doc[1], { includeFile: true });
          if (!d.fileBase64)
            throw problem("No original file is available.", 404);
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${d.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
            "Cache-Control": "no-store",
          });
          return res.end(Buffer.from(d.fileBase64, "base64"));
        }
        if (doc && !doc[2] && req.method === "GET")
          return respond(res, 200, content.getDocument(user, doc[1]));
        if (doc && !doc[2] && req.method === "PUT")
          return respond(
            res,
            200,
            content.updateDocument(user, doc[1], await readJson(req)),
          );
        if (doc && doc[2] === "review" && req.method === "POST") {
          const d = content.reviewDocument(user, doc[1], await readJson(req));
          audit(user, "document.review", d.id);
          return respond(res, 200, d);
        }
        if (doc && !doc[2] && req.method === "DELETE")
          return respond(res, 200, content.deleteDocument(user, doc[1]));
        if (route === "/api/features" && req.method === "GET")
          return respond(res, 200, { features: content.listFeatures(user) });
        if (route === "/api/features" && req.method === "POST") {
          const f = content.saveFeature(user, await readJson(req));
          audit(user, "feature.save", f.id);
          return respond(res, 201, f);
        }
        const feature = route.match(
          /^\/api\/features\/([A-Za-z0-9-]+)(?:\/(publish|state))?$/,
        );
        if (feature && feature[2] === "state" && req.method === "GET")
          return respond(res, 200, content.getFeatureState(user, feature[1]));
        if (feature && feature[2] === "state" && req.method === "PUT")
          return respond(
            res,
            200,
            content.saveFeatureState(user, feature[1], await readJson(req)),
          );
        if (feature && feature[2] === "publish" && req.method === "POST") {
          const f = content.publishFeature(
            user,
            feature[1],
            await readJson(req),
          );
          audit(user, "feature.publish", f.id);
          return respond(res, 200, f);
        }
        if (feature && !feature[2] && req.method === "DELETE")
          return respond(res, 200, content.deleteFeature(user, feature[1]));
        if (route === "/api/assistant" && req.method === "GET")
          return respond(
            res,
            200,
            assistant(user).status({
              demo: url.searchParams.get("demo") === "true",
            }),
          );
        if (route === "/api/assistant/chat" && req.method === "POST")
          return respond(
            res,
            200,
            await assistant(user).chat(await readJson(req)),
          );
        if (route === "/api/assistant/targets" && req.method === "PUT")
          return respond(
            res,
            200,
            assistant(user).setTargets(await readJson(req)),
          );
        if (route === "/api/assistant/preferences" && req.method === "POST")
          return respond(
            res,
            201,
            assistant(user).addPreference(await readJson(req)),
          );
        if (route === "/api/assistant/history" && req.method === "DELETE")
          return respond(res, 200, assistant(user).clearHistory());
        const preference = route.match(
          /^\/api\/assistant\/preferences\/([A-Za-z0-9-]+)$/,
        );
        if (preference && req.method === "DELETE")
          return respond(
            res,
            200,
            assistant(user).deletePreference(preference[1]),
          );
        throw problem("API route not found.", 404);
      }
      if (!frontend) throw problem("Page not found.", 404);
      if (!["GET", "HEAD"].includes(req.method))
        throw problem("Method not allowed.", 405);
      const dist = path.join(ROOT, "dist-cloud");
      let target = path.resolve(dist, `.${decodeURIComponent(route)}`);
      if (!target.startsWith(dist + path.sep) && target !== dist)
        throw problem("Invalid path.", 403);
      try {
        if (!(await stat(target)).isFile()) throw Error();
      } catch {
        if (path.extname(route)) throw problem("File not found.", 404);
        target = path.join(dist, "index.html");
      }
      const data = await readFile(target);
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(target)] || "application/octet-stream",
        "Cache-Control": target.endsWith("index.html")
          ? "no-cache"
          : "public,max-age=3600",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (!res.headersSent)
        respond(res, error.status || 500, {
          error: error.status
            ? error.message
            : "The server could not complete this request.",
        });
      else res.end();
    }
  });
  return {
    server,
    db,
    close: async () => {
      if (server.listening)
        await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
      for (const item of assistants.values()) item.db.close();
      db.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await createCloudServer();
  app.server.listen(
    Number(process.env.PORT || 3000),
    process.env.HOST || "127.0.0.1",
    () => console.log("myflatpay account server is listening."),
  );
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
