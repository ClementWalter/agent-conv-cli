/** Browser acceptance uses an isolated PostgreSQL store and synthetic saved history. */
import { defineConfig } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "oneconv-browser-"));
mkdirSync(join(root, "cache", "account"), { recursive: true });
writeFileSync(
  join(root, "cache", "account", "example.json"),
  JSON.stringify({
    source: "claude-chat",
    session: "browser-example",
    title: "A good place to start",
    account_label: "Personal",
    last: "2026-09-09T08:00:00Z",
    turns: [
      { role: "user", text: "Remember our plans for the garden." },
      { role: "assistant", text: "Let’s start with the olive tree." },
    ],
  }),
);
export default defineConfig({
  testDir: "./web/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4311",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4311/health",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      APP_MODE: "local",
      BROWSERBASE_API_KEY: "",
      PORT: "4311",
      PUBLIC_URL: "http://127.0.0.1:4311",
      LOCAL_DATABASE_DIR: join(root, "db"),
      ONE_CONV_CLOUD_CACHE: join(root, "cache"),
    },
  },
});
