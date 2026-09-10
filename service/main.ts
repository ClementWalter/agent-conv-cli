/** Start the same production bundle locally or as separate hosted web and worker processes. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { openStore } from "./store";
import { loadKey } from "./security";
import { tick } from "./worker";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const local = process.env.APP_MODE !== "hosted";
const port = Number(process.env.PORT || 4310);
const origin =
  process.env.PUBLIC_URL ||
  (!local ? process.env.RENDER_EXTERNAL_URL : undefined) ||
  `http://127.0.0.1:${port}`;
if (local && !["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw new Error("Local mode only supports loopback URLs");
if (!local && (!origin.startsWith("https://") || !process.env.DATABASE_URL))
  throw new Error("Hosted mode requires HTTPS PUBLIC_URL and DATABASE_URL");
const store = await openStore(
  process.env.DATABASE_URL,
  process.env.LOCAL_DATABASE_DIR,
);
const key = await loadKey(local);
const app = createApp(store, {
  local,
  origin,
  key,
  workosId: process.env.WORKOS_CLIENT_ID,
  workosKey: process.env.WORKOS_API_KEY,
  issuer: process.env.WORKOS_AUTHKIT_DOMAIN?.replace(/\/$/, ""),
  browserReady: Boolean(process.env.BROWSERBASE_API_KEY),
});
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.get("*", serveStatic({ root: "./dist/public" }));
app.get("*", serveStatic({ path: "./dist/public/index.html" }));
const worker = local || process.env.WORKER_ONLY === "true";
let stop = false;
if (worker)
  void (async () => {
    let lastSchedule = 0;
    while (!stop) {
      try {
        if (Date.now() - lastSchedule > 60000) {
          const due = await store.query(
            "SELECT id,user_id FROM connections WHERE credentials IS NOT NULL AND status IN ('ready','partial') AND last_sync<$1",
            [Date.now() - 300000],
          );
          for (const account of due)
            await store.enqueue(account.user_id, account.id);
          lastSchedule = Date.now();
        }
        await tick(store, key);
      } catch {
        await Effect.runPromise(
          Effect.logWarning("Worker iteration failed; retrying."),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  })();
if (process.env.WORKER_ONLY !== "true") {
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: local ? "127.0.0.1" : "0.0.0.0",
  });
  await Effect.runPromise(Effect.logInfo(`OneConv listening at ${origin}`));
  process.on("SIGTERM", () => {
    stop = true;
    server.close();
  });
}
process.on("SIGINT", () => {
  stop = true;
  process.exit(0);
});
