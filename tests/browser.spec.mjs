import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const merchantName = "Browser Test Coffee";
const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const today = ["year", "month", "day"]
  .map((type) => londonParts.find((part) => part.type === type).value)
  .join("-");
const nextMonth = new Date(
  Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1),
)
  .toISOString()
  .slice(0, 7);

test("merchant statement, offers, won prompt, commission, export and persistence work in the browser", async ({
  page,
}) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Demo workspace", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(8);
  await page.screenshot({
    path: test.info().outputPath("desktop-overview.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Add merchant", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Business name", { exact: false }).fill(merchantName);
  await editor
    .getByLabel("Contact person", { exact: true })
    .fill("Morgan Example");
  await editor
    .getByLabel("Contact email", { exact: true })
    .fill("morgan@example.com");
  await editor.getByLabel("Meeting date", { exact: true }).fill(today);

  await editor.getByRole("button", { name: "Statement", exact: true }).click();
  await editor
    .getByLabel("Total transaction value", { exact: false })
    .fill("10000");
  await editor.getByLabel("Total charges", { exact: false }).fill("200");
  await expect(editor.locator(".rate-result strong")).toHaveText("2.00%");
  await editor.getByLabel("Business cards", { exact: false }).fill("2000");
  await editor.getByLabel("International cards", { exact: false }).fill("1000");
  await editor.getByLabel("Amex cards", { exact: false }).fill("500");
  await editor.getByLabel("Current Amex rate", { exact: false }).fill("2.5");
  await expect(editor.locator(".mix-card").nth(0)).toContainText("20.00%");
  await expect(editor.locator(".mix-card").nth(1)).toContainText("10.00%");
  await expect(editor.locator(".mix-card").nth(2)).toContainText("5.00%");

  await editor.getByRole("button", { name: /^AC offers/ }).click();
  await editor.getByRole("button", { name: "Add first offer" }).click();
  let offer = editor.locator(".offer-card").first();
  await offer.getByLabel("Flatpay proposed rate", { exact: false }).fill("1");
  await offer.getByLabel("Proposed Amex rate", { exact: false }).fill("2");
  await offer
    .getByLabel("Approving manager", { exact: true })
    .fill("Test Manager");
  await offer
    .getByLabel("AC link", { exact: true })
    .fill("https://example.com/ac/first");
  await offer.getByLabel("Terminal only", { exact: true }).fill("2");
  await offer.getByLabel("POS Premium", { exact: true }).fill("1");
  await offer
    .getByLabel("Additional hardware", { exact: true })
    .fill("1 receipt printer");
  await expect(offer.locator(".savings-line")).toContainText("£95.00");

  await editor.getByRole("button", { name: "New offer", exact: true }).click();
  await expect(editor.locator(".offer-card")).toHaveCount(2);
  offer = editor.locator(".offer-card").nth(1);
  await offer.getByLabel("Flatpay proposed rate", { exact: false }).fill("0.9");
  await offer
    .getByLabel("AC link", { exact: true })
    .fill("https://example.com/ac/revision");
  await offer.getByLabel("POS Pro", { exact: true }).fill("1");
  await offer.getByLabel("mPOS", { exact: true }).fill("1");
  await editor
    .getByRole("button", { name: "Save merchant", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".workspace-banner")).toContainText(
    "Your workspace",
  );
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText(merchantName);

  await page.reload();
  await page.getByLabel("Search merchants").fill("Browser Test");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: `Open ${merchantName}` }).click();
  await editor.getByRole("button", { name: /^AC offers/ }).click();
  await expect(editor.locator(".offer-card")).toHaveCount(2);
  await expect(
    editor.locator(".offer-card").nth(1).getByLabel("AC link", { exact: true }),
  ).toHaveValue("https://example.com/ac/revision");
  await expect(
    editor
      .locator(".offer-card")
      .first()
      .getByLabel("Terminal only", { exact: true }),
  ).toHaveValue("2");
  await editor.getByRole("button", { name: "Merchant", exact: true }).click();
  await editor
    .getByRole("combobox", { name: "Sales status" })
    .selectOption("Won");
  await expect(
    editor.getByRole("heading", { name: "A win worth getting right." }),
  ).toBeVisible();
  await expect(
    editor.getByLabel("Sale / signature date", { exact: false }),
  ).toHaveValue(today);
  await expect(
    editor.getByRole("heading", { name: "Sale completion checklist" }),
  ).toBeVisible();
  await editor
    .getByLabel("Registered company / sole trader name", { exact: true })
    .fill(merchantName);
  await editor
    .getByLabel("Registered business address", { exact: true })
    .fill("1 Example Road, London");
  await editor
    .getByLabel("Installation address", { exact: true })
    .fill("1 Example Road, London");
  await editor
    .getByLabel("Industry / business activity", { exact: true })
    .fill("Coffee shop");
  await editor
    .getByLabel("Flatpay sales manager", { exact: true })
    .fill("Test Manager");
  await editor
    .getByLabel("Authorised signatory name(s)", { exact: true })
    .fill("Morgan Example");
  await editor
    .getByLabel("Contract signature date", { exact: true })
    .fill(today);
  await editor
    .getByLabel("Contracted monthly card turnover (£)", { exact: true })
    .fill("10000");
  await editor
    .getByLabel("Maximum transaction amount (£)", { exact: true })
    .fill("3000");
  await editor.getByRole("button", { name: "Commission", exact: true }).click();
  await editor
    .getByLabel("Total verified commission", { exact: false })
    .fill("500");
  await editor
    .getByLabel(
      "I have verified this amount with the official calculator or my manager.",
      { exact: true },
    )
    .check();
  await editor
    .getByRole("combobox", { name: "Commission model" })
    .selectOption("pos");
  await editor
    .getByLabel("Declared annual card turnover", { exact: false })
    .fill("100000");
  for (const [label, value] of [
    ["Declared annual card turnover", "120000"],
    ["Full upfront POS price", "1500"],
    ["Transacted since installation", "600"],
    ["Rolling 30-day TPV", "5000"],
  ])
    await editor.getByLabel(label, { exact: false }).fill(value);
  await editor.getByLabel("Own-generated merchant", { exact: false }).check();
  await editor.getByLabel("Quick installation", { exact: false }).check();
  await editor
    .getByLabel("Actual installation date", { exact: false })
    .fill(today);
  await editor
    .getByLabel("Activation threshold reached date", { exact: false })
    .fill(today);
  await editor
    .getByLabel("Flatpay has received the upfront POS payment in full.", {
      exact: true,
    })
    .check();
  await editor
    .getByLabel("Flatpay has received the upfront POS payment in full.", {
      exact: true,
    })
    .uncheck();
  await expect(
    editor
      .locator(".estimate-summary > div")
      .filter({ hasText: "Total official-rule projection" })
      .locator("strong"),
  ).toHaveText("£541.00");
  await expect(
    editor
      .locator(".estimate-summary > div")
      .filter({ hasText: "Eligible by recorded milestones" })
      .locator("strong"),
  ).toHaveText("£208.00");
  await editor
    .getByRole("button", { name: "Save merchant", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Sales won" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Confirmed commission" })
      .locator("strong"),
  ).toHaveText("£500.00");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.demo).toBe(false);
  expect(backup.deals).toHaveLength(1);
  expect(backup.deals[0]).toMatchObject({
    businessName: merchantName,
    commissionAmount: 500,
    commissionConfirmed: true,
    status: "Won",
  });
  expect(backup.deals[0].offers).toHaveLength(2);
  expect(backup.deals[0].commissionDetails).toMatchObject({
    model: "pos",
    annualTpv: 120000,
    ownGenerated: true,
    quickInstall: true,
    upfrontAmount: 1500,
    installedDate: today,
    activationDate: today,
    transactedSinceInstall: 600,
    rolling30DayTpv: 5000,
    paidInFull: false,
  });

  await page
    .locator("nav")
    .getByRole("button", { name: "Commission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Make every sale count." }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toContainText(merchantName);
  await expect(page.locator("tbody tr")).toContainText("£500.00");
  await expect(page.locator(".payout-total")).toHaveText("£0.00");
  await page.getByLabel("Reporting month").fill(nextMonth);
  await expect(page.locator(".payout-total")).toHaveText("£208.00");
  await expect(page.locator(".payout-panel tbody tr")).toHaveCount(3);
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Confirmed commission" })
      .locator("strong"),
  ).toHaveText("£0.00");
  await page.getByLabel("Reporting month").fill(today.slice(0, 7));
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Confirmed commission" })
      .locator("strong"),
  ).toHaveText("£500.00");
  await page.reload();
  await expect(
    page
      .locator(".stat-card")
      .filter({ hasText: "Confirmed commission" })
      .locator("strong"),
  ).toHaveText("£500.00");
  await page.getByRole("button", { name: `Open ${merchantName}` }).click();
  await editor.getByRole("button", { name: "Commission", exact: true }).click();
  await expect(
    editor.getByLabel("Total verified commission", { exact: false }),
  ).toHaveValue("500");
  await expect(
    editor.getByRole("combobox", { name: "Commission model" }),
  ).toHaveValue("pos");
  await expect(
    editor.getByLabel("Declared annual card turnover", { exact: false }),
  ).toHaveValue("120000");
  await expect(
    editor
      .locator(".estimate-summary > div")
      .filter({ hasText: "Total official-rule projection" })
      .locator("strong"),
  ).toHaveText("£541.00");
  await expect(
    editor
      .locator(".estimate-summary > div")
      .filter({ hasText: "Eligible by recorded milestones" })
      .locator("strong"),
  ).toHaveText("£208.00");
  await editor.getByRole("button", { name: "Close merchant" }).click();
  expect(browserErrors).toEqual([]);
});

test("mobile overview and merchant editor fit a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A clearer view of your sales." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile-overview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: /^Sales pipeline/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "From first hello to signed deal." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add merchant", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile-editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close merchant" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Commission", exact: true })
    .click();
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£8,117");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("mobile-commission.png"),
    fullPage: true,
  });
});

test("official monthly scenarios, deductions and guarantee stay separate from merchant records", async ({
  page,
}) => {
  await page.goto("/");
  const before = await (await page.request.get("/api/deals")).json();
  await page
    .locator("nav")
    .getByRole("button", { name: "Commission", exact: true })
    .click();
  const calculator = page.locator(".portfolio-calculator");
  await expect(
    calculator.getByText("DRAFT v2 · May 2026", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£8,117");
  await calculator
    .getByRole("button", { name: "High Performer", exact: true })
    .click();
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£10,622");
  await calculator
    .getByRole("button", { name: "Low Performer", exact: true })
    .click();
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£4,204");
  await calculator
    .getByLabel("Average POS upfront collected", { exact: true })
    .fill("0");
  await expect(
    calculator
      .locator(".portfolio-breakdown > div")
      .filter({ hasText: /^POS upfront/ }),
  ).toContainText("−£300");
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£3,454");
  await calculator
    .getByRole("button", { name: "On Budget", exact: true })
    .click();
  await calculator
    .getByLabel("Portfolio reaching the 30-day TPV target", { exact: true })
    .fill("0");
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£5,599");
  for (const label of [
    "Terminal installations",
    "POS installations",
    "mPOS installations",
    "Quick installations",
    "Own-generated installations",
    "IH quick sales",
    "Amex 3.89% rate sales",
    "Amex 2.99% rate sales",
    "Amex 2.49% rate sales",
  ]) {
    await calculator.getByLabel(label, { exact: true }).fill("0");
  }
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£2,120");
  await expect(page.getByTestId("portfolio-guarantee")).toHaveText("+£2,120");
  await calculator.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByTestId("portfolio-gross")).toHaveText("£8,117");
  const after = await (await page.request.get("/api/deals")).json();
  expect(after).toEqual(before);
  await page.screenshot({
    path: test.info().outputPath("desktop-commission.png"),
    fullPage: true,
  });
});

test("myflatpay saves meeting notes, bundle terms, closing ACs and customer-safe printable proposals", async ({
  page,
}) => {
  const name = "Bundle Notes Test";
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/myflatpay/);
  await page.getByRole("button", { name: "Add merchant", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Business name", { exact: false }).fill(name);
  await editor
    .getByRole("button", { name: "Meeting notes", exact: true })
    .click();
  await editor.getByRole("button", { name: "New note", exact: false }).click();
  await editor
    .getByLabel("Note title", { exact: true })
    .fill("Discovery meeting");
  await editor
    .getByRole("textbox", { name: "Meeting notes", exact: true })
    .fill("INTERNAL ONLY: owner wants to compare costs. Follow up Friday.");
  await editor
    .getByLabel("Agreed actions & next steps")
    .fill("Send a proposal after approval.");
  await editor.getByLabel("Next follow-up date").fill(today);
  await editor.getByRole("button", { name: /^AC offers/ }).click();
  await editor.getByRole("button", { name: "Add first offer" }).click();
  const offer = editor.locator(".offer-card").first();
  await offer.getByLabel("Flatpay proposed rate", { exact: false }).fill("1");
  await offer.getByLabel("AC annual TPV", { exact: false }).fill("120000");
  await offer
    .getByLabel("Current processing rate", { exact: false })
    .fill("1.6");
  await offer
    .getByLabel("Business card surcharge", { exact: false })
    .fill("0.5");
  await offer
    .getByLabel("International card surcharge", { exact: false })
    .fill("1");
  await offer.getByLabel("Surcharge share", { exact: false }).fill("10");
  await offer.getByRole("button", { name: /Use this AC TPV/ }).click();
  await expect(offer.locator(".ac-commission-sync")).toContainText("£120,000");
  await offer
    .getByRole("checkbox", { name: /Bundle deal with multiple/ })
    .check();
  const first = offer.getByRole("region", {
    name: "Bundle business 1",
    exact: true,
  });
  const second = offer.getByRole("region", {
    name: "Bundle business 2",
    exact: true,
  });
  await expect(first.getByLabel("Business name", { exact: true })).toHaveValue(
    name,
  );
  await second
    .getByLabel("Business name", { exact: true })
    .fill("Second Test Business");
  await second.getByLabel("Annual TPV", { exact: false }).fill("240000");
  await second.getByLabel("Current rate", { exact: false }).fill("1.8");
  await second.getByLabel("Rate offered", { exact: false }).fill("0.9");
  await second
    .getByLabel("Business card surcharge", { exact: false })
    .fill("0.4");
  await second
    .getByLabel("International card surcharge", { exact: false })
    .fill("0.8");
  await second.getByLabel("Business card share", { exact: false }).fill("30");
  await second
    .getByLabel("International card share", { exact: false })
    .fill("15");
  await expect(offer.locator(".bundle-summary")).toContainText("£360,000");
  await editor
    .getByRole("button", { name: "Closing deal", exact: true })
    .click();
  await editor
    .getByLabel("Closing base rate (%)", { exact: true })
    .fill("0.85");
  await editor
    .getByLabel("Objection to overcome")
    .fill("The base rate is the concern.");
  await editor
    .getByLabel("Approved concession / incentive")
    .fill("Approved lower base rate.");
  await editor.getByRole("button", { name: /Create closing AC/ }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Record manager approval",
  );
  await editor
    .getByLabel("Closing approval manager", { exact: true })
    .fill("Test Manager");
  await editor
    .getByLabel("Closing approval reference", { exact: true })
    .fill("INTERNAL-APPROVAL-123");
  await editor
    .getByRole("checkbox", { name: /My manager has approved/ })
    .check();
  await editor.getByLabel("Closing base rate (%)", { exact: true }).fill("0.8");
  await expect(
    editor.getByRole("checkbox", { name: /My manager has approved/ }),
  ).not.toBeChecked();
  await editor
    .getByRole("checkbox", { name: /My manager has approved/ })
    .check();
  await editor.getByRole("button", { name: /Create closing AC/ }).click();
  await expect(editor.locator(".offer-card")).toHaveCount(2);
  await expect(
    editor
      .locator(".offer-card")
      .last()
      .getByRole("region", { name: "Bundle business 2", exact: true })
      .getByLabel("Rate offered", { exact: false }),
  ).toHaveValue("0.8");
  await editor
    .getByRole("button", { name: "Offer sheet", exact: true })
    .click();
  await editor.getByLabel("Prepared by", { exact: true }).fill("Charlie");
  await editor
    .getByLabel("Personal message", { exact: true })
    .fill(
      'CUSTOMER MESSAGE: Here is your proposal. <script>alert("x")</script>',
    );
  await editor
    .getByLabel("Your contact details for the customer")
    .fill("charlie@example.com");
  await expect(editor.locator(".proposal-big-rate")).toContainText(
    "Rates by business",
  );
  const popupPromise = page.waitForEvent("popup");
  await editor
    .getByRole("button", { name: "Open printable offer", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { name: "A simpler way to get paid." }),
  ).toBeVisible();
  await expect(popup.locator("body")).toContainText("Second Test Business");
  await expect(popup.locator("body")).toContainText("CUSTOMER MESSAGE");
  await expect(popup.locator("body")).not.toContainText("INTERNAL ONLY");
  await expect(popup.locator("body")).not.toContainText("INTERNAL-APPROVAL");
  await expect(popup.locator("script")).toHaveCount(0);
  await expect(popup.locator("body")).toContainText("0.80%");
  await popup.screenshot({
    path: test.info().outputPath("customer-offer.png"),
    fullPage: true,
  });
  await popup.close();
  await editor
    .getByRole("button", { name: "Save merchant", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await page
    .locator("nav")
    .getByRole("button", { name: "Meeting notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Discovery meeting/ }),
  ).toContainText(name);
  await page.getByRole("button", { name: /Discovery meeting/ }).click();
  await expect(
    editor.getByRole("textbox", { name: "Meeting notes", exact: true }),
  ).toHaveValue(/INTERNAL ONLY/);
  await editor.getByRole("button", { name: "Close merchant" }).click();
  const saved = (await (await page.request.get("/api/deals")).json()).find(
    (d) => d.businessName === name,
  );
  expect(saved.offers).toHaveLength(2);
  expect(saved.offers[0].businesses[1].offeredRate).toBe(0.9);
  expect(saved.offers[1].businesses[1].offeredRate).toBe(0.8);
  expect(saved.offers[1].businesses[1].businessShare).toBe(30);
  expect(saved.commissionDetails.annualTpv).toBe(120000);
  expect(saved.status).toBe("Lead");
  expect(errors).toEqual([]);
});

test("assistant tracks records, saves preferences and applies reviewed drafts on desktop and mobile", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .locator("nav")
    .getByRole("button", { name: "Sales assistant", exact: true })
    .click();
  await expect(
    page.getByText("Local sales assistant", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "How am I tracking this month?", exact: true })
    .click();
  await expect(page.locator(".assistant-message.from-assistant")).toContainText(
    "manually confirmed commission",
  );
  await page.getByText("Edit monthly targets", { exact: false }).click();
  await page.getByLabel("Monthly sales target", { exact: true }).fill("10");
  await page
    .getByLabel("Monthly commission target (£)", { exact: true })
    .fill("2000");
  await page.getByRole("button", { name: "Save targets", exact: true }).click();
  await page
    .getByRole("button", { name: "Assistant settings and memory", exact: true })
    .click();
  await page
    .getByLabel("Remember a preference")
    .fill("Keep follow-ups formal.");
  await page
    .getByRole("button", { name: "Remember preference", exact: true })
    .click();
  await expect(page.locator(".assistant-preferences")).toContainText(
    "Keep follow-ups formal.",
  );
  await page
    .getByLabel("Assistant merchant", { exact: true })
    .selectOption({ label: "Bundle Notes Test" });
  await page
    .locator(".assistant-context")
    .getByRole("button", { name: /Meeting notes/ })
    .click();
  await page
    .getByLabel("Notes to work with")
    .fill("Owner wants a statement review. Agreed a call on Friday.");
  await page
    .getByLabel("Message the sales assistant")
    .fill("Summarise my meeting notes and draft a follow-up.");
  await page.getByRole("button", { name: "Send assistant message" }).click();
  await expect(page.locator(".assistant-action")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Add to merchant", exact: true })
    .first()
    .click();
  await expect(
    page
      .locator(".assistant-action")
      .first()
      .getByRole("button", { name: "Added", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open merchant", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Meeting notes", exact: true })
      .first(),
  ).toHaveValue(/Owner wants a statement review/);
  await page.getByRole("button", { name: "Close merchant" }).click();
  await page.screenshot({
    path: test.info().outputPath("assistant-desktop.png"),
    fullPage: true,
  });
  await page.reload();
  await page
    .locator("nav")
    .getByRole("button", { name: "Sales assistant", exact: true })
    .click();
  await expect(page.locator(".assistant-message.from-assistant")).toHaveCount(
    2,
  );
  await page
    .getByRole("button", { name: "Assistant settings and memory", exact: true })
    .click();
  await expect(page.locator(".assistant-preferences")).toContainText(
    "Keep follow-ups formal.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("assistant-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
