/** Conservative, on-device document prefills. This module never returns raw OCR or identity/bank identifiers. */
export const DOCUMENT_FIELDS = Object.freeze({
  contactName: { label: "Contact name", max: 300 },
  "saleInfo.signatoryName": { label: "Authorised signatory name", max: 300 },
  "saleInfo.registeredName": { label: "Registered business name", max: 300 },
  "saleInfo.signatoryAddress": { label: "Signatory home address", max: 2000 },
  "saleInfo.registeredAddress": {
    label: "Registered business address",
    max: 2000,
  },
  "saleInfo.installationAddress": { label: "Installation address", max: 2000 },
});
const postcode = /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const businessWords =
  /\b(?:LTD\.?|LIMITED|LLP|PLC|INC\.?|LLC|GMBH|CORPORATION|COMPANY)\b/i;
const stopAddress =
  /^(?:account\s*(?:number|no|details|balance)|sort\s*code|iban|bic|swift|statement|opening|closing|balance|transactions?|date\b|page\b|customer\s*(?:number|no|reference)|5[.)]?\s|9[.)]?\s|categories|signature|4[abc][.)]?\s)/i;
const typeName = (value) => {
  const type = String(value || "").toLowerCase();
  if (
    [
      "licence",
      "license",
      "driving-licence",
      "driver",
      "driving",
      "driving_license",
    ].includes(type)
  )
    return "licence";
  if (["bank", "bank-statement", "statement", "bank_statement"].includes(type))
    return "bank";
  return type === "passport" ? "passport" : null;
};
const tidy = (value) =>
  value
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
function titleName(value) {
  const name = tidy(value).replace(/^(?:MR|MRS|MISS|MS|DR)\.?\s+/i, "");
  return name === name.toUpperCase() || name === name.toLowerCase()
    ? name.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : name;
}
function personName(value) {
  if (typeof value !== "string") return null;
  const clean = tidy(value).replace(/^[\s:.-]+|[\s:.-]+$/g, "");
  if (
    clean.length < 3 ||
    clean.length > 150 ||
    /\d|[<>:@/\\=]/.test(clean) ||
    !/^[\p{L}\p{M} '\u2019.-]+$/u.test(clean)
  )
    return null;
  const words = clean.split(/\s+/);
  if (words.length > 12 || words.some((word) => word.length > 40)) return null;
  if (
    /^(?:passport|driving licen[cs]e|bank statement|united kingdom|account holder|given names?|surname|date of birth|nationality|signature|address|customer name)$/i.test(
      clean,
    )
  )
    return null;
  return titleName(clean);
}
function labelValue(lines, labels) {
  for (let index = 0; index < lines.length; index++) {
    for (const label of labels) {
      const match = lines[index].match(label);
      if (!match) continue;
      const own = tidy(match[1] || "");
      if (own) return own;
      const next = lines[index + 1];
      if (
        next &&
        !/^(?:[1-9][a-c]?[.)]\s|surname|given names?|first names?|nationality|date of|place of|sex|address|account|sort code)/i.test(
          next,
        )
      )
        return next;
    }
  }
  return null;
}
function numberedValue(lines, number) {
  const label = new RegExp(`^${number}(?:[.)]\\s*|\\s+)(.*)$`);
  return labelValue(lines, [label]);
}
function checksum(value, expected) {
  if (!/^[0-9<]$/.test(expected || "")) return false;
  const weights = [7, 3, 1];
  let total = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const amount =
      character === "<"
        ? 0
        : /\d/.test(character)
          ? Number(character)
          : character.charCodeAt(0) - 55;
    if (amount < 0 || amount > 35) return false;
    total += amount * weights[index % 3];
  }
  return total % 10 === (expected === "<" ? 0 : Number(expected));
}
function mrzName(lines) {
  const normalised = lines.map((line) =>
    line.toUpperCase().replace(/[«]/g, "<<").replace(/\s/g, ""),
  );
  const index = normalised.findIndex(
    (line) =>
      /^P[A-Z<][A-Z<]{3}[A-Z<]{5,}$/.test(line) && line.slice(5).includes("<<"),
  );
  if (index < 0) return null;
  const first = normalised[index];
  const [surname, given = ""] = first.slice(5).split("<<");
  const last = personName(surname.replaceAll("<", " "));
  const names = personName(given.replaceAll("<", " "));
  if (!last || !names) return null;
  const second = normalised[index + 1] || "";
  const valid =
    first.length === 44 &&
    second.length === 44 &&
    /^[A-Z0-9<]{44}$/.test(second) &&
    checksum(second.slice(0, 9), second[9]) &&
    checksum(second.slice(13, 19), second[19]) &&
    checksum(second.slice(21, 27), second[27]) &&
    checksum(second.slice(28, 42), second[42]) &&
    checksum(
      second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43),
      second[43],
    );
  return {
    value: `${names} ${last}`,
    confidence: valid ? "high" : "medium",
    source: "Passport machine-readable name",
    reason: valid
      ? "The machine-readable name pattern and check digits agree. Confirm the name against the photo."
      : "A machine-readable name was found, but its check digits could not all be confirmed. Check spelling against the photo.",
  };
}
function addressFromLabel(lines, labels) {
  for (let index = 0; index < lines.length; index++) {
    for (const label of labels) {
      const match = lines[index].match(label);
      if (!match) continue;
      const block = [];
      const first = tidy(match[1] || "");
      if (first) block.push(first);
      for (
        let next = index + 1;
        next < lines.length &&
        block.length < 6 &&
        !block.some((line) => postcode.test(line));
        next++
      ) {
        if (stopAddress.test(lines[next]) || /^\d{6,}$/.test(lines[next]))
          break;
        block.push(lines[next]);
      }
      if (!block.length || !block.some((line) => postcode.test(line))) continue;
      const result = block
        .join("\n")
        .replace(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi, "$1 $2");
      // Do not carry account/identity metadata into a suggested address.
      if (
        result.length > 1000 ||
        /\b(?:IBAN|SWIFT|BIC|sort code|account number|licen[cs]e number|passport number|date of birth)\b/i.test(
          result,
        )
      )
        continue;
      return result;
    }
  }
  return null;
}
function addPerson(suggestions, person) {
  if (!person) return;
  for (const path of ["contactName", "saleInfo.signatoryName"])
    suggestions.push({ path, label: DOCUMENT_FIELDS[path].label, ...person });
}
function addAddresses(
  suggestions,
  address,
  { business = false, personalLicence = false, source },
) {
  if (!address) return;
  if (!business) {
    suggestions.push({
      path: "saleInfo.signatoryAddress",
      label: DOCUMENT_FIELDS["saleInfo.signatoryAddress"].label,
      value: address,
      confidence: personalLicence ? "high" : "low",
      source,
      reason: personalLicence
        ? "The licence holder’s home address was recognised. Confirm this person is the authorised signatory."
        : "This is the account holder’s correspondence address. Confirm it is the signatory’s home address before using it.",
    });
    return;
  }
  suggestions.push({
    path: "saleInfo.registeredAddress",
    label: DOCUMENT_FIELDS["saleInfo.registeredAddress"].label,
    value: address,
    confidence: "high",
    source,
    reason:
      "A labelled business address and postcode were recognised. Confirm it is the registered business address.",
  });
  suggestions.push({
    path: "saleInfo.installationAddress",
    label: DOCUMENT_FIELDS["saleInfo.installationAddress"].label,
    value: address,
    confidence: "low",
    source,
    reason:
      "Use this address only if the payment equipment will be installed there.",
  });
}
export function parseDocumentText(text, documentType) {
  if (typeof text !== "string" || text.length > 100000)
    throw new Error("Use recognised text of at most 100,000 characters.");
  const type = typeName(documentType);
  if (!type)
    throw new Error("Choose passport, driving licence or bank statement.");
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(tidy)
    .filter(Boolean);
  const suggestions = [],
    warnings = [];
  if (type === "passport") {
    let person = mrzName(lines);
    if (!person) {
      const surname = personName(
        labelValue(lines, [
          /^(?:surname(?:\(s\))?|family name|last name)\s*[:/-]?\s*(.*)$/i,
        ]) || "",
      );
      const given = personName(
        labelValue(lines, [
          /^(?:given names?(?:\(s\))?|first names?|forenames?)\s*[:/-]?\s*(.*)$/i,
        ]) || "",
      );
      const full = personName(
        labelValue(lines, [/^(?:full name|holder(?:'s)? name)\s*:\s*(.*)$/i]) ||
          "",
      );
      if (surname && given)
        person = {
          value: `${given} ${surname}`,
          confidence: "high",
          source: "Passport name labels",
          reason:
            "Surname and given-name labels were recognised. Review spelling and name order.",
        };
      else if (full)
        person = {
          value: full,
          confidence: "medium",
          source: "Passport holder label",
          reason:
            "A labelled name was recognised. Check it against the passport.",
        };
    }
    addPerson(suggestions, person);
    warnings.push(
      "A recognised name does not verify the passport, identity, or signing authority.",
    );
  } else if (type === "licence") {
    const surname = personName(
      numberedValue(lines, 1) ||
        labelValue(lines, [/^(?:surname|last name)\s*:\s*(.*)$/i]) ||
        "",
    );
    const given = personName(
      numberedValue(lines, 2) ||
        labelValue(lines, [
          /^(?:given names?|first names?|forenames?)\s*:\s*(.*)$/i,
        ]) ||
        "",
    );
    if (surname && given)
      addPerson(suggestions, {
        value: `${given} ${surname}`,
        confidence: "high",
        source: "Driving licence name fields",
        reason:
          "Name fields 1 and 2 were recognised. Confirm spelling and that this person is the contact/signatory.",
      });
    const address = addressFromLabel(lines, [
      /^8(?:[.)]\s*|\s+)(.*)$/,
      /^(?:address|holder(?:'s)? address)\s*:\s*(.*)$/i,
    ]);
    addAddresses(suggestions, address, {
      source: "Driving licence address field",
      personalLicence: true,
    });
    warnings.push(
      "A licence address is suggested only as the signatory’s home address, never as the business or installation address.",
    );
  } else {
    const business = labelValue(lines, [
      /^(?:business account name|company name|registered business name)\s*:\s*(.*)$/i,
    ]);
    const holder =
      business ||
      labelValue(lines, [
        /^(?:account holder(?: name)?|account name|name on (?:the )?account)\s*:\s*(.*)$/i,
      ]);
    const isBusiness = Boolean(
      business || (holder && businessWords.test(holder)),
    );
    if (holder && isBusiness) {
      const value = tidy(holder);
      if (
        value.length >= 3 &&
        value.length <= 300 &&
        /\p{L}/u.test(value) &&
        !/\d{6,}|[<>@=]/.test(value) &&
        !/\b(?:account number|sort code|IBAN|SWIFT)\b/i.test(value)
      )
        suggestions.push({
          path: "saleInfo.registeredName",
          label: DOCUMENT_FIELDS["saleInfo.registeredName"].label,
          value,
          confidence: "high",
          source: "Bank statement business account label",
          reason:
            "A labelled business account name was recognised. Check it matches the registered business.",
        });
    } else {
      const name = personName(holder || "");
      if (name)
        addPerson(suggestions, {
          value: name,
          confidence: "medium",
          source: "Bank statement account-holder label",
          reason:
            "The account holder may differ from the customer contact or signatory. Confirm this person’s role.",
        });
    }
    const businessAddress = addressFromLabel(lines, [
      /^(?:business address|registered (?:business )?address)\s*:\s*(.*)$/i,
    ]);
    const address =
      businessAddress ||
      addressFromLabel(lines, [
        /^(?:account address|correspondence address|address)\s*:\s*(.*)$/i,
      ]);
    addAddresses(suggestions, address, {
      business: Boolean(businessAddress),
      source: businessAddress
        ? "Bank statement business address"
        : "Bank statement correspondence address",
    });
    warnings.push(
      "Bank names, account numbers, sort codes and transaction amounts are not copied into your customer record.",
    );
  }
  if (!suggestions.length)
    warnings.unshift(
      "No clear supported fields were recognised. Try a sharper photo or correct the recognised text.",
    );
  return { suggestions, warnings };
}
/** Build a minimal reviewed patch. Existing records and source text are never mutated or copied. */
export function buildDocumentPatch(suggestions, selectedFields, _deal) {
  if (
    !Array.isArray(suggestions) ||
    !Array.isArray(selectedFields) ||
    selectedFields.length > 10
  )
    throw new Error("Choose fields from the reviewed suggestions.");
  const patch = {};
  for (const path of new Set(selectedFields)) {
    if (!Object.hasOwn(DOCUMENT_FIELDS, path))
      throw new Error("This field cannot be filled from a document.");
    const source = suggestions.find((item) => item?.path === path);
    if (!source || typeof source.value !== "string")
      throw new Error("Choose only recognised fields.");
    const value = source.value.trim();
    if (!value || value.length > DOCUMENT_FIELDS[path].max)
      throw new Error(
        `Check ${DOCUMENT_FIELDS[path].label.toLowerCase()} before applying it.`,
      );
    if (
      ["contactName", "saleInfo.signatoryName"].includes(path) &&
      !personName(value)
    )
      throw new Error("Enter a person’s name for the contact or signatory.");
    if (path.startsWith("saleInfo."))
      (patch.saleInfo ??= {})[path.slice(9)] = value;
    else patch[path] = value;
  }
  return patch;
}
