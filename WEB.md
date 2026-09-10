# OneConv web workspace

Connect AI accounts, search their saved conversations, and authorize an assistant
to read them through MCP. The web application uses React and React Aria, an
Effect-backed TypeScript HTTP service, PostgreSQL, and the existing Python provider
adapters. End users interact through their browser.

## Run locally

Install Node 22+, Python 3.11+ and uv, then run these commands from the checkout:

```bash
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4310>. Choose **Open local workspace**, then **Import saved
history** to read the CLI's existing cloud cache. This is a snapshot, not a new
provider login. Import again to pick up subsequent CLI pulls.

Local mode binds to loopback and uses a persistent embedded PostgreSQL database
under `.oneconv`. It is a single-user workspace for this machine. Do not publish
it through a tunnel. The encryption key is stored in a mode-600 local file;
the `.oneconv` directory and `.env` are ignored by Git.

In **Assistant access**, create a scoped access key for selected accounts. Use
the displayed MCP URL and the key as a Bearer credential in an HTTP MCP client.
Keys are shown once and can be revoked. This local URL is not reachable from
Claude or Cowork cloud.

## Hosted deployment

`render.yaml` defines a Docker web service, a separate ingestion worker and a
private PostgreSQL database. `Dockerfile` packages both runtimes. Configure these
operator credentials through the deployment's secret environment, using
1Password as the source of truth:

| Variable | Purpose |
| --- | --- |
| `APP_MODE=hosted` | Disable local sign-in and cache import |
| `PUBLIC_URL` | Public HTTPS origin; Render's external URL is the default |
| `DATABASE_URL` | Shared PostgreSQL database |
| `SESSION_ENCRYPTION_KEY` | Base64-encoded 32-byte key, shared by web and worker |
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY` | AuthKit account sign-in |
| `WORKOS_AUTHKIT_DOMAIN` | HTTPS AuthKit issuer for MCP OAuth |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Isolated hosted login browsers |

Register the public `/auth/callback` URL in WorkOS. Configure MCP authorization
in WorkOS for the resource audience `<PUBLIC_URL>/mcp`, the `conversations:read` scope,
and the intended assistant clients. The service exposes protected-resource
metadata and validates token signature, issuer, audience, expiry and scope.
WorkOS configuration and a complete Claude/Cowork authorization round trip must
be verified before inviting users; creating a deployment alone does not establish
that these external integrations work.

Users sign into OneConv, connect OpenAI or Claude in a hosted browser, complete
the provider's own login, and verify the connection. Browser recording and logging
are disabled. The worker reads ChatGPT/Codex or Claude Chat/Cowork using the
corresponding session. No provider password is submitted to OneConv's forms.

Add the public `/mcp` URL to the assistant. OAuth grants initially cover the
accounts connected at first authorization; later accounts are not silently added.
Advanced Bearer keys support explicit account selection. Revocation applies to
subsequent requests. The MCP exposes listing, search, transcript reading and
connection status; it cannot send messages or execute arbitrary commands.

## Storage and synchronization

Provider sessions are encrypted with AES-256-GCM and bound to their owner and
connection. Conversations and job state live in PostgreSQL with owner checks on
every web and MCP read. Browser contexts remain at Browserbase while connected;
disconnect requests delete that context, its credential and imported history.
If remote deletion fails, the app reports the failure and allows retry.

Jobs have durable leases. Connection generations prevent an old job from
recreating history after disconnection or reconnect. The worker checks for due
accounts every minute and queues a sync when the last sync is older than five
minutes. It runs independently of the user's browser. Session failures require
reconnecting; they do not appear as successful refreshes.

The initial ingestion is bounded to 100 conversations per product/account per
run. Truncation or product errors produce a partial status. Complete historical
backfill and durable pagination checkpoints are not implemented. Web listing
currently returns up to 50 matching conversations. Attachments are not archived.

Service operators can technically decrypt stored content. Encryption at rest is
not end-to-end encryption or a TEE. Training and licensing are disabled for every
account. Billing, consent capture, dataset exports, and confidential compute are
not implemented; see [DATA_POLICY.md](DATA_POLICY.md).

## Verification status

Verified locally: production build, tenant isolation, credential binding, scoped
MCP reads and revocation, stale-job rejection, browser sign-in/import/read flows,
mobile layout, and an actual HTTP MCP SDK client reading imported history.
The Linux ARM64 Docker image builds and runs: its HTTP health endpoint returns
200 and the packaged Python worker completes an empty-cache import. This does
not verify hosted PostgreSQL, provider access or the deployment's CPU platform.

```bash
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Google Chrome by default. Set `PLAYWRIGHT_CHANNEL`
to another installed Playwright-compatible channel when needed.

Not yet verified: public deployment, live AuthKit OAuth,
hosted provider login, and scheduled live ingestion. These require the configured
external services. Existing CLI verification does not substitute for hosted login
verification. No hosted URL is claimed as live.
