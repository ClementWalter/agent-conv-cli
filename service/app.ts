/** Single-origin web and MCP API with explicit identity, source ownership and revocation. */
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Store } from "./store";
import { encrypt, token, hash } from "./security";
import { mcpResponse, cleanTurns } from "./mcp";
import {
  startLogin,
  finishLogin,
  releaseLogin,
  deleteContext,
  loginView,
} from "./browser";
import { runPython, persistDocuments } from "./worker";

export type Config = {
  local: boolean;
  origin: string;
  key: Buffer;
  workosId?: string;
  workosKey?: string;
  issuer?: string;
  browserReady: boolean;
};
class Failure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const idSchema = Schema.Struct({ id: Schema.String });
export function createApp(store: Store, config: Config) {
  const app = new Hono();
  const wrap = (fn: (c: Context) => Promise<Response>) => (c: Context) =>
    Effect.runPromise(
      Effect.tryPromise({
        try: () => fn(c),
        catch: (error) =>
          error instanceof Failure
            ? error
            : new Failure(500, "Something went wrong. Please retry."),
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(c.json({ error: error.message }, error.status as any)),
        ),
      ),
    );
  const body = async <A>(c: Context, schema: Schema.Schema<A, any>) => {
    try {
      return Schema.decodeUnknownSync(schema)(await c.req.json());
    } catch {
      throw new Failure(400, "Check the submitted fields and try again.");
    }
  };
  async function user(c: Context) {
    const session = getCookie(c, "oneconv_session");
    if (!session) throw new Failure(401, "Sign in to continue.");
    const row = (
      await store.query(
        "SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=$1 AND sessions.expires>$2",
        [hash(session), Date.now()],
      )
    )[0];
    if (!row) throw new Failure(401, "Your session expired. Sign in again.");
    return row;
  }
  async function signedIn(c: Context, id: string) {
    const secret = token();
    await store.query(
      "INSERT INTO sessions(hash,user_id,expires) VALUES($1,$2,$3)",
      [hash(secret), id, Date.now() + 86400000 * 7],
    );
    setCookie(c, "oneconv_session", secret, {
      httpOnly: true,
      secure: !config.local,
      sameSite: "Lax",
      path: "/",
      maxAge: 86400 * 7,
    });
  }
  app.use("*", async (c, next) => {
    if (c.req.header("host") !== new URL(config.origin).host)
      return c.json({ error: "Unrecognized host" }, 403);
    const origin = c.req.header("origin");
    if (origin && origin !== config.origin)
      return c.json({ error: "Unrecognized origin" }, 403);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
      c.req.path !== "/mcp" &&
      origin !== config.origin
    )
      return c.json({ error: "Same-origin request required" }, 403);
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://www.browserbase.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (!config.local)
      c.header("Strict-Transport-Security", "max-age=31536000");
  });
  app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/api/config", (c) =>
    c.json({
      mode: config.local ? "local" : "hosted",
      loginReady: Boolean(config.workosId && config.workosKey),
      browserReady: config.browserReady,
      mcpUrl: `${config.origin}/mcp`,
    }),
  );
  app.post(
    "/api/local-login",
    wrap(async (c) => {
      if (!config.local) throw new Failure(404, "Not found");
      await store.query(
        "INSERT INTO users(id,email,name) VALUES('local','local@oneconv.invalid','Your workspace') ON CONFLICT DO NOTHING",
      );
      await signedIn(c, "local");
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/auth/login",
    wrap(async (c) => {
      if (!config.workosId || !config.workosKey)
        throw new Failure(
          503,
          "Account sign-in is not configured on this installation.",
        );
      const state = token();
      await store.query("INSERT INTO flows(hash,expires) VALUES($1,$2)", [
        hash(state),
        Date.now() + 600000,
      ]);
      setCookie(c, "oneconv_flow", state, {
        httpOnly: true,
        sameSite: "Lax",
        secure: !config.local,
        path: "/auth",
        maxAge: 600,
      });
      const url = new URL("https://api.workos.com/user_management/authorize");
      url.search = new URLSearchParams({
        client_id: config.workosId,
        provider: "authkit",
        response_type: "code",
        redirect_uri: `${config.origin}/auth/callback`,
        state,
      }).toString();
      return c.redirect(url.toString());
    }),
  );
  app.get(
    "/auth/callback",
    wrap(async (c) => {
      const state = c.req.query("state"),
        code = c.req.query("code");
      if (!state || state !== getCookie(c, "oneconv_flow") || !code)
        throw new Failure(
          400,
          "Login could not be verified. Please start again.",
        );
      const consumed = await store.query(
        "DELETE FROM flows WHERE hash=$1 AND expires>$2 RETURNING hash",
        [hash(state), Date.now()],
      );
      deleteCookie(c, "oneconv_flow", { path: "/auth" });
      if (!consumed.length)
        throw new Failure(400, "Login expired. Please start again.");
      const response = await fetch(
        "https://api.workos.com/user_management/authenticate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: config.workosId,
            client_secret: config.workosKey,
            grant_type: "authorization_code",
            code,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok)
        throw new Failure(401, "Sign-in failed. Please try again.");
      const identity = ((await response.json()) as any).user;
      if (!identity?.id || !identity.email_verified)
        throw new Failure(401, "Verify your email before continuing.");
      await store.query(
        "INSERT INTO users(id,email,name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name",
        [
          identity.id,
          identity.email,
          identity.first_name || identity.email.split("@")[0],
        ],
      );
      await signedIn(c, identity.id);
      return c.redirect("/");
    }),
  );
  app.post(
    "/api/logout",
    wrap(async (c) => {
      await store.query("DELETE FROM sessions WHERE hash=$1", [
        hash(getCookie(c, "oneconv_session") || ""),
      ]);
      deleteCookie(c, "oneconv_session", { path: "/" });
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/me",
    wrap(async (c) => c.json(await user(c))),
  );
  app.get(
    "/api/connections",
    wrap(async (c) => c.json(await store.connections((await user(c)).id))),
  );
  app.post(
    "/api/connections",
    wrap(async (c) => {
      const owner = await user(c),
        input = await body(
          c,
          Schema.Struct({ provider: Schema.Literal("openai", "claude") }),
        );
      if (!config.browserReady)
        throw new Failure(
          503,
          "Hosted login is not available yet. The operator needs to configure the browser service.",
        );
      const active = await store.query(
        "SELECT id FROM connections WHERE user_id=$1 AND status='authorizing'",
        [owner.id],
      );
      if (active.length >= 2)
        throw new Failure(
          409,
          "Finish or remove an existing login before starting another.",
        );
      const browser = await startLogin(input.provider);
      const id = randomUUID();
      await store.query(
        `INSERT INTO connections(id,user_id,provider,label,status,context_id,browser_id,live_url,created)
      VALUES($1,$2,$3,$4,'authorizing',$5,$6,$7,$8)`,
        [
          id,
          owner.id,
          input.provider,
          input.provider === "openai" ? "OpenAI account" : "Claude account",
          browser.context,
          browser.id,
          browser.url,
          Date.now(),
        ],
      );
      return c.json({ id, url: browser.url });
    }),
  );
  app.get(
    "/api/connections/:id/live",
    wrap(async (c) => {
      const owner = await user(c);
      const connection = (
        await store.query(
          "SELECT browser_id,status FROM connections WHERE user_id=$1 AND id=$2",
          [owner.id, c.req.param("id")],
        )
      )[0];
      if (!connection?.browser_id || connection.status !== "authorizing")
        throw new Failure(404, "Active login not found.");
      return c.json(await loginView(connection.browser_id));
    }),
  );
  app.post(
    "/api/connections/:id/verify",
    wrap(async (c) => {
      const owner = await user(c),
        connection = (
          await store.query(
            "SELECT * FROM connections WHERE user_id=$1 AND id=$2",
            [owner.id, c.req.param("id")],
          )
        )[0];
      if (!connection || !connection.browser_id)
        throw new Failure(404, "Login not found.");
      let credentials;
      try {
        credentials = await finishLogin(
          connection.provider,
          connection.browser_id,
        );
      } catch {
        throw new Failure(
          409,
          "We could not verify this login yet. Finish signing in, or start a new login if the window expired.",
        );
      }
      const identity = credentials.identity;
      const label =
        connection.provider === "openai"
          ? identity.user?.email || identity.account.id
          : identity.map((x: any) => x.name).join(", ");
      await store.query(
        "UPDATE connections SET credentials=$1,label=$2,status='pending',detail='Connected. Preparing your first sync…',live_url=NULL WHERE id=$3 AND user_id=$4",
        [
          encrypt(credentials, config.key, `${owner.id}:${connection.id}`),
          label,
          connection.id,
          owner.id,
        ],
      );
      await store.enqueue(owner.id, connection.id);
      await releaseLogin(connection.browser_id).catch(() => {});
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/connections/:id/login",
    wrap(async (c) => {
      const owner = await user(c),
        connection = (
          await store.query(
            "SELECT * FROM connections WHERE user_id=$1 AND id=$2",
            [owner.id, c.req.param("id")],
          )
        )[0];
      if (!connection || !["openai", "claude"].includes(connection.provider))
        throw new Failure(404, "Account not found.");
      if (!config.browserReady)
        throw new Failure(503, "The hosted browser service is not configured.");
      if (
        connection.status === "authorizing" &&
        connection.live_url &&
        Date.now() - Number(connection.created) < 840000
      )
        return c.json({ id: connection.id, url: connection.live_url });
      const browser = await startLogin(
        connection.provider,
        connection.context_id,
      );
      await store.query(
        "UPDATE connections SET generation=generation+1,credentials=NULL,status='authorizing',browser_id=$1,live_url=$2,context_id=$3,created=$4 WHERE id=$5 AND user_id=$6",
        [
          browser.id,
          browser.url,
          browser.context,
          Date.now(),
          connection.id,
          owner.id,
        ],
      );
      return c.json({ id: connection.id, url: browser.url });
    }),
  );
  app.post(
    "/api/connections/:id/sync",
    wrap(async (c) => {
      const result = await store.enqueue(
        (await user(c)).id,
        c.req.param("id")!,
      );
      if (!result.length)
        throw new Failure(
          409,
          "A sync is already running, or this account needs reconnecting.",
        );
      return c.json({ queued: true });
    }),
  );
  app.delete(
    "/api/connections/:id",
    wrap(async (c) => {
      const owner = await user(c),
        id = c.req.param("id");
      const connection = (
        await store.query(
          "SELECT * FROM connections WHERE user_id=$1 AND id=$2",
          [owner.id, id],
        )
      )[0];
      if (connection?.context_id) {
        await store.query(
          "UPDATE connections SET generation=generation+1,credentials=NULL,status='disconnecting',detail='Removing stored browser session…' WHERE id=$1 AND user_id=$2",
          [id, owner.id],
        );
        if (connection.browser_id)
          await releaseLogin(connection.browser_id).catch(() => {});
        try {
          await deleteContext(connection.context_id);
        } catch {
          throw new Failure(
            503,
            "Sync is stopped. Browser-session deletion failed; retry removing this account.",
          );
        }
      }
      await store.query("DELETE FROM connections WHERE user_id=$1 AND id=$2", [
        owner.id,
        id,
      ]);
      await store.query(
        "UPDATE grants SET account_ids=account_ids-$1::text WHERE user_id=$2",
        [id, owner.id],
      );
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/api/import-local",
    wrap(async (c) => {
      if (!config.local) throw new Failure(404, "Not found");
      const owner = await user(c),
        documents = await runPython({ action: "import-cache" });
      const id = "local-saved-history";
      await store.query(
        "INSERT INTO connections(id,user_id,provider,label,status,created) VALUES($1,$2,'import','Saved cloud history','ready',$3) ON CONFLICT DO NOTHING",
        [id, owner.id, Date.now()],
      );
      const connection = (
        await store.query(
          "SELECT * FROM connections WHERE id=$1 AND user_id=$2",
          [id, owner.id],
        )
      )[0];
      await persistDocuments(store, connection, documents.documents);
      await store.query(
        "UPDATE connections SET last_sync=$1,detail='Imported snapshot from this Mac. No provider login or live refresh.' WHERE id=$2",
        [Date.now(), id],
      );
      return c.json({ count: documents.documents.length });
    }),
  );
  app.get(
    "/api/conversations",
    wrap(async (c) =>
      c.json(
        await store.list(
          (await user(c)).id,
          (c.req.query("q") || "").slice(0, 500),
        ),
      ),
    ),
  );
  app.get(
    "/api/conversations/:id",
    wrap(async (c) => {
      const row = await store.conversation(
        (await user(c)).id,
        c.req.param("id")!,
      );
      if (!row) throw new Failure(404, "Conversation not found.");
      return c.json({
        ...row,
        document: {
          ...row.document,
          turns: cleanTurns(row.document.turns || []),
        },
      });
    }),
  );
  app.get(
    "/api/grants",
    wrap(async (c) =>
      c.json(
        await store.query(
          "SELECT id,label,account_ids,active,created,last_used FROM grants WHERE user_id=$1 ORDER BY created DESC",
          [(await user(c)).id],
        ),
      ),
    ),
  );
  app.post(
    "/api/grants",
    wrap(async (c) => {
      const owner = await user(c),
        input = await body(
          c,
          Schema.Struct({
            label: Schema.String,
            accounts: Schema.Array(Schema.String),
          }),
        );
      const valid = (await store.connections(owner.id)).map((row) => row.id);
      if (
        !input.accounts.length ||
        input.accounts.some((id) => !valid.includes(id))
      )
        throw new Failure(
          400,
          "Select at least one of your connected accounts.",
        );
      const id = randomUUID(),
        secret = token();
      await store.query(
        "INSERT INTO grants(id,user_id,client_id,label,token_hash,account_ids,created) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          owner.id,
          `key:${id}`,
          input.label.slice(0, 100) || "Personal client",
          hash(secret),
          JSON.stringify(input.accounts),
          Date.now(),
        ],
      );
      return c.json({ token: secret });
    }),
  );
  app.delete(
    "/api/grants/:id",
    wrap(async (c) => {
      await store.query(
        "UPDATE grants SET active=false WHERE id=$1 AND user_id=$2",
        [c.req.param("id"), (await user(c)).id],
      );
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/api/privacy",
    wrap(async (c) => {
      const owner = await user(c);
      return c.json({
        training: false,
        licensing: false,
        enabled: false,
        plan: owner.plan,
      });
    }),
  );
  const metadata = () => ({
    resource: `${config.origin}/mcp`,
    authorization_servers: config.issuer ? [config.issuer] : [],
    scopes_supported: ["conversations:read"],
    bearer_methods_supported: ["header"],
  });
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(metadata()));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) =>
    c.json(metadata()),
  );
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
  app.all(
    "/mcp",
    wrap(async (c) => {
      const bearer = c.req
        .header("authorization")
        ?.match(/^Bearer (.+)$/i)?.[1];
      const deny = () => {
        c.header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", scope="conversations:read"`,
        );
        return c.json(
          { error: "Authorize OneConv to read your selected accounts." },
          401,
        );
      };
      if (!bearer) return deny();
      let grant = (
        await store.query(
          "SELECT * FROM grants WHERE token_hash=$1 AND active=true",
          [hash(bearer)],
        )
      )[0];
      if (!grant && config.issuer) {
        try {
          if (!jwks) {
            const meta = (await (
              await fetch(`${config.issuer}/.well-known/openid-configuration`, {
                signal: AbortSignal.timeout(10000),
              })
            ).json()) as any;
            if (
              meta.issuer !== config.issuer ||
              !String(meta.jwks_uri).startsWith("https://")
            )
              return deny();
            jwks = createRemoteJWKSet(new URL(meta.jwks_uri));
          }
          const { payload } = await jwtVerify(bearer, jwks, {
            issuer: config.issuer,
            audience: `${config.origin}/mcp`,
            algorithms: ["RS256", "ES256"],
          });
          if (
            !payload.sub ||
            !payload.exp ||
            !String(payload.scope || "")
              .split(" ")
              .includes("conversations:read")
          )
            return deny();
          const client = String(payload.client_id || payload.azp || "");
          if (
            !client ||
            !(
              await store.query("SELECT id FROM users WHERE id=$1", [
                payload.sub,
              ])
            ).length
          )
            return deny();
          const ids = (await store.connections(payload.sub)).map(
            (row) => row.id,
          );
          await store.query(
            `INSERT INTO grants(id,user_id,client_id,label,account_ids,created) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,client_id) DO NOTHING`,
            [
              randomUUID(),
              payload.sub,
              client,
              "Connected assistant",
              JSON.stringify(ids),
              Date.now(),
            ],
          );
          grant = (
            await store.query(
              "SELECT * FROM grants WHERE user_id=$1 AND client_id=$2 AND active=true",
              [payload.sub, client],
            )
          )[0];
        } catch {
          return deny();
        }
      }
      if (!grant) return deny();
      await store.query("UPDATE grants SET last_used=$1 WHERE id=$2", [
        Date.now(),
        grant.id,
      ]);
      return mcpResponse(c.req.raw, store, grant.user_id, grant.account_ids);
    }),
  );
  return app;
}
