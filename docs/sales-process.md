# Sales process sources

This tracker uses the four documents supplied in the conversation. It records operational customer details, offers, AC links and completion of onboarding steps. It does not collect identity scans, bank statements, personal identity numbers or bank account numbers. Supporting evidence belongs in the authorised Flatpay systems.

## Meeting and approval calls

Day 3 describes five stages: introduction, product demonstration, folder/service explanation, price check, and closing. The price check uses the current provider's statement or portal. The app records charges and transaction values to calculate an effective rate, card mix, and proposed pricing. An AC is an approval call: keep a distinct offer and link for each call, and also copy its link into the official CRM notes (Day 2, page 101).

## Sale and onboarding

Day 2 describes four steps: check Condukt/Companies House; complete and sign the contract; collect ID and proof of address; collect the bank document. Its CRM outcomes distinguish a complete sale from a signed sale awaiting documents. A tracker deal marked Won may therefore still show an incomplete onboarding checklist.

The contract requests registered company and trading information, installation address, contact details, industry, hardware quantities, upfront prices, Flatpay and Amex rates, expected monthly turnover, maximum transaction amount, surcharge share, signatory details and signature date. The training suggests £3,000 as the usual maximum transaction amount, replacing it when a higher expected amount applies; it is not an enforced product ceiling.

For signatories, training says Managing Director(s) sign; where none exists, all relevant directors/officers sign. ID and personal proof of address are required for all signatories and beneficial owners with **more than 25%** ownership. Resolve corporate ownership chains to the relevant natural persons using the official systems. ID must be readable, in colour, unexpired, with all corners visible and no flash/reflection. Separate proof of address should match the ID name, show the person's address, and be less than three months old. Suitable ID displaying the correct address may count as both.

The bank document should be no more than six months old and show account-holder/merchant name, bank logo and IBAN. The detail slide says BIC/SWIFT is not mandatory; the recap lists it. Operations should resolve that inconsistency.

For signed annual TPV **above £300,000**, Day 2 requires previous-provider evidence showing TPV at least **20% higher** than the contracted amount, uploaded to the CRM. It also describes manager-reviewed bank-settlement evidence, or a Regional Manager video review and recorded approval if the merchant refuses to share a copy. The tracker only records that this evidence has been handled.

Submit the complete file to onboarding and resolve Operations send-backs. Installation begins when the CRM shows the terminal ready. Match its serial number, charge it to at least 55%, connect Wi-Fi, use the CRM link and confirm the customer can access their usual business email.

## Hardware

The supplied contract lists standalone terminals, POS Premium and POS Pro bundles (each includes one terminal), and MPOS. Add-ons listed are terminal stand, charging station, barcode scanner, extra POS tablet and remote printer. Agreed quantities and prices must be recorded per offer; the app does not assume a contract rate from prefilled examples.

The brochure's 0% business/international card claim depends on activating surcharge, which transfers the charge to the cardholder. Business, international and Amex card shares may overlap. The app must not add overlapping shares or assume their transactions are free without explicit confirmed pricing and surcharge eligibility.

## Commission source, version and timing

The authenticated [SM Introduction](https://sm-commission.pages.dev/SM_1_Introduction), [Rules](https://sm-commission.pages.dev/SM_2_Rules), [Examples](https://sm-commission.pages.dev/SM_3_Examples) and [Calculator](https://sm-commission.pages.dev/SM_4_Calculator) pages were retrieved on **27 October 2026**. The site labels the scheme **DRAFT v2 · May 2026**, with MPOS launch details still being reorganised. The app incorporates the executable calculator's rates and functions; manual confirmation remains separate. Later changes to that site require a reviewed update here.

### Activation and earned commission

The newer rules override the older Day 3 training's flat £125 activation threshold for current merchants. From **1 July 2026**, all merchants not already installed under the old rule must process **0.5% of declared annual TPV** to activate. The current site calls the old threshold £123; an already activated pre-July merchant stays under the old rule. A date before July alone does not establish activation: the old threshold must already have been met.

Half of matrix commission is earned at activation. The other half is earned when the merchant meets declared annual TPV ÷ 12 across **30 consecutive days**, **within six months of installation**. Both halves pay in the following month. The monthly calculator approximates portfolio attainment using a target-hit percentage; it is not a dated per-merchant payroll ledger.

### Matrix and counting

Terminal, POS and MPOS share one matrix, with floors of **0.49% for Terminal** and **0.89% for POS/MPOS**. Below the floor, matrix commission is zero even with RM approval. Use declared annual TPV, rather than monthly TPV, as the matrix input.

Count **merchant deals, not hardware units**. A merchant buying several units is one commission sale under the selected product. POS Premium/Pro merchant installs feed the monthly POS volume ladder; MPOS has no volume ladder. Mixed hardware does not establish multiple commission entitlements.

The app follows the **executable calculator** for numerical parity. It interpolates rates and TPV using its anchor table, clamps TPV below £48,000 or above £500,000 to the edge values, and rounds matrix commission to whole pounds per merchant. The introduction's displayed matrix extends to £700,000 and shows marginal increments; the executable code does not extrapolate that way. Its presentation examples can also round half-payments differently. These differences are documented rather than silently combined into a new scheme.

The official monthly presets give **On Budget £8,117**, **High Performer £10,622** and **Low Performer £4,204**, gross before tax. The calculator uses average rates and annual TPV, so a scenario can differ from adding individually priced merchants.

### Upfront and bonuses

- **POS Premium/Pro upfront:** 15% of the full upfront amount at £500 or above; **−£100 per merchant** below £500.
- **MPOS upfront:** 15% at £250 or above; **−£100 per merchant** below £250. No POS volume ladder.
- **Payment condition:** the upfront bonus pays only once the customer has paid the invoice in full. An invoiced amount or partial receipt is not enough.
- **POS monthly volume ladder:** 0–1 installs £0; 2 £200; 3 £350; 4 £600; 5 £1,000; 6 £1,500; 7 £2,200; 8 £2,800; 9 £3,300; 10 £3,800; each additional install above ten adds £300.
- **Own-generated sale:** £50.
- **Quick installation:** £50 per install completed within five days of receiving the link.
- **IH quick sale:** £30 per IH sale closed within 24 hours.
- **Amex:** £40 at 3.89%, £20 at 2.99%, £10 at 2.49%, £0 at 1.99%. The trigger is at least £123 Amex TPV in the **first month the merchant actually processes Amex**, not necessarily the first calendar month after installation. Applies once per merchant across Terminal/POS/MPOS; reducing or removing the Amex rate reverses the bonus.
- **Minimum guarantee:** £2,120 gross monthly. In the executable monthly model, this tops up the realised total after the 30-day target adjustment; it is not applied once per merchant.

The source calculator pays bonuses in full regardless of portfolio target-hit percentage and applies the hit adjustment only to the back half of the matrix. Eligibility and actual cash receipt still need to be confirmed. The Day 3 example incorrectly labels £200 as 15% of £1,500; the written percentage gives £225. The newer calculator's upfront thresholds, penalties and rounding govern the app's current model instead of that training example.

### Churn and review

The newer rules define churn as cancellation within the first six months, or usage across the first three months below 15% of expected volume for that period; seasonal businesses are excluded from the low-usage test. Their example uses £200,000 declared annual TPV: expected three-month TPV is £50,000, and actual TPV below £7,500 triggers that test. Churn reverses previously paid matrix halves and bonuses, including upfront, POS volume contribution, Amex, quick install, OG and IH quick sale; unpaid components do not become payable. The clawback affects variable pay in the month churn is registered. Materially overstated declarations may also lead to withheld or reduced commission.

The app's calculator is a planning estimate, not a payroll reconciliation system: it does not automatically discover churn, reconcile cash receipts, or apply discretionary declaration reviews and deductions. Confirm the final paid amounts with the official calculator and manager.

## Source documents

- Flatpay Field Sales University Day 2 Clean.pdf
- Flatpay Field Sales University Day 3 Clean.pdf
- 1 Contract_POS_090726 - Pre Filled.pdf
- UK_POS_Brochure_160626.pdf

- SM commission Introduction, Rules, Examples and Calculator pages — authenticated source, DRAFT v2 / May 2026, retrieved 27 October 2026.
