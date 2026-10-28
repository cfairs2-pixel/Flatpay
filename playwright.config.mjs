import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "flatpay-browser-"));

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    viewport: { width: 1440, height: 1080 },
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `DATA_DIR='${dataDir}' PORT=3101 HOST=127.0.0.1 npm run dev`,
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
