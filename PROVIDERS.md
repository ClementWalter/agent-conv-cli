# Session-based cloud adapters

The experimental cloud path separates three responsibilities:

1. The authentication broker supplies an authorized HTTP session. Adapters never
   inspect browser stores or own user login.
2. `one_conv/providers/` contains private routes, response schemas, pagination,
   auth exchange and normalization. `base.py` supplies bounded GET transport
   and explicit authentication, rate-limit, unavailable and schema-change errors.
3. `one_conv/cloud.py` consumes normalized records, preserves branches and source
   attribution, writes private atomic cache files and records each sync outcome.
   Normal CLI search and reading consume these records without private API URLs.

## Coverage

| Product | Adapter | Current coverage | Live verification in this change |
| --- | --- | --- | --- |
| ChatGPT | `chatgpt.py` | Account validation, active/archive listing, search, conversation graph | Not performed |
| Claude Chat | `anthropic.py` | Explicit organization, conversation listing and message tree | Not performed |
| Codex cloud | `codex.py` | Current tasks and current user/assistant turns, including worklog fallback | Not performed |
| Cowork cloud | None | No demonstrated consumer cloud list/read routes | Blocked by unavailable authenticated browser |

Codex coverage is a current-task snapshot, not full historical turns. Claude
Code and Cowork are not inferred from Claude Chat access. Provider capabilities
remain distinct from account login. `one-conv cloud providers` reports these
limits; `one-conv cloud sync cowork-cloud` explicitly fails without a request.

## Session integration

`one-conv cloud sync PRODUCT` reads `ONE_CONV_SESSION_FILE` or `--session-file`.
This is an internal broker integration seam, not the end-user onboarding flow.
The private regular file must have mode 600 and contain `provider` (`openai` or
`anthropic`), a `cookies` map and an optional allowlisted `headers` map. Only
Authorization and ChatGPT-Account-ID headers are accepted. Do not commit these
files, include secrets in command arguments, or ask customers to copy tokens.
Claude requires explicit `--organization`. OpenAI session validation exchanges
the supplied sign-in cookie for an API bearer token before Codex task access.

Cloud login, a hosted session broker, hosted MCP and tenant storage are still
separate implementation work in CLOUD_PLAN.md. The cache here belongs to one
OS user; it is not a multi-tenant server database. No secrets are persisted in
the conversation cache. No local browser fallback is attempted by cloud sync.

The bounded sync refetches up to `--limit` conversations per invocation; it is
not yet a background incremental scheduler. A capped scan is partial. Absence
from a partial or failed scan never deletes cached conversations. Cached search
is available offline under `claude-chat`, `codex-cloud` and `chatgpt` sources.
The full graph and content blocks are retained, while default text search follows
the active branch when supplied. Session and cache identities include product
and account, avoiding collisions between providers and accounts.

## Handling upstream changes

- Each adapter declares an evidence/version fingerprint. Keep route and payload
  fixes within that provider, with a redacted or synthetic regression fixture.
- Required identity/list/message fields fail with `SchemaChanged`; a changed
  payload is never silently treated as an empty successful account.
- Unknown content remains available in source blocks where supported; parsers
  reject unsupported shapes that they cannot represent safely.
- 401/403 are authorization failures. 429 respects Retry-After, including HTTP
  dates; long delays return to the caller instead of blocking indefinitely.
  GET retries and pagination are bounded. Redirects in the new transport do
  not forward account credentials to other origins.
- Cache files replace atomically after successful parsing. Schema/network
  failures retain older content and record an error outcome. Status files are
  observations of a particular sync, not a promise the session is still live.
- Test route requests, parsing and normalization separately from cache/search.
  Integration fixtures exercise provider -> cache -> public CLI. Use a known
  account and read-only list/detail canary before declaring a private endpoint
  live; never use successful fixture tests as live-access evidence.

Existing ChatGPT commands share retry, listing, search and conversation schema
validation with the provider layer. Legacy asset download and compact transcript
rendering still live in the compatibility CLI and are not the hosted adapter
contract. They can migrate independently without changing the normalized API.

## Evidence

- Codex private routes and fixture: official
  [backend client](https://github.com/openai/codex/blob/74d3a5bf1046f004ee33a200ee497dc7593a5687/codex-rs/backend-client/src/client.rs)
  and [task detail fixture](https://github.com/openai/codex/blob/74d3a5bf1046f004ee33a200ee497dc7593a5687/codex-rs/backend-client/tests/fixtures/task_details_with_diff.json).
- Claude Chat routes are based on public reverse-engineering implementations,
  not an official contract: [exporter route notes](https://github.com/glebmish/claude-exporter/blob/main/docs/claude-ai-api.md)
  and [export implementation](https://gist.github.com/jas-ho/f95abd89d4e007eac9ee821d7c2a3d0b).
- Cowork investigation found generic managed-agent sessions and local desktop
  bridge code but no verified consumer cloud history route. An authenticated
  list/detail observation remains necessary; no route is fabricated here.
