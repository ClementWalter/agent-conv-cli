# One-conv cloud delivery plan

Planning baseline: 2026-09-08. This document assigns implementation work; it does
not claim those features are implemented or deployed.

## Product and scope

Let a user retrieve and reuse their AI conversations from their existing
assistant through an authenticated, hosted one-conv MCP service.

Target sources: ChatGPT, Claude Chat, Cowork cloud, Codex cloud. Keep provider,
product, account and workspace distinct. The same assistant can consume the
MCP without being connected as a history source.

Deliver a browser-only web application, cloud ingestion and storage, search,
conversation reading, and hosted MCP. User setup never requires a Terminal,
copied token, local cookie database, desktop companion or personal Box.
Local readers remain supported by the existing CLI but are outside this release.
Autonomous workers, general service credentials, model hosting and a new chat
interface are outside scope. No collective model training from customer content.

## Current evidence and access gates

The CLI currently reads Claude Code, Codex, Cursor and Oh My Pi local stores,
a normalized corpus, and ChatGPT through a local Chromium session. Its handles
are filesystem-oriented; its ChatGPT transport is not hosted user onboarding.
The OneBrain MCP is local stdio with OS-user permissions and subprocess tools;
it is not a multi-user cloud server. Reuse parsing and validation ideas, not
those authentication or execution assumptions.

| Source | Documented route | Work required before claiming live support |
| --- | --- | --- |
| ChatGPT | Individual export; eligible Enterprise/Edu compliance access | Prove hosted consumer login, list/read, renewal and incremental reads; decouple existing private transport from local cookies |
| Claude Chat | Individual and organization exports; eligible compliance access | Implement export parser; prove hosted consumer account access independently |
| Cowork cloud | Eligible compliance API includes remote-session transcripts | Prove consumer access and export coverage; establish native session/message identity |
| Codex cloud | Compliance documentation includes cloud usage | Prove full transcript retrieval, not just usage events; establish consumer access and export coverage |

No public consumer OAuth history API was established by this investigation.
This is an unresolved access boundary, not proof that private integrations are
impossible. Enterprise compliance is a separate eligible-account track, not a
silent replacement for the consumer product.

Time-box each access investigation to two engineering days initially. Record
the actual account tier, product, endpoints, auth lifecycle, rate limits and
redacted payload evidence. This is a planning budget, not a delivery estimate.
A private hosted-browser approach is experimental until browser login, MFA,
expiry and renewal pass the same tests as any other connector. Do not evade
provider controls or silently fall back to a user's local browser.

An export-upload pipeline can ship a cloud-only technical alpha while access
is investigated. Label it an imported snapshot. It does not fulfill the live
connection acceptance criterion. If live consumer access fails, present the
explicit choice between import-based alpha, an eligible enterprise pilot and
further access work before changing the launch promise.

## Shared architecture and contracts

Use one repository and a modular Python backend rather than independent
microservices. Proposed stack: FastAPI, official MCP Python SDK, PostgreSQL
with full-text search, private object storage, and a separate ingestion worker
using durable PostgreSQL jobs. A browser frontend can use React/TypeScript.
Select and pin supported dependency versions during implementation; the
existing stdio package pin does not establish current HTTP auth compatibility.
Semantic search and generated summaries follow a measured retrieval baseline.

Run API/MCP, frontend and worker as separate deployable processes. Share typed
domain and storage modules. MCP queries the persisted index and never blocks
on provider backfill. Workers use bounded retries, jitter, per-account rate
limits, leases and resumable cursors. A partial or failed scan never implies
that unseen conversations were deleted.

Freeze these contracts before integrating parallel implementations:

- Identity: tenant, user, provider account, product, workspace and explicit
  source membership. Never use email, title or a filesystem path as identity.
- Conversation: internal ID, native ID, account/product scope, title, source
  URL when available, source timestamps, observed timestamp, revision and
  deletion state. Message identity includes native ID, parent/branch, role,
  ordered content blocks and attachment references.
- Preserve provider content and user text separately from inferred decisions.
  Deduplicate within the correct account scope; preserve edits and branches.
  Retain private source payloads under an explicit retention policy for parser
  repair, rather than promising indefinite raw-payload retention.
- Capability manifest: auth method, eligible account types, products,
  list/read/incremental/deletion/attachment coverage, import-only flag and
  verification date. Source agents supply evidence; UI consumes the manifest.
- Status: not configured, authorizing, syncing, ready, partial, reconnect
  required, paused, unsupported, imported snapshot. Include last successful
  read, content watermark, coverage gaps and initial backfill progress.
- Adapter operations: validate connection, enumerate conversations, retrieve
  messages, advance cursor, reconcile explicit deletions and revoke access
  where supported. Import adapters report snapshot boundaries instead.
- Read API/MCP: search with source/account/time filters and bounded pagination;
  fetch a conversation or message window; inspect coverage/freshness. Results
  contain stable references and provenance. An assistant can assemble a
  continuation brief from these tools; generative summarization is optional.

## Authentication, isolation and deletion

Separate web login, provider credentials and each assistant's MCP grant.
Use managed user identity and a standards-compatible OAuth authorization
service rather than implementing passwords or token cryptography. OAuth
protected-resource metadata, PKCE, resource/audience validation and compatible
client registration are required. Test actual client negotiation against the
current specification; do not assume SDK defaults are sufficient.
Pin tested protocol revisions for each client: the current transport and older
initialization/session lifecycles need explicit interoperability verification.

Each MCP grant selects allowed source accounts/workspaces. Derive tenant and
grant scope from validated authentication, never from model-supplied IDs.
Apply it to SQL, object storage, background jobs, pagination and caches.
Use row-level isolation as defense in depth and a least-privilege service role.
No arbitrary shell, URL fetch, provider token forwarding or write tools in MCP.
Conversation text is untrusted quoted data, never server instructions.

Encrypt provider secrets using the deployment secret-management service and
redact them from logs. Personal 1Password integration is not a prerequisite
for customer onboarding; operator deployment credentials can remain there.
Use signed, short-lived upload/download access and bounded archive extraction.
Enforce upload size, decompression and attachment limits.

Disconnect stops future ingestion; deletion removes stored content and search
entries. Deletion must invalidate queued jobs and defeat in-flight reimports
using a source generation/tombstone check. Publish backup retention and purge
behavior before beta. Revoked assistant grants fail on the next request.

## Web experience and distribution

Provide separate Sources and Assistants screens plus a minimal search/reader.
Sources show exact covered products, account/workspace, count and freshness.
Offer Connect only for demonstrated live access and Import for exports.
Support multiple accounts, inclusion scope, reconnect, pause, disconnect and
delete. Show first usable results while backfill continues.

Assistants shows the public MCP URL, graphical install instructions, account
scope consent and a real first-tool-call verification indicator. Cowork/Claude
organization installation can require an owner before individual authorization.
Codex desktop graphical MCP setup is documented; separately verify each
marketed cloud/desktop client surface. Do not invent install deep links or
assume a desktop configuration propagates to Codex cloud.

First-value acceptance: ask an assistant to find a real prior decision, cite
its messages and continue using that context. A connected OAuth session or a
successful health check alone does not complete onboarding.

## Work packages and ownership

The initial research was delegated to three independent agents. The following
packages are the implementation allocation; they are not running code changes.

| Package | Owner role | Deliverable and file boundary | Depends on |
| --- | --- | --- | --- |
| C0 | Lead integrator | Domain contracts, capability schema, API examples, migration skeleton in `one_conv/domain/` and `docs/contracts/` | None |
| A1 | Anthropic source agent | Claude export adapter and separate Chat/Cowork access proofs in `one_conv/providers/anthropic/`, source fixtures/tests | C0 for integration; access proof starts immediately |
| O1 | OpenAI source agent | ChatGPT export adapter, transport/auth separation and Codex-cloud access proof in `one_conv/providers/openai/`, source fixtures/tests | C0 for integration; access proof starts immediately |
| B1 | Hosted backend agent | Tenant storage, jobs, authorization, read API and HTTP MCP in `one_conv/service/`, `one_conv/storage/` | C0 |
| U1 | Web/distribution agent | Sources, search/reader, assistant consent/setup in `web/`; browser acceptance tests | C0 examples; can use explicit stubs |
| Q1 | Lead integrator | Cross-provider/client e2e, deployment, operational checks and release evidence in `tests/e2e/`, `deploy/` | B1 plus one source; then U1 and second source |
| C1 | Lead integrator | Optional cloud-mode CLI facade using the same read service, preserving local defaults | Stable B1 API; not required for no-Terminal alpha |

Respect the current four-agent capacity (lead plus three workers):

1. Lead freezes C0 while A1 and O1 run independent access proofs and B1 prepares
   the hosted skeleton. The already completed research informs these proofs.
2. A1/O1 integrate available source adapters, B1 implements cloud plumbing and
   the lead builds U1 against contract fixtures. No shared-file edits without
   an explicit handoff; the lead owns common schemas and dependency manifests.
3. As a source lane finishes, assign its freed slot to browser/client tests;
   the lead integrates Q1 while other lanes fix their own acceptance failures.

Dependency path: shared contract -> one source/import -> persisted search ->
authenticated MCP -> real client retrieval -> second source/account -> beta.
Provider feasibility runs alongside this path and gates live-source marketing.
Source investigation must not block UI, isolation or retrieval tests.

## Tests and release gates

Start with targeted optimized unit tests for changed code, then integration and
browser/client e2e. Run Python optimized and frontend production builds. Use
single-assertion parameterized unit cases and redacted/synthetic fixtures.
Never send messages or mutate provider conversations for testing without an
explicitly authorized test account/action. Read fixtures are sufficient for
most fault injection; real login and access still require real acceptance.

Required cases: two tenants with colliding native IDs; account/workspace grant
boundaries; branched/edited transcripts; duplicate imports; interrupted jobs;
rate limits; expired credentials; complete versus partial enumeration; malicious
archive/content; deletion during ingestion; revocation; pagination and restart.

Release stages:

1. Contract/access report: record supported and unverified source capabilities.
2. Technical alpha: web import or one proven live source -> storage -> search
   -> real authenticated Cowork retrieval. Verify Codex desktop separately.
3. Cross-provider alpha: two actual sources, multiple accounts, correct
   citations, repeat ingestion, reconnect, delete and grant revocation.
4. Live consumer gate, per source: ordinary account browser-only connection;
   read at least two conversations; observe a new turn after incremental sync;
   operate with the user's laptop off; prove expiry/reconnect and isolation.
5. Public beta: pass clean-browser no-Terminal onboarding and client matrix;
   production migrations, backup restore, rollback, health monitoring, bounded
   worker concurrency, per-tenant quotas and deletion policy verified.

Set measurable latency and freshness budgets after source rate limits are
known. Initial internal targets to validate: indexed search p95 under two
seconds on a declared representative corpus; live incremental freshness within
five minutes where the provider allows it. Publish actual coverage and measured
limits, not these provisional targets. Track time to first useful retrieval,
cross-provider repeat use, stale-result rate and cost per active user.

Test locally before staging deployment. Use synthetic staging tenants first,
then user-authorized source accounts. Promotion requires recorded gate evidence,
not merely green infrastructure. Choose hosting region, identity provider,
domain, retention and cost limits as a concrete deployment configuration before
production; these are not dependencies for parallel local implementation.

## Primary references

- [Claude exports](https://support.claude.com/en/articles/9450526-export-your-claude-data)
- [Claude compliance eligibility](https://support.claude.com/en/articles/13015708-access-the-compliance-api)
- [Claude compliance API](https://platform.claude.com/docs/en/manage-claude/compliance-api)
- [Cowork architecture](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)
- [ChatGPT exports](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data)
- [OpenAI Compliance Platform](https://help.openai.com/en/articles/9261474-compliance-apis-for)
- [Codex product coverage](https://help.openai.com/en/articles/11369540)
- [Claude remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
