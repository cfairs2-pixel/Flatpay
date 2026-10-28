/**
 * Reviewable Condukt handoff for website-only access.
 * The JSON shape below is a myflatpay interchange format, not a documented Condukt API/export schema.
 * No source passwords, identity scans, bank details or automatic KYC approvals are imported.
 */
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const problem = (message) => Object.assign(new Error(message), { status: 400 });
const normalise = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const text = (value, label, max = 300) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > max)
    throw problem(`${label} must be text of at most ${max} characters.`);
  return value.trim();
};
const FIELD_LABELS = {
  businessName: "Business name",
  contactName: "Contact person",
  email: "Contact email",
  phone: "Contact phone",
  provider: "Current provider",
  "saleInfo.companyNumber": "Company registration number",
  "saleInfo.registeredName": "Registered business name",
  "saleInfo.registeredAddress": "Registered business address",
  "saleInfo.industry": "Business activity",
};
export const CONDUKT_INTERCHANGE_SCHEMA = "myflatpay.condukt-import.v1";
export const CONDUKT_ACCESS = Object.freeze({
  mode: "manual-import",
  liveAvailable: false,
  portalUrl: "https://portal.condukt.co/",
  documentationUrl: "https://portal.condukt.co/docs",
  message:
    "Website-only access: paste labelled details or a myflatpay interchange JSON file, review the suggested changes, then save. This does not connect to Condukt or check live document status.",
});
export const CONDUKT_IMPORT_EXAMPLE = {
  schema: CONDUKT_INTERCHANGE_SCHEMA,
  records: [
    {
      sourceRef: {
        requestId: "YOUR-REQUEST-ID",
        url: "https://portal.condukt.co/",
      },
      company: {
        name: "Example business Ltd",
        companyNumber: "00123456",
        registeredAddress: "Business address from the source",
      },
      contact: { name: "Example contact", email: "contact@example.com" },
      provider: "Current payment provider",
      people: [
        {
          id: "person-1",
          name: "Example director",
          roles: ["officer"],
          roleTitle: "Managing director",
        },
      ],
      documents: [
        {
          id: "document-1",
          personId: "person-1",
          type: "identity",
          required: true,
          status: "required",
        },
      ],
    },
  ],
};
export function validateConduktUrl(value) {
  const source = text(value, "Condukt source URL", 2000);
  if (!source) return "";
  let url;
  try {
    url = new URL(source);
  } catch {
    throw problem("Enter a valid Condukt source URL.");
  }
  if (
    url.protocol !== "https:" ||
    !["condukt.co", "portal.condukt.co"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    /token|password|secret|authorization|api.?key|session|code=/i.test(
      url.hash,
    ) ||
    [...url.searchParams.keys()].some((k) =>
      /token|password|secret|authorization|api.?key|session|^code$/i.test(k),
    )
  )
    throw problem(
      "Use an HTTPS condukt.co or portal.condukt.co link without credentials or access tokens.",
    );
  return url.href;
}
function checkedDate(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (
    typeof value !== "string" ||
    value.length > 50 ||
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`)) ||
    new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
      .toISOString()
      .slice(0, 10) !== value.slice(0, 10)
  )
    throw problem("The source last-checked date is invalid.");
  return new Date(value).toISOString();
}
function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw problem("Import time is invalid.");
  return date.toISOString();
}
function role(value) {
  const v = normalise(value);
  if (
    ["officer", "director", "managing director", "managing_director"].includes(
      v,
    )
  )
    return "officer";
  if (
    [
      "beneficial owner",
      "ubo",
      "psc",
      "person with significant control",
    ].includes(v)
  )
    return "beneficial_owner";
  return "other";
}
function documentType(value) {
  const v = normalise(value);
  if (
    [
      "id",
      "identity",
      "proof of identity",
      "identity document",
      "passport",
      "driving licence",
      "driving license",
    ].includes(v)
  )
    return "identity";
  if (
    [
      "address",
      "proof of address",
      "address evidence",
      "address document",
    ].includes(v)
  )
    return "proof_of_address";
  if (
    ["signature", "signed contract", "contract signature", "contract"].includes(
      v,
    )
  )
    return "contract_signature";
  if (["bank", "bank document", "bank statement", "bank evidence"].includes(v))
    return "bank_document";
  return "other";
}
const TYPE_LABELS = {
  identity: "Identity document",
  proof_of_address: "Proof of address",
  contract_signature: "Contract signature",
  bank_document: "Bank document",
  other: "Document requirement",
};
function documentStatus(value) {
  const v = normalise(value);
  if (
    [
      "required",
      "missing",
      "requested",
      "outstanding",
      "not submitted",
      "awaiting document",
      "awaiting documents",
    ].includes(v)
  )
    return "required";
  if (
    [
      "submitted",
      "received",
      "pending review",
      "awaiting review",
      "under review",
      "in review",
      "uploaded",
    ].includes(v)
  )
    return "submitted";
  if (["approved", "verified", "accepted", "complete", "completed"].includes(v))
    return "approved";
  if (
    [
      "rejected",
      "declined",
      "expired",
      "resubmit",
      "resubmission required",
    ].includes(v)
  )
    return "rejected";
  return "unknown";
}
function requiredFlag(value, sourceStatus, status) {
  if (value !== undefined && value !== null && typeof value !== "boolean")
    throw problem("Document required flags must be true, false or null.");
  if (typeof value === "boolean") return value;
  if (["not required", "waived", "optional"].includes(normalise(sourceStatus)))
    return false;
  return status === "required" ? true : null;
}
function parseLabelledText(input) {
  const raw = {
    company: {},
    contact: {},
    people: [],
    documents: [],
    sourceRef: {},
  };
  const labels = {
    "company name": ["company", "name"],
    "registered company name": ["company", "name"],
    "business name": ["company", "name"],
    "registered name": ["company", "name"],
    "legal name": ["company", "name"],
    "company number": ["company", "companyNumber"],
    "company registration number": ["company", "companyNumber"],
    "registration number": ["company", "companyNumber"],
    crn: ["company", "companyNumber"],
    "registered address": ["company", "registeredAddress"],
    "registered business address": ["company", "registeredAddress"],
    "business activity": ["company", "industry"],
    industry: ["company", "industry"],
    "contact name": ["contact", "name"],
    "contact person": ["contact", "name"],
    "contact email": ["contact", "email"],
    email: ["contact", "email"],
    "contact phone": ["contact", "phone"],
    phone: ["contact", "phone"],
    provider: ["root", "provider"],
    "current provider": ["root", "provider"],
    "payment provider": ["root", "provider"],
    "request id": ["sourceRef", "requestId"],
    "condukt request id": ["sourceRef", "requestId"],
    "customer id": ["sourceRef", "customerId"],
    "condukt customer id": ["sourceRef", "customerId"],
    "source url": ["sourceRef", "url"],
    "condukt url": ["sourceRef", "url"],
    "last checked": ["sourceRef", "lastCheckedAt"],
  };
  let recognised = 0;
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]{1,80}):\s*(.*)$/);
    if (!match) continue;
    const label = normalise(match[1]),
      value = match[2].trim();
    if (Object.hasOwn(labels, label)) {
      const [group, key] = labels[label];
      (group === "root" ? raw : raw[group])[key] = value;
      recognised++;
      continue;
    }
    if (
      [
        "officer",
        "director",
        "managing director",
        "beneficial owner",
        "ubo",
      ].includes(label)
    ) {
      raw.people.push({
        id: `person-${raw.people.length + 1}`,
        name: value,
        roles: [role(label)],
        roleTitle: label,
      });
      recognised++;
      continue;
    }
    if (label === "document" || label === "document requirement") {
      const parts = value.split("|").map((p) => p.trim());
      if (parts.length === 2)
        raw.documents.push({ type: parts[0], status: parts[1] });
      else if (parts.length >= 3)
        raw.documents.push({
          personName: parts[0],
          type: parts[1],
          status: parts[2],
          ...(parts[3]
            ? {
                required: /^(true|required|yes)$/i.test(parts[3])
                  ? true
                  : /^(false|optional|no)$/i.test(parts[3])
                    ? false
                    : undefined,
              }
            : {}),
        });
      else continue;
      recognised++;
    }
  }
  return { records: [raw], textImport: true, recognised };
}
function inputRecords(input) {
  if (typeof input === "string") {
    if (input.length > 1024 * 1024)
      throw problem("Condukt input exceeds the 1 MB limit.");
    const s = input.trim();
    if (!s) throw problem("Paste Condukt details or interchange JSON.");
    if (/^[\[{]/.test(s)) {
      try {
        return inputRecords(JSON.parse(s));
      } catch (error) {
        if (error.status) throw error;
        throw problem("The Condukt interchange JSON is invalid.");
      }
    }
    return parseLabelledText(s);
  }
  if (Array.isArray(input)) return { records: input, textImport: false };
  if (!record(input))
    throw problem("Provide labelled text or a Condukt interchange object.");
  if (input.schema !== undefined && input.schema !== CONDUKT_INTERCHANGE_SCHEMA)
    throw problem(`Use the ${CONDUKT_INTERCHANGE_SCHEMA} interchange schema.`);
  const rows = Array.isArray(input.records)
    ? input.records
    : Array.isArray(input.companies)
      ? input.companies
      : [input];
  return { records: rows, textImport: false };
}
function readPath(value, path) {
  return path
    .split(".")
    .reduce((v, key) => (record(v) ? v[key] : undefined), value);
}
function setPath(target, path, value) {
  const keys = path.split(".");
  let ref = target;
  for (const key of keys.slice(0, -1)) ref = ref[key] ??= {};
  ref[keys.at(-1)] = value;
}
function extractCandidate(raw, index, existingDeals, at, textImport) {
  if (!record(raw))
    throw problem(`Condukt record ${index + 1} must be an object.`);
  const company = record(raw.company) ? raw.company : raw,
    contact = record(raw.contact) ? raw.contact : {},
    ref = record(raw.sourceRef) ? raw.sourceRef : {};
  const name = text(
    company.name ?? company.businessName ?? company.companyName,
    "Company name",
  );
  const companyNumber = text(
    company.companyNumber ?? company.registrationNumber ?? company.crn,
    "Company number",
    30,
  )
    .replace(/\s+/g, "")
    .toUpperCase();
  const requestId = text(ref.requestId ?? raw.requestId, "Condukt request ID"),
    customerId = text(ref.customerId ?? raw.customerId, "Condukt customer ID");
  const sourceRef = {
    requestId,
    customerId,
    url: validateConduktUrl(ref.url ?? raw.sourceUrl),
    lastCheckedAt: checkedDate(ref.lastCheckedAt ?? raw.lastCheckedAt, at),
    importedAt: at,
    mode: "manual-import",
  };
  const suggestedFields = {};
  const candidates = {
    businessName: name,
    contactName: text(contact.name ?? raw.contactName, "Contact name"),
    email: text(contact.email ?? raw.email, "Contact email"),
    phone: text(contact.phone ?? raw.phone, "Contact phone"),
    provider: text(raw.provider ?? company.provider, "Current provider"),
    "saleInfo.companyNumber": companyNumber,
    "saleInfo.registeredName": text(
      company.registeredName ?? name,
      "Registered business name",
    ),
    "saleInfo.registeredAddress": text(
      company.registeredAddress,
      "Registered business address",
      2000,
    ),
    "saleInfo.industry": text(company.industry, "Business activity"),
  };
  if (candidates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidates.email))
    throw problem("The imported contact email is invalid.");
  for (const [path, value] of Object.entries(candidates))
    if (value) setPath(suggestedFields, path, value);
  const warnings = [];
  if (textImport)
    warnings.push(
      "Only recognised labelled lines were imported. Review the source website for omitted details; no live connection or status check was made.",
    );
  if (!Object.keys(suggestedFields).length && !requestId && !customerId)
    warnings.push(
      "No company details or references were recognised. Add explicit labels or use the interchange JSON format.",
    );
  const peopleInput = raw.people ?? [];
  if (!Array.isArray(peopleInput) || peopleInput.length > 100)
    throw problem("A record can include up to 100 named people.");
  const people = peopleInput.map((person, i) => {
    if (!record(person))
      throw problem("Each Condukt person must be an object.");
    const roles = person.roles ?? (person.role ? [person.role] : []);
    if (
      !Array.isArray(roles) ||
      roles.length > 10 ||
      roles.some((v) => typeof v !== "string" || v.length > 100)
    )
      throw problem("Person roles must be a list of short text values.");
    return {
      id: text(person.id, "Person reference") || `person-${i + 1}`,
      name: text(person.name, "Person name"),
      roles: [...new Set(roles.map(role))],
      roleTitle: text(person.roleTitle, "Person role title"),
    };
  });
  if (people.some((p) => !p.name))
    throw problem("Each imported person needs a name.");
  if (new Set(people.map((p) => p.id)).size !== people.length)
    throw problem("Condukt person references must be unique within a record.");
  const documents = raw.documents ?? raw.documentTasks ?? [];
  if (!Array.isArray(documents) || documents.length > 300)
    throw problem("A record can include up to 300 document requirements.");
  const allDocuments = [...documents];
  peopleInput.forEach((person, i) => {
    if (person.documents !== undefined) {
      if (!Array.isArray(person.documents) || person.documents.length > 30)
        throw problem(
          "Each person can include up to 30 document requirements.",
        );
      for (const doc of person.documents) {
        if (!record(doc))
          throw problem("Document requirements must be objects.");
        allDocuments.push({ ...doc, personId: people[i].id });
      }
    }
  });
  if (allDocuments.length > 300)
    throw problem("A record can include up to 300 document requirements.");
  const taskIds = new Set();
  const documentTasks = allDocuments.map((doc, i) => {
    if (!record(doc)) throw problem("Document requirements must be objects.");
    const personId = text(doc.personId, "Document person reference"),
      personName = text(doc.personName, "Document person name");
    const namedPeople = personName
      ? people.filter((p) => normalise(p.name) === normalise(personName))
      : [];
    const person = personId
      ? people.find((p) => p.id === personId)
      : namedPeople.length === 1
        ? namedPeople[0]
        : null;
    if (!personId && namedPeople.length > 1)
      warnings.push(
        `The document for ${personName} matches more than one person. Confirm the person reference before requesting evidence.`,
      );
    const kind = text(doc.type ?? doc.label, "Document type", 100),
      type = documentType(kind),
      sourceStatus = text(doc.status, "Document status", 100),
      status = documentStatus(sourceStatus);
    let id = text(doc.id, "Document reference") || `document-${i + 1}`;
    if (taskIds.has(id)) {
      warnings.push(
        "Duplicate document references were kept separately for review; their statuses were not merged.",
      );
      id = `${id.slice(0, 270)}-duplicate-${i + 1}`;
    }
    taskIds.add(id);
    if (personId && !person)
      warnings.push(
        `Document ${id} refers to a person not listed in this import.`,
      );
    return {
      id,
      personId: person?.id || personId || "",
      personName: person?.name || personName || "Business",
      type,
      label: type === "other" ? kind || TYPE_LABELS.other : TYPE_LABELS[type],
      status,
      required: requiredFlag(doc.required, sourceStatus, status),
      sourceStatus,
      requirementSource: "imported",
      lastCheckedAt: checkedDate(doc.lastCheckedAt, sourceRef.lastCheckedAt),
    };
  });
  const matchesByRef = existingDeals.filter(
    (d) =>
      (requestId && d.condukt?.requestId === requestId) ||
      (customerId && d.condukt?.customerId === customerId),
  );
  const matchesByNumber = companyNumber
    ? existingDeals.filter(
        (d) =>
          String(d.saleInfo?.companyNumber || "")
            .replace(/\s+/g, "")
            .toUpperCase() === companyNumber,
      )
    : [];
  const matchesByName = name
    ? existingDeals.filter((d) => normalise(d.businessName) === normalise(name))
    : [];
  const matches = matchesByRef.length
    ? matchesByRef
    : matchesByNumber.length
      ? matchesByNumber
      : matchesByName;
  const match = {
    status:
      matches.length === 1
        ? "matched"
        : matches.length > 1
          ? "ambiguous"
          : "new",
    dealId: matches.length === 1 ? matches[0].id : null,
    matches: matches.map((d) => ({ id: d.id, businessName: d.businessName })),
  };
  const existing = matches.length === 1 ? matches[0] : {};
  const fieldChanges = Object.keys(FIELD_LABELS)
    .filter((path) => readPath(suggestedFields, path) !== undefined)
    .map((path) => ({
      path,
      label: FIELD_LABELS[path],
      currentValue: readPath(existing, path) ?? "",
      suggestedValue: readPath(suggestedFields, path),
      conflict:
        readPath(existing, path) !== undefined &&
        readPath(existing, path) !== "" &&
        String(readPath(existing, path)) !==
          String(readPath(suggestedFields, path)),
    }));
  if (match.status === "ambiguous")
    warnings.push(
      "More than one saved merchant matches. Choose the correct merchant before applying any fields.",
    );
  const trainingSuggestions = buildTrainingSuggestions(people, documentTasks);
  return {
    candidateId: `condukt-record-${index + 1}`,
    sourceRef,
    match,
    suggestedFields,
    fieldChanges,
    people,
    documentTasks,
    outstanding: documentTasks.filter(
      (t) =>
        t.required === true &&
        ["required", "rejected", "unknown"].includes(t.status),
    ),
    awaitingReview: documentTasks.filter(
      (t) => t.status === "submitted" && t.required !== false,
    ),
    needsReview: documentTasks.filter(
      (t) => t.status === "unknown" || t.required === null,
    ),
    trainingSuggestions,
    warnings,
  };
}
function buildTrainingSuggestions(people, documentTasks) {
  const officers = people.filter((p) => p.roles.includes("officer")),
    directors = officers.filter((p) => /managing director/i.test(p.roleTitle)),
    signers = directors.length ? directors : officers;
  const suggestions = [];
  function add(person, type, reason) {
    if (documentTasks.some((d) => d.personId === person.id && d.type === type))
      return;
    suggestions.push({
      id: `training-${person.id}-${type}`,
      personId: person.id,
      personName: person.name,
      type,
      label: TYPE_LABELS[type],
      status: "unknown",
      required: null,
      requirementSource: "training-suggestion",
      requiresConfirmation: true,
      reason,
    });
  }
  for (const person of people) {
    if (
      person.roles.includes("beneficial_owner") ||
      signers.some((p) => p.id === person.id)
    )
      for (const type of ["identity", "proof_of_address"])
        add(
          person,
          type,
          "Suggested by the supplied Flatpay Day 2 training. Confirm against the current Condukt case and head-office requirements.",
        );
    if (signers.some((p) => p.id === person.id))
      add(
        person,
        "contract_signature",
        "Supplied Day 2 training identifies managing directors as signers, or all officers if no managing director is listed. Confirm the current signing requirements.",
      );
  }
  return suggestions;
}
/** Preview only; no fields, checklist items or external cases are changed. */
export function previewConduktImport(
  input,
  existingDeals = [],
  userId,
  { now = () => new Date() } = {},
) {
  if (!Array.isArray(existingDeals))
    throw problem("Saved merchants must be a list.");
  const parsed = inputRecords(input);
  if (parsed.records.length === 0 || parsed.records.length > 100)
    throw problem("Import between 1 and 100 company records at a time.");
  const at = timestamp(now),
    accessible = existingDeals.filter(
      (d) =>
        record(d) &&
        (!userId ||
          !(d.ownerId ?? d.owner_id) ||
          (d.ownerId ?? d.owner_id) === userId),
    );
  const candidates = parsed.records.map((row, i) =>
    extractCandidate(row, i, accessible, at, parsed.textImport),
  );
  return {
    schema: CONDUKT_INTERCHANGE_SCHEMA,
    mode: "manual-import",
    source: "Condukt",
    generatedAt: at,
    candidates,
    warnings: [
      "This is a manual source snapshot. Submitted documents are not treated as approved, and no KYC or legal completion is inferred.",
      ...(parsed.textImport && parsed.recognised === 0
        ? ["No supported labelled lines were recognised."]
        : []),
    ],
  };
}
/** Select only document-tracking metadata; do not accept original identity/bank document payloads. */
export function sanitiseConduktSnapshot(value) {
  if (!record(value)) throw problem("Condukt metadata must be an object.");
  const at = timestamp(() => new Date());
  const people = Array.isArray(value.people) ? value.people : [];
  const tasks = Array.isArray(value.documentTasks) ? value.documentTasks : [];
  if (people.length > 100 || tasks.length > 300)
    throw problem("Condukt tracking metadata is too large.");
  const cleanPeople = people.map((person) => {
    if (!record(person)) throw problem("Condukt people must be objects.");
    if (
      !Array.isArray(person.roles) ||
      person.roles.length > 10 ||
      person.roles.some((v) => typeof v !== "string" || v.length > 100)
    )
      throw problem("Condukt person roles are invalid.");
    return {
      id: text(person.id, "Person reference"),
      name: text(person.name, "Person name"),
      roles: [...new Set(person.roles.map(role))],
      roleTitle: text(person.roleTitle, "Person role title"),
    };
  });
  const cleanTasks = tasks.map((task) => {
    if (
      !record(task) ||
      !["required", "submitted", "approved", "rejected", "unknown"].includes(
        task.status,
      )
    )
      throw problem("Condukt document status is invalid.");
    const status = task.status;
    return {
      id: text(task.id, "Document reference"),
      personId: text(task.personId, "Document person reference"),
      personName: text(task.personName, "Document person name"),
      type: documentType(task.type),
      label: text(task.label, "Document label", 100),
      status,
      required: requiredFlag(task.required, task.sourceStatus, status),
      sourceStatus: text(task.sourceStatus, "Document source status", 100),
      requirementSource: "imported",
      lastCheckedAt: checkedDate(task.lastCheckedAt, at),
    };
  });
  if (
    cleanPeople.some((p) => !p.id || !p.name) ||
    new Set(cleanPeople.map((p) => p.id)).size !== cleanPeople.length ||
    cleanTasks.some((t) => !t.id) ||
    new Set(cleanTasks.map((t) => t.id)).size !== cleanTasks.length
  )
    throw problem("Condukt tracking references must be present and unique.");
  return {
    mode: "manual-import",
    requestId: text(value.requestId, "Condukt request ID"),
    customerId: text(value.customerId, "Condukt customer ID"),
    url: validateConduktUrl(value.url),
    lastCheckedAt: checkedDate(value.lastCheckedAt, at),
    importedAt: checkedDate(value.importedAt, at),
    people: cleanPeople,
    ...(value.documentTasks !== undefined ? { documentTasks: cleanTasks } : {}),
  };
}
/** Explicitly selected field changes only; no existing checklist or commission data is modified. */
export function buildConduktPatch(
  candidate,
  { fieldPaths = [], includeDocumentTasks = true } = {},
) {
  if (
    !record(candidate) ||
    !record(candidate.sourceRef) ||
    !record(candidate.suggestedFields) ||
    !Array.isArray(candidate.fieldChanges)
  )
    throw problem("Use a reviewed Condukt import candidate.");
  if (
    !Array.isArray(fieldPaths) ||
    fieldPaths.some((path) => !Object.hasOwn(FIELD_LABELS, path))
  )
    throw problem("Choose only supported Condukt prefill fields.");
  const patch = {};
  for (const path of [...new Set(fieldPaths)]) {
    const change = candidate.fieldChanges.find((c) => c.path === path),
      value = readPath(candidate.suggestedFields, path);
    if (!change || typeof value !== "string" || !value)
      throw problem("Choose only fields present in the import preview.");
    setPath(patch, path, value);
  }
  const ref = candidate.sourceRef;
  patch.condukt = sanitiseConduktSnapshot({
    ...ref,
    people: candidate.people || [],
    ...(includeDocumentTasks
      ? { documentTasks: candidate.documentTasks || [] }
      : {}),
  });
  return patch;
}
/** Outstanding work is based on recorded requirements, not a claim about the live Condukt case. */
export function conduktDocumentSummary(deal) {
  const tasks = Array.isArray(deal?.condukt?.documentTasks)
    ? deal.condukt.documentTasks
    : [];
  return {
    lastCheckedAt: deal?.condukt?.lastCheckedAt || null,
    outstanding: tasks.filter(
      (t) =>
        t.required === true &&
        ["required", "rejected", "unknown"].includes(t.status),
    ),
    awaitingReview: tasks.filter(
      (t) => t.status === "submitted" && t.required !== false,
    ),
    needsReview: tasks.filter(
      (t) => t.status === "unknown" || t.required === null,
    ),
    approved: tasks.filter((t) => t.status === "approved"),
  };
}
