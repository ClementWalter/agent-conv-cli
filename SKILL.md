---
name: one-conv-cli
description: >-
  Read the user's AI conversation history with one-conv. Use cloud for ChatGPT,
  Claude Chat, Codex cloud and Cowork; use local for Claude Code, Codex CLI,
  Cursor, Oh My Pi and the shared corpus on disk. Discover accounts, pull cloud
  history, list conversations, search messages and read threads. Local agent
  continuation commands require explicit --yes. Cloud authentication reuses
  authorized browser sessions without Keychain password prompts.
---

# One conversation reader

Use the bundled `bin/one-conv` launcher, or `one-conv` when installed on PATH.
The Python launcher resolves its dependencies through `uv`.

## Choose the namespace first

```bash
one-conv cloud --help
one-conv local --help
```

- `cloud chatgpt`: ChatGPT web conversations.
- `cloud claude`: Claude web chat, distinct from local Claude Code.
- `cloud codex`: Codex cloud tasks, distinct from local Codex CLI.
- `cloud cowork`: Cowork cloud tasks; transcript access remains unverified.
- `local`: local Claude Code, Codex CLI, Cursor, Oh My Pi and corpus files.

Old top-level commands remain compatibility aliases. Prefer namespaces for new
invocations so local work cannot implicitly scan cloud accounts. For legacy
asset sync, online ChatGPT search and existing automation, see
[LEGACY_COMMANDS.md](LEGACY_COMMANDS.md).

## Cloud history

Every product exposes `accounts`, `pull`, `chats`, `read`, `thread`, `search`,
`find` and `unread`. Pull contacts the provider. Readers and searches inspect
saved history without contacting authentication services.

```bash
one-conv cloud claude accounts --json
one-conv cloud claude pull --account Zama --limit 10
one-conv cloud claude chats --json
one-conv cloud claude read QUERY --json
one-conv cloud claude thread QUERY --no-mark-read --json
one-conv cloud chatgpt pull --account EMAIL --limit 10
one-conv cloud codex pull --account EMAIL --limit 10
one-conv cloud search QUERY --json
```

Replace `QUERY`, `EMAIL` and account selectors with values from discovery.
Claude selectors include organization names and IDs; ambiguous names require
the exact account ID. Claude account identity includes browser profile and
organization. Unknown account email is left unset.

Claude and OpenAI reuse provider-scoped browser sessions. Keychain access is
strictly noninteractive: being signed into a browser does not prove the CLI
can decrypt its session. Empty discovery or an authorization error is not an
empty conversation history. Never disable prompt suppression to work around
background authentication failures.

`--session-file` remains an internal broker integration option. Do not ask users
to copy tokens or treat that file as customer onboarding. No hosted login or
session renewal service is implemented. See [PROVIDERS.md](PROVIDERS.md) for
provider coverage, live verification and API-change handling.

## Local history

```bash
one-conv local chats --json
one-conv local read PROJECT --source claude --json
one-conv local thread PROJECT --source codex --no-mark-read --json
one-conv local search QUERY --json
one-conv local find QUERY --json
one-conv local unread --json
one-conv local skill-usage --json
```

`chats` lists projects/accounts. `read QUERY` lists a project's conversations;
`read QUERY --expand` includes their messages. `thread QUERY` reads one
conversation, selecting the latest unless `--nth` or `--session` is supplied.
`search` finds message text; `find` matches conversation titles.

Local `--source` accepts `claude`, `codex`, `cursor`, `omp`, or `corpus`.
Queries naming the same local project merge matching agent histories.
`--raw` includes tool details. Reading updates local unread bookkeeping unless
`--no-mark-read` is supplied. Consult each command's `--help` before less common
operations.

## Continuing local agent conversations

`local fork`, `local send` and `local port` launch actual agents. They default
to dry-run and require `--yes` to act. `fork` and `send` target Claude Code;
`port --into claude|codex` starts a new conversation with rendered context.
These agents can modify files or use tools, so preserve the user's action scope.

`local export` writes normalized history into a corpus checkout. `local append`
writes one turn to the shared corpus log. These are writes, not history reads.

## Verification

Distinguish current provider access, cached history and parser tests. A browser
page read is not proof of a successful CLI pull. A successful bounded pull is
not a complete account backfill. Report authentication and schema failures
explicitly; do not represent them as a connected account with no messages.
