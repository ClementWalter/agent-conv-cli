/** HTTP and MCP isolation checks exercise real routes and PostgreSQL semantics. */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { Store } from "./store";
import { createApp } from "./app";
import { hash, encrypt, decrypt } from "./security";
import { cleanTurns } from "./mcp";
import { persistDocuments } from "./worker";

const key = Buffer.alloc(32, 7);
describe("credential boundaries", () => {
  it("round trips a session for its owner", () => {
    expect(
      decrypt(
        encrypt({ cookie: "secret" }, key, "alice:source"),
        key,
        "alice:source",
      ),
    ).toEqual({ cookie: "secret" });
  });
  it("rejects a different owner", () => {
    expect(() =>
      decrypt(
        encrypt({ cookie: "secret" }, key, "alice:source"),
        key,
        "bob:source",
      ),
    ).toThrow();
  });
  it("omits tool content from a transcript", () => {
    expect(
      cleanTurns([
        {
          role: "assistant",
          content_blocks: [
            { type: "text", text: "Answer" },
            { type: "tool_use", input: "private" },
          ],
        },
      ]),
    ).toEqual([{ role: "assistant", ts: undefined, text: "Answer" }]);
  });
});

describe("tenant-scoped service", () => {
  let store: Store, app: ReturnType<typeof createApp>;
  const headers = {
    host: "127.0.0.1:4310",
    origin: "http://127.0.0.1:4310",
    "content-type": "application/json",
    cookie: "oneconv_session=alice-session",
  };
  beforeAll(async () => {
    store = new Store(new PGlite());
    await store.migrate();
    await store.query(
      "INSERT INTO users(id,email,name) VALUES('alice','alice@example.test','Alice'),('bob','bob@example.test','Bob')",
    );
    await store.query(
      "INSERT INTO sessions(hash,user_id,expires) VALUES($1,$2,$3)",
      [hash("alice-session"), "alice", Date.now() + 60000],
    );
    await store.query(
      "INSERT INTO connections(id,user_id,provider,label,status,created) VALUES('a','alice','claude','Alice','ready',1),('b','bob','claude','Bob','ready',1)",
    );
    await persistDocuments(store, { id: "a", generation: 0 }, [
      {
        session: "shared-native-id",
        source: "claude-chat",
        title: "Alice secret",
        turns: [{ role: "user", text: "Alice content" }],
      },
    ]);
    await persistDocuments(store, { id: "b", generation: 0 }, [
      {
        session: "shared-native-id",
        source: "claude-chat",
        title: "Bob secret",
        turns: [{ role: "user", text: "Bob content" }],
      },
    ]);
    await store.query(
      "INSERT INTO grants(id,user_id,client_id,label,token_hash,account_ids,created) VALUES($1,$2,$3,$4,$5,$6,$7)",
      ["test-grant", "alice", "client", "Test", hash("read-token"), '["a"]', 1],
    );
    app = createApp(store, {
      local: true,
      origin: "http://127.0.0.1:4310",
      key,
      browserReady: false,
    });
  }, 20000);
  afterAll(async () => {
    await store.close();
  });
  it("requires authentication for history", async () => {
    expect(
      (
        await app.request("/api/conversations", {
          headers: { host: headers.host },
        })
      ).status,
    ).toBe(401);
  });
  it("lists only the authenticated owner", async () => {
    const response = await app.request("/api/conversations", { headers });
    expect(((await response.json()) as any[]).map((row) => row.title)).toEqual([
      "Alice secret",
    ]);
  });
  it("rejects a foreign conversation identifier", async () => {
    const foreign = (await store.list("bob"))[0];
    expect(
      (await app.request(`/api/conversations/${foreign.id}`, { headers }))
        .status,
    ).toBe(404);
  });
  it("rejects cross-origin mutations", async () => {
    expect(
      (
        await app.request("/api/logout", {
          method: "POST",
          headers: { ...headers, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });
  it("rejects unknown hosts", async () => {
    expect(
      (await app.request("/health", { headers: { host: "evil.example" } }))
        .status,
    ).toBe(403);
  });
  it("does not fake a provider login", async () => {
    expect(
      (
        await app.request("/api/connections", {
          method: "POST",
          headers,
          body: '{"provider":"claude"}',
        })
      ).status,
    ).toBe(503);
  });
  it("rejects access keys scoped to another owner", async () => {
    expect(
      (
        await app.request("/api/grants", {
          method: "POST",
          headers,
          body: '{"label":"bad","accounts":["b"]}',
        })
      ).status,
    ).toBe(400);
  });
  it("requires bearer authentication for MCP even with a web cookie", async () => {
    expect(
      (await app.request("/mcp", { method: "POST", headers, body: "{}" }))
        .status,
    ).toBe(401);
  });
  it("serves an authenticated MCP tool call", async () => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        ...headers,
        authorization: "Bearer read-token",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_conversations", arguments: {} },
      }),
    });
    const body = (await response.json()) as any;
    expect(
      JSON.parse(body.result.content[0].text).data.map((row: any) => row.title),
    ).toEqual(["Alice secret"]);
  });
  it("revocation blocks the next MCP call", async () => {
    await app.request("/api/grants/test-grant", { method: "DELETE", headers });
    expect(
      (
        await app.request("/mcp", {
          method: "POST",
          headers: { ...headers, authorization: "Bearer read-token" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
  it("a stale job cannot overwrite a reconnected source", async () => {
    await store.query("UPDATE connections SET generation=1 WHERE id=$1", ["a"]);
    await persistDocuments(store, { id: "a", generation: 0 }, [
      {
        session: "stale",
        source: "claude-chat",
        title: "Stale job",
        turns: [],
      },
    ]);
    expect((await store.list("alice")).map((row) => row.title)).toEqual([
      "Alice secret",
    ]);
  });
  it("deleting a source removes its indexed history", async () => {
    await app.request("/api/connections/a", { method: "DELETE", headers });
    expect(await store.list("alice")).toEqual([]);
  });
});
