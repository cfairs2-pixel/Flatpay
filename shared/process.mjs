/** Operational guidance transcribed from the user-supplied Flatpay documents.
 * This checklist records completion; supporting KYC documents stay in the
 * authorised Flatpay CRM rather than this tracker.
 */
export const PROCESS_STEPS = [
  {
    id: "companyVerified",
    label: "Verify the company and signatories",
    description:
      "Check Condukt, using Companies House as a backup. Identify the relevant natural persons, company officers and beneficial owners with more than 25% ownership.",
  },
  {
    id: "contractComplete",
    label: "Complete the contract and agreed pricing",
    description:
      "Check company and contact details, installation address, hardware quantities and upfront prices, Flatpay and Amex rates, expected monthly TPV, surcharge share and maximum transaction amount.",
  },
  {
    id: "contractSigned",
    label: "Collect all required contract signatures",
    description:
      "The training requires the Managing Director(s) to sign; where there is no Managing Director, all relevant directors/officers sign. Complete the agency agreement and Direct Debit instruction where applicable.",
  },
  {
    id: "idVerified",
    label: "Check ID for signatories and owners over 25%",
    description:
      "In the authorised CRM, collect readable, colour, unexpired ID for every signatory and beneficial owner with more than 25% ownership. All corners should be visible with no flash or reflections.",
  },
  {
    id: "addressVerified",
    label: "Check personal proof of address",
    description:
      "Check proof of address for the same people. It must match their ID name, show their personal address and be less than three months old. Suitable ID with the correct address may also serve as proof.",
  },
  {
    id: "bankVerified",
    label: "Check the merchant bank document",
    description:
      "Use a document no more than six months old showing the merchant/account-holder name, bank logo and IBAN. Confirm any additional banking requirements with Operations; do not store bank documents or account numbers in this tracker.",
  },
  {
    id: "highTpvEvidence",
    label: "Confirm high-TPV evidence, if applicable",
    description:
      "For signed annual TPV above £300,000, upload previous-provider evidence to the CRM showing TPV at least 20% above the contracted amount, or the Regional Manager-approved alternative described in training. Mark complete as not applicable below the threshold.",
  },
  {
    id: "acRecorded",
    label: "Record the approval-call link",
    description:
      "After each approval call, retain that offer and its AC link. Copy the received link into the official CRM notes as well.",
  },
  {
    id: "submittedToCrm",
    label: "Submit the complete file to onboarding",
    description:
      "Upload the signed contract, required ID/address checks, bank document and relevant TPV evidence to the authorised CRM. A signed contract with missing KYC is a sale awaiting documents. Resolve Operations send-backs before installation.",
  },
  {
    id: "installationArranged",
    label: "Arrange installation and merchant access",
    description:
      "Wait until the CRM shows the terminal ready for installation. Match its serial number, charge it to at least 55%, connect Wi-Fi and use the CRM installation link. Confirm the merchant can access their usual business email for setup.",
  },
];

export const SALE_FIELDS = [
  {
    key: "companyNumber",
    label: "Company number (if applicable)",
    required: false,
  },
  {
    key: "registeredName",
    label: "Registered company / sole trader name",
    required: true,
  },
  {
    key: "registeredAddress",
    label: "Registered business address",
    required: true,
  },
  { key: "installationAddress", label: "Installation address", required: true },
  { key: "industry", label: "Industry / business activity", required: true },
  { key: "salesManager", label: "Flatpay sales manager", required: true },
  {
    key: "signatoryName",
    label: "Authorised signatory name(s)",
    required: true,
  },

  {
    key: "signatoryAddress",
    label: "Signatory home address",
    type: "text",
    required: false,
  },
  {
    key: "signatureDate",
    label: "Contract signature date",
    required: true,
    type: "date",
  },
  {
    key: "expectedMonthlyTpv",
    label: "Contracted monthly card turnover (£)",
    required: true,
    type: "number",
  },
  {
    key: "maxTransactionAmount",
    label: "Maximum transaction amount (£)",
    required: true,
    type: "number",
  },
  {
    key: "surchargeShare",
    label: "Estimated surcharge share (%)",
    required: false,
    type: "number",
  },
  {
    key: "crmLink",
    label: "Official CRM record link",
    required: false,
    type: "url",
  },
  {
    key: "installationDate",
    label: "Planned installation date",
    required: false,
    type: "date",
  },
];

export const HARDWARE_HELP = {
  terminal:
    "Standalone Flatpay terminal (PAX A920Pro in the supplied contract).",
  posPremium:
    "POS Premium bundle, including one terminal. Training describes a dual-screen setup, 15.5-inch display and built-in printer; the brochure also shows a customer-facing display and cash drawer.",
  posPro:
    "POS Pro bundle, including one terminal. Record standalone terminal quantities separately to avoid double counting.",
  mpos: "MPOS (Terminal), listed separately in the supplied contract.",
  additionalHardware:
    "Contract add-ons: terminal stand, charging station, barcode scanner, extra POS tablet and remote printer. Record quantities and agreed upfront prices in the offer.",
};

export const SOURCE_NOTES = [
  "Flatpay Field Sales University Day 2 Clean: contract/KYC four-step process, document quality and age requirements, high-TPV evidence, meeting outcomes, AC links and installation instructions.",
  "Flatpay Field Sales University Day 3 Clean: five-stage sales conversation (introduction, product, folder, price check, closing), approval calls and commission earning/payout timing.",
  "1 Contract_POS_090726 - Pre Filled: merchant/company/contact fields, contract pricing and hardware options. No prefilled personal information has been imported.",
  "UK_POS_Brochure_160626: product descriptions and offer-sheet reference. Its 0% business/international card claim depends on activating surcharge and transferring the charge to the cardholder; do not assume these volumes are free by default. Product descriptions do not establish commission rates.",
  "The Day 2 bank-document detail slide says BIC/SWIFT is not mandatory, while its recap lists IBAN and BIC. Confirm with Operations rather than treating the recap as a universal requirement.",
  "The Day 3 example shows £200 for 15% of £1,500, which is arithmetically inconsistent. The written 15% rule gives £225; examples do not override the official commission calculator.",
];
