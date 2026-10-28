import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCloudContent } from "../shared/cloud-content.mjs";

const owner = { id: "owner-one", role: "owner", name: "Workspace Owner" };
const salesperson = { id: "sales-one", role: "sales" };
const otherSalesperson = { id: "sales-two", role: "sales" };
const byStatus = (status) => (error) => error.status === status;
function fixture(t, options = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let sequence = 0;
  return createCloudContent(db, {
    now: () => new Date("2026-10-27T12:00:00Z"),
    uuid: () => `content-${++sequence}`,
    ...options,
  });
}
const document = (overrides = {}) => ({
  title: "Head office sales guidance",
  fileName: "sales-guidance.txt",
  mimeType: "text/plain",
  content: "Use the approved AC and record all pricing conditions.",
  source: "Head office",
  effectiveDate: "2026-10-01",
  versionLabel: "October update",
  ...overrides,
});
const feature = (overrides = {}) => ({
  title: "Custom call planner",
  description: "A tool for planning daily visits.",
  html: "<div id='planner'>First version</div>",
  css: "div { color: black; }",
  javascript: "globalThis.featureExecuted = true;",
  ...overrides,
});

test("only the owner can manage content; sales accounts see reviewed current documents", (t) => {
  const content = fixture(t);
  assert.throws(() => content.listDocuments(null), byStatus(401));
  assert.throws(
    () => content.addDocument(salesperson, document()),
    byStatus(403),
  );
  const draft = content.addDocument(owner, document());
  assert.equal(draft.status, "draft");
  assert.equal(draft.isCurrent, false);
  assert.equal(draft.version, 1);
  assert.equal(draft.hasText, true);
  assert.deepEqual(content.listDocuments(salesperson), []);
  assert.throws(
    () => content.getDocument(salesperson, draft.id),
    byStatus(404),
  );
  assert.deepEqual(content.knowledge(owner), []);
  assert.throws(
    () => content.reviewDocument(salesperson, draft.id, { approved: true }),
    byStatus(403),
  );
  const approved = content.reviewDocument(owner, draft.id, { approved: true });
  assert.equal(approved.reviewedBy, owner.id);
  assert.equal(content.listDocuments(salesperson)[0].id, draft.id);
  assert.equal(content.knowledge(salesperson)[0].content, document().content);
  assert.equal(content.knowledge(salesperson)[0].source, "Head office");
  assert.throws(
    () =>
      content.updateDocument(owner, draft.id, { content: "Silently changed" }),
    byStatus(409),
  );
});

test("new document versions retain the prior approved record until the owner reviews the replacement", (t) => {
  const content = fixture(t);
  const first = content.addDocument(owner, document());
  content.reviewDocument(owner, first.id, { approved: true });
  const next = content.addDocument(
    owner,
    document({
      content: "New approved sales guidance.",
      supersedesId: first.id,
      versionLabel: "November revision",
    }),
  );
  assert.equal(next.seriesId, first.seriesId);
  assert.equal(next.version, 2);
  assert.equal(content.knowledge(salesperson)[0].id, first.id);
  assert.equal(content.listDocuments(owner).length, 2);
  content.reviewDocument(owner, next.id, { approved: true });
  assert.equal(content.knowledge(salesperson).length, 1);
  assert.equal(content.knowledge(salesperson)[0].id, next.id);
  assert.equal(
    content.getDocument(owner, first.id).content,
    document().content,
  );
  assert.equal(content.getDocument(owner, first.id).isCurrent, false);
  assert.throws(
    () => content.reviewDocument(owner, first.id, { approved: true }),
    byStatus(409),
  );
  content.deleteDocument(owner, next.id);
  assert.deepEqual(content.knowledge(salesperson), []);
  assert.throws(() => content.getDocument(salesperson, next.id), byStatus(404));
  assert.throws(
    () => content.addDocument(owner, document({ supersedesId: "missing" })),
    byStatus(404),
  );
  // A failed replacement transaction leaves the existing version chain intact.
  assert.equal(content.listDocuments(owner).length, 1);
});

test("uploads retain original files but require readable reviewed text before assistant use", (t) => {
  const content = fixture(t);
  const original = Buffer.from(
    "%PDF-1.7\nTest fixture; binary preserved as an attachment.",
  );
  const draft = content.addDocument(
    owner,
    document({
      title: "New product PDF",
      fileName: "product.pdf",
      mimeType: "application/pdf",
      content: "",
      fileBase64: original.toString("base64"),
    }),
  );
  assert.equal(draft.textStatus, "needs-text");
  assert.equal(draft.hasFile, true);
  assert.equal(draft.fileSize, original.length);
  assert.equal(content.listDocuments(owner)[0].fileBase64, undefined);
  assert.equal(
    content.getDocument(owner, draft.id, { includeFile: true }).fileBase64,
    original.toString("base64"),
  );
  assert.throws(
    () => content.reviewDocument(owner, draft.id, { approved: true }),
    byStatus(400),
  );
  content.updateDocument(owner, draft.id, {
    content: "Owner-reviewed extracted product information.",
  });
  content.reviewDocument(owner, draft.id, { approved: true });
  assert.match(content.knowledge(salesperson)[0].content, /Owner-reviewed/);
  const textFile = content.addDocument(
    owner,
    document({
      content: "",
      fileBase64: Buffer.from("UTF-8 text: £120,000 annual TPV").toString(
        "base64",
      ),
    }),
  );
  assert.equal(textFile.content, "UTF-8 text: £120,000 annual TPV");
});

test("document validation rejects invalid dates, executable types, oversized and mismatched files", (t) => {
  const content = fixture(t);
  for (const changes of [
    { fileName: "../policy.txt" },
    { fileName: "policy\n.txt" },
    { fileName: "policy.html", mimeType: "text/html" },
    { effectiveDate: "2026-02-30" },
    { content: "x".repeat(200_001) },
    {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      fileBase64: Buffer.from("not PDF").toString("base64"),
    },
    { fileBase64: "not valid base64" },
    { fileName: "policy.docx", mimeType: "application/pdf" },
    {
      content: "",
      fileBase64: Buffer.from([0xff, 0xfe, 0x00]).toString("base64"),
    },
  ])
    assert.throws(
      () => content.addDocument(owner, document(changes)),
      byStatus(400),
    );
  assert.deepEqual(content.listDocuments(owner), []);
  const bounded = fixture(t, { knowledgeLimit: 17 });
  const doc = bounded.addDocument(owner, document());
  bounded.reviewDocument(owner, doc.id, { approved: true });
  assert.equal(bounded.knowledge(salesperson)[0].content.length, 17);
  assert.equal(bounded.knowledge(salesperson)[0].truncated, true);
});

test("feature code remains inert; draft edits cannot change the published tool until republished", (t) => {
  const content = fixture(t);
  delete globalThis.featureExecuted;
  const first = content.saveFeature(owner, feature());
  assert.equal(globalThis.featureExecuted, undefined);
  assert.equal(first.revision, 1);
  assert.equal(first.published, false);
  assert.deepEqual(content.listFeatures(salesperson), []);
  assert.throws(() => content.getFeature(salesperson, first.id), byStatus(404));
  assert.throws(
    () => content.saveFeature(salesperson, feature()),
    byStatus(403),
  );
  assert.throws(
    () => content.publishFeature(salesperson, first.id, { published: true }),
    byStatus(403),
  );
  content.publishFeature(owner, first.id, { published: true });
  content.saveFeature(
    owner,
    feature({
      id: first.id,
      title: "Unpublished replacement",
      html: "<p>Draft replacement</p>",
    }),
  );
  assert.equal(
    content.listFeatures(salesperson)[0].title,
    "Custom call planner",
  );
  assert.equal(content.listFeatures(salesperson)[0].revision, 1);
  assert.equal(content.getFeature(owner, first.id).revision, 2);
  assert.equal(
    content.getFeature(owner, first.id).publishedPayload.revision,
    1,
  );
  content.publishFeature(owner, first.id, { published: true });
  assert.equal(
    content.listFeatures(salesperson)[0].title,
    "Unpublished replacement",
  );
  assert.equal(globalThis.featureExecuted, undefined);
});

test("feature state is isolated per account and disappears from access when a tool is unpublished or deleted", (t) => {
  const content = fixture(t);
  const saved = content.saveFeature(owner, feature());
  content.publishFeature(owner, saved.id, { published: true });
  content.saveFeatureState(salesperson, saved.id, { state: { calls: 4 } });
  content.saveFeatureState(otherSalesperson, saved.id, {
    state: { calls: 19 },
  });
  assert.deepEqual(content.getFeatureState(salesperson, saved.id).state, {
    calls: 4,
  });
  assert.deepEqual(content.getFeatureState(otherSalesperson, saved.id).state, {
    calls: 19,
  });
  assert.equal(content.getFeatureState(owner, saved.id).state, null);
  assert.throws(
    () =>
      content.saveFeatureState(salesperson, saved.id, {
        state: "x".repeat(50_001),
      }),
    byStatus(400),
  );
  assert.deepEqual(content.getFeatureState(salesperson, saved.id).state, {
    calls: 4,
  });
  content.publishFeature(owner, saved.id, { published: false });
  assert.throws(
    () => content.getFeatureState(salesperson, saved.id),
    byStatus(404),
  );
  content.publishFeature(owner, saved.id, { published: true });
  assert.deepEqual(content.getFeatureState(salesperson, saved.id).state, {
    calls: 4,
  });
  assert.throws(
    () => content.deleteFeature(salesperson, saved.id),
    byStatus(403),
  );
  content.deleteFeature(owner, saved.id);
  assert.throws(() => content.getFeatureState(owner, saved.id), byStatus(404));
});
