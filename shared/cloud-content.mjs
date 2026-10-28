import { randomUUID } from "node:crypto";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const MAX_FEATURE_CHARS = 50_000;
const MIME_TYPES = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function requireUser(user) {
  if (
    !object(user) ||
    typeof user.id !== "string" ||
    !user.id ||
    !["owner", "sales"].includes(user.role)
  )
    fail("Sign in to use this workspace.", 401);
  return user;
}
function requireOwner(user) {
  requireUser(user);
  if (user.role !== "owner")
    fail(
      "Only the workspace owner can change shared documents and features.",
      403,
    );
}
function text(value, label, max, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string" || value.length > max)
    fail(
      `${label} must be text of at most ${max.toLocaleString("en-GB")} characters.`,
    );
  if (required && !value.trim()) fail(`${label} is required.`);
  return value;
}
function effectiveDate(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Choose a valid document effective date.");
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    fail("Choose a valid document effective date.");
  return value;
}
function decodeFile(input, fileName, mimeType) {
  if (input === undefined || input === null || input === "") return null;
  if (
    typeof input !== "string" ||
    input.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 ||
    input.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input,
    )
  )
    fail("Upload a valid file of at most 5 MB.");
  const bytes = Buffer.from(input, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_FILE_BYTES ||
    bytes.toString("base64") !== input
  )
    fail("Upload a valid file of at most 5 MB.");
  if (
    mimeType === MIME_TYPES.pdf &&
    !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
  )
    fail("The uploaded file is not a valid PDF document.");
  if (
    mimeType === MIME_TYPES.docx &&
    !bytes.subarray(0, 2).equals(Buffer.from("PK"))
  )
    fail("The uploaded file is not a valid DOCX document.");
  return bytes;
}
function documentInput(input) {
  if (!object(input)) fail("Send a document record.");
  const title = text(input.title, "Document title", 300, {
    required: true,
  }).trim();
  const fileName = text(input.fileName, "File name", 255, {
    required: true,
  }).trim();
  if (/[\/\\\u0000-\u001F\u007F]/.test(fileName))
    fail("Use a file name without directory paths.");
  const extension = fileName.split(".").at(-1).toLowerCase();
  if (!Object.hasOwn(MIME_TYPES, extension))
    fail("Upload a TXT, Markdown, CSV, JSON, PDF or DOCX document.");
  let mimeType = text(input.mimeType, "Document type", 150)
    .toLowerCase()
    .split(";")[0]
    .trim();
  const expected = MIME_TYPES[extension];
  if (
    !mimeType ||
    mimeType === "application/octet-stream" ||
    (extension === "md" && mimeType === "text/plain")
  )
    mimeType = expected;
  if (mimeType !== expected)
    fail("The document type must match its file extension.");
  const bytes = decodeFile(input.fileBase64, fileName, mimeType);
  let content = text(
    input.content,
    "Readable document content",
    MAX_TEXT_CHARS,
  );
  if (
    !content.trim() &&
    bytes &&
    ["txt", "md", "csv", "json"].includes(extension)
  ) {
    try {
      content = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "");
    } catch {
      fail("Text documents must use UTF-8 encoding.");
    }
    if (content.length > MAX_TEXT_CHARS)
      fail(
        "Readable document content must contain at most 200,000 characters.",
      );
  }
  if (!content.trim() && !bytes)
    fail("Add readable document content or upload an original file.");
  if (content.includes("\0"))
    fail("Readable document content cannot contain binary data.");
  return {
    title,
    fileName,
    mimeType,
    content,
    source: text(input.source, "Document source", 1000).trim(),
    effectiveDate: effectiveDate(input.effectiveDate),
    versionLabel: text(
      input.versionLabel ??
        (typeof input.version === "string" ? input.version : ""),
      "Version label",
      100,
    ).trim(),
    supersedesId: text(input.supersedesId, "Previous document ID", 300).trim(),
    bytes,
  };
}
function featureInput(input) {
  if (!object(input)) fail("Send a feature record.");
  return {
    id: text(input.id, "Feature ID", 300),
    title: text(input.title, "Feature title", 150, { required: true }).trim(),
    description: text(input.description, "Feature description", 2000),
    html: text(input.html, "Feature HTML", MAX_FEATURE_CHARS),
    css: text(input.css, "Feature CSS", MAX_FEATURE_CHARS),
    javascript: text(input.javascript, "Feature JavaScript", MAX_FEATURE_CHARS),
  };
}

/** Shared owner-reviewed content. Source code is stored as inert text, never executed here. */
export function createCloudContent(
  db,
  { now = () => new Date(), uuid = randomUUID, knowledgeLimit = 60_000 } = {},
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_documents (
      id TEXT PRIMARY KEY, series_id TEXT NOT NULL, version INTEGER NOT NULL,
      payload TEXT NOT NULL, original_file BLOB, status TEXT NOT NULL DEFAULT 'draft',
      is_current INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      reviewed_by TEXT, reviewed_at TEXT, deleted_at TEXT,
      UNIQUE(series_id, version)
    );
    CREATE INDEX IF NOT EXISTS cloud_documents_current ON cloud_documents(status, is_current, deleted_at);
    CREATE TABLE IF NOT EXISTS cloud_features (
      id TEXT PRIMARY KEY, draft_payload TEXT NOT NULL, published_payload TEXT,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      published_at TEXT, deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cloud_feature_state (
      feature_id TEXT NOT NULL, account_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(feature_id, account_id)
    );
  `);
  const stamp = () => {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  };
  const transaction = (callback) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const findDocument = (id) =>
    db
      .prepare(
        "SELECT * FROM cloud_documents WHERE id = ? AND deleted_at IS NULL",
      )
      .get(id);
  function documentRecord(row, { includeFile = false } = {}) {
    if (!row) return null;
    const payload = JSON.parse(row.payload);
    return {
      ...payload,
      id: row.id,
      seriesId: row.series_id,
      version: row.version,
      status: row.status,
      isCurrent: Boolean(row.is_current),
      hasFile: row.original_file !== null,
      fileSize: row.original_file?.length || 0,
      hasText: Boolean(payload.content?.trim()),
      textStatus: payload.content?.trim() ? "ready" : "needs-text",
      createdBy: row.created_by,
      createdAt: row.created_at,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      ...(includeFile && row.original_file
        ? { fileBase64: Buffer.from(row.original_file).toString("base64") }
        : {}),
    };
  }
  function allowedDocument(user, id) {
    requireUser(user);
    const row = findDocument(id);
    if (
      !row ||
      (user.role !== "owner" && (row.status !== "approved" || !row.is_current))
    )
      fail("Document was not found.", 404);
    return row;
  }
  const findFeature = (id) =>
    db
      .prepare(
        "SELECT * FROM cloud_features WHERE id = ? AND deleted_at IS NULL",
      )
      .get(id);
  function featureRecord(row, user) {
    const draft = JSON.parse(row.draft_payload),
      published = row.published_payload
        ? JSON.parse(row.published_payload)
        : null;
    return {
      ...(user.role === "owner" ? draft : published),
      id: row.id,
      published: Boolean(published),
      publishedRevision: published?.revision ?? null,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(user.role === "owner"
        ? { createdBy: row.created_by, publishedPayload: published }
        : {}),
    };
  }
  function allowedFeature(user, id) {
    requireUser(user);
    const row = findFeature(id);
    if (!row || (user.role !== "owner" && !row.published_payload))
      fail("Feature was not found.", 404);
    return row;
  }

  return {
    listDocuments(user) {
      requireUser(user);
      const rows =
        user.role === "owner"
          ? db
              .prepare(
                "SELECT * FROM cloud_documents WHERE deleted_at IS NULL ORDER BY created_at DESC, version DESC",
              )
              .all()
          : db
              .prepare(
                "SELECT * FROM cloud_documents WHERE deleted_at IS NULL AND status = 'approved' AND is_current = 1 ORDER BY reviewed_at DESC",
              )
              .all();
      return rows.map((row) => documentRecord(row));
    },
    getDocument(user, id, options = {}) {
      return documentRecord(allowedDocument(user, id), options);
    },
    addDocument(user, input) {
      requireOwner(user);
      const { bytes, supersedesId, ...payload } = documentInput(input);
      return transaction(() => {
        const prior = supersedesId ? findDocument(supersedesId) : null;
        if (supersedesId && !prior)
          fail("The previous document was not found.", 404);
        const id = uuid(),
          seriesId = prior?.series_id || id;
        const version =
          Number(
            db
              .prepare(
                "SELECT COALESCE(MAX(version), 0) AS last_version FROM cloud_documents WHERE series_id = ?",
              )
              .get(seriesId).last_version,
          ) + 1;
        db.prepare(
          "INSERT INTO cloud_documents(id, series_id, version, payload, original_file, status, is_current, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'draft', 0, ?, ?)",
        ).run(
          id,
          seriesId,
          version,
          JSON.stringify({ ...payload, supersedesId: prior?.id || null }),
          bytes,
          user.id,
          stamp(),
        );
        return documentRecord(findDocument(id));
      });
    },
    updateDocument(user, id, input) {
      requireOwner(user);
      const row = findDocument(id);
      if (!row) fail("Document was not found.", 404);
      if (row.status !== "draft")
        fail("Create a new document version to change approved content.", 409);
      if (!object(input)) fail("Send document draft changes.");
      const prior = JSON.parse(row.payload);
      const changes = {};
      for (const [key, max] of [
        ["title", 300],
        ["source", 1000],
        ["versionLabel", 100],
        ["content", MAX_TEXT_CHARS],
      ]) {
        if (Object.hasOwn(input, key))
          changes[key] = text(input[key], `Document ${key}`, max, {
            required: key === "title",
          });
      }
      if (Object.hasOwn(input, "effectiveDate"))
        changes.effectiveDate = effectiveDate(input.effectiveDate);
      if (changes.content?.includes("\0"))
        fail("Readable document content cannot contain binary data.");
      db.prepare("UPDATE cloud_documents SET payload = ? WHERE id = ?").run(
        JSON.stringify({ ...prior, ...changes }),
        id,
      );
      return documentRecord(findDocument(id));
    },
    reviewDocument(user, id, input) {
      requireOwner(user);
      if (!object(input) || typeof input.approved !== "boolean")
        fail("Document approval must be true or false.");
      return transaction(() => {
        const row = findDocument(id);
        if (!row) fail("Document was not found.", 404);
        const payload = JSON.parse(row.payload);
        if (input.approved && !payload.content?.trim())
          fail(
            "Add and review readable text before including this file in the assistant’s knowledge.",
          );
        if (input.approved) {
          const newer = db
            .prepare(
              "SELECT id FROM cloud_documents WHERE series_id = ? AND version > ? AND status = 'approved' AND is_current = 1 AND deleted_at IS NULL",
            )
            .get(row.series_id, row.version);
          if (newer)
            fail(
              "A newer approved version is already current. Upload a new version to replace it.",
              409,
            );
          db.prepare(
            "UPDATE cloud_documents SET is_current = 0 WHERE series_id = ?",
          ).run(row.series_id);
        }
        db.prepare(
          "UPDATE cloud_documents SET status = ?, is_current = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        ).run(
          input.approved ? "approved" : "draft",
          input.approved ? 1 : 0,
          user.id,
          stamp(),
          id,
        );
        return documentRecord(findDocument(id));
      });
    },
    deleteDocument(user, id) {
      requireOwner(user);
      if (!findDocument(id)) fail("Document was not found.", 404);
      db.prepare(
        "UPDATE cloud_documents SET deleted_at = ?, is_current = 0 WHERE id = ?",
      ).run(stamp(), id);
      return { ok: true };
    },
    knowledge(user) {
      requireUser(user);
      const limit = Number.isFinite(knowledgeLimit)
        ? Math.max(0, Math.min(100_000, Math.floor(knowledgeLimit)))
        : 60_000;
      let remaining = limit;
      const documents = db
        .prepare(
          "SELECT * FROM cloud_documents WHERE deleted_at IS NULL AND status = 'approved' AND is_current = 1 ORDER BY reviewed_at DESC, version DESC",
        )
        .all();
      const result = [];
      for (const row of documents) {
        if (remaining <= 0) break;
        const item = documentRecord(row);
        if (!item.hasText) continue;
        const content = item.content.slice(0, Math.min(12_000, remaining));
        remaining -= content.length;
        result.push({
          id: item.id,
          seriesId: item.seriesId,
          title: item.title,
          source: item.source,
          fileName: item.fileName,
          effectiveDate: item.effectiveDate,
          version: item.version,
          versionLabel: item.versionLabel,
          content,
          truncated: content.length < item.content.length,
          reviewedAt: item.reviewedAt,
        });
      }
      return result;
    },
    listFeatures(user) {
      requireUser(user);
      const rows =
        user.role === "owner"
          ? db
              .prepare(
                "SELECT * FROM cloud_features WHERE deleted_at IS NULL ORDER BY updated_at DESC",
              )
              .all()
          : db
              .prepare(
                "SELECT * FROM cloud_features WHERE deleted_at IS NULL AND published_payload IS NOT NULL ORDER BY published_at DESC",
              )
              .all();
      return rows.map((row) => featureRecord(row, user));
    },
    getFeature(user, id) {
      return featureRecord(allowedFeature(user, id), user);
    },
    saveFeature(user, input) {
      requireOwner(user);
      const value = featureInput(input),
        prior = value.id ? findFeature(value.id) : null;
      if (value.id && !prior) fail("Feature was not found.", 404);
      const time = stamp(),
        id = prior?.id || uuid(),
        revision = prior
          ? Number(JSON.parse(prior.draft_payload).revision || 0) + 1
          : 1;
      const payload = {
        title: value.title,
        description: value.description,
        html: value.html,
        css: value.css,
        javascript: value.javascript,
        revision,
      };
      if (prior)
        db.prepare(
          "UPDATE cloud_features SET draft_payload = ?, updated_at = ? WHERE id = ?",
        ).run(JSON.stringify(payload), time, id);
      else
        db.prepare(
          "INSERT INTO cloud_features(id, draft_payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, JSON.stringify(payload), user.id, time, time);
      return featureRecord(findFeature(id), user);
    },
    publishFeature(user, id, input) {
      requireOwner(user);
      if (!object(input) || typeof input.published !== "boolean")
        fail("Feature publication must be true or false.");
      const row = findFeature(id);
      if (!row) fail("Feature was not found.", 404);
      const time = stamp();
      db.prepare(
        "UPDATE cloud_features SET published_payload = ?, published_at = ?, updated_at = ? WHERE id = ?",
      ).run(
        input.published ? row.draft_payload : null,
        input.published ? time : null,
        time,
        id,
      );
      return featureRecord(findFeature(id), user);
    },
    deleteFeature(user, id) {
      requireOwner(user);
      if (!findFeature(id)) fail("Feature was not found.", 404);
      db.prepare(
        "UPDATE cloud_features SET deleted_at = ?, published_payload = NULL WHERE id = ?",
      ).run(stamp(), id);
      return { ok: true };
    },
    saveFeatureState(user, featureId, input) {
      allowedFeature(user, featureId);
      const state =
        object(input) && Object.hasOwn(input, "state") ? input.state : input;
      let payload;
      try {
        payload = JSON.stringify(state);
      } catch {
        fail("Feature state must be JSON data.");
      }
      if (payload === undefined || Buffer.byteLength(payload) > 50_000)
        fail("Feature state must be JSON data of at most 50 KB.");
      const time = stamp();
      db.prepare(
        "INSERT INTO cloud_feature_state(feature_id, account_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(feature_id, account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
      ).run(featureId, user.id, payload, time);
      return { featureId, state: JSON.parse(payload), updatedAt: time };
    },
    getFeatureState(user, featureId) {
      allowedFeature(user, featureId);
      const row = db
        .prepare(
          "SELECT payload, updated_at FROM cloud_feature_state WHERE feature_id = ? AND account_id = ?",
        )
        .get(featureId, user.id);
      return {
        featureId,
        state: row ? JSON.parse(row.payload) : null,
        updatedAt: row?.updated_at || null,
      };
    },
  };
}
