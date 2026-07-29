# agent-conv-cli

Terminal access to your **own** Claude Code, Codex CLI, and Cursor
conversation history — one reader across all three, read-only:

```bash
agent-conv chats                        # projects (channels) across every source, most recent first
agent-conv read "myproject"              # list every thread's anchor in that project, any source
agent-conv thread "myproject"            # render the most recent thread in full
agent-conv read "myproject" --expand     # render EVERY thread in that project in full
agent-conv search "deploy-checklist"     # full-text search across everything
agent-conv find "deploy-checklist"       # find a thread by name (its derived title)
agent-conv fork "myproject" --yes        # continue a past Claude Code thread interactively, as a new one
agent-conv send "myproject" "..." --yes  # send a message into a Claude Code thread headlessly, print the reply
agent-conv port "myproject" --into codex --yes  # seed a NEW session with another provider, from any source
agent-conv unread                        # what's new since you last viewed it
agent-conv skill-usage                   # every Skill-tool invocation ever, count + last used (Claude Code only)
```

Same shape as Slack, one level up: a **project** (the directory an agent ran
in) is a **channel**, and a **session IS a thread** — an anchor message (its
first turn) plus every turn tied to it. The command set mirrors Slack's
exactly:

| Slack | agent-conv-cli |
|---|---|
| `channels` | `chats` |
| `read <channel>` (flat) | bare `read <query>` (every thread's anchor) |
| `read <channel> --expand-thread` | `read <query> --expand` |
| `thread <channel> <ts>` | `thread <query>` (`--session`/`--nth` instead of a `ts`) |
| `search <query>` | `search <text>` |

Unlike Slack, there's no "loose message outside any thread" — every turn
belongs to some session, so a project has nothing to show beyond its
threads.

## Three sources, one model

- **Claude Code** — `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`, one
  JSON-lines file per session (Anthropic Messages API shape).
- **Codex CLI** — `~/.codex/sessions/<Y>/<m>/<d>/rollout-*.jsonl` +
  `~/.codex/archived_sessions/*.jsonl` (OpenAI Responses-API shape:
  `message`/`reasoning`/`function_call`/`function_call_output` items). Not
  bucketed by project at all — every session from every project shares one
  date-tree — so this CLI groups sessions by their own recorded `cwd` itself.
- **Cursor** — one SQLite database,
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`. A
  `composerHeaders` table (one row per chat, with a **real stored title and
  native unread flag** — the only one of the three with either) plus a
  `cursorDiskKV` blob table keyed by `composerData:<id>` (bubble order) and
  `bubbleId:<composerId>:<bubbleId>` (each bubble's text). Opened read-only
  (`mode=ro`) — no snapshot-copy needed (the db is often 1GB+; SQLite's own
  WAL readers already get a consistent view without one).

Every backend normalizes into the same `Turn(ts, role, blocks)` shape, so
rendering/cleaning/search work identically regardless of source. The same
real directory often shows up under more than one source (you `cd` into a
repo and reach for whichever agent fits) — `chats` lists each `(source,
project)` pair as its own row, but a query that exactly names one real
directory merges every source's threads for it into one recency-sorted list
in `read`/`thread`/`search`/`find`/`unread`. `--source claude|codex|cursor`
narrows any of them back to one backend.

## Prerequisites

Requires Python 3.11+ and [`uv`](https://docs.astral.sh/uv/) — it runs the
script and resolves its one dependency (`click`) on demand:

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
# or
brew install uv
```

The `npx skills` install path additionally requires Node.js (for `npx`).

## Install

**A — Bundled launcher.** No install step. Clone the repo and invoke
`agent-conv` directly; the `#!/usr/bin/env -S uv run --script` shebang and
[PEP 723](https://peps.python.org/pep-0723/) inline metadata make `uv` pull
deps on the first run.

```bash
git clone <repo> agent-conv-cli
cd agent-conv-cli
./bin/agent-conv chats
```

**B — As an agent skill.** The repo ships a `SKILL.md` and the self-contained
`agent-conv` launcher at the project root, in the
[Vercel Labs `skills`](https://github.com/vercel-labs/skills) format:

```bash
npx skills add <owner>/agent-conv-cli
```

This drops the skill under `~/.agents/skills/agent-conv-cli/` and symlinks it
into every supported agent runtime installed on your machine (Claude Code,
Cursor, Windsurf, Codex, Gemini CLI, …). Agents then drive the CLI by invoking
the bundled `agent-conv` script directly.

To install locally for development instead, symlink the checkout so the skill
picks up live edits:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)" ~/.claude/skills/agent-conv-cli
```

## Usage

```bash
agent-conv chats                                     # projects/channels across every source, most recent first
agent-conv chats --source cursor --limit 100 --json  # everything from one backend, machine-readable
agent-conv read myproject                            # every thread's anchor: title, turns, timestamp (all sources)
agent-conv read myproject --source codex             # same, but only Codex's threads
agent-conv read myproject --match 2                  # disambiguate when multiple (source, project) pairs match
agent-conv read myproject --expand                   # every thread in that project, in full
agent-conv read myproject --expand --limit 5         # cap to the 5 most recent threads, in full
agent-conv thread myproject                          # ONE thread in full — most recently active by default, any source
agent-conv thread myproject --nth 2                  # the thread before the most recent one
agent-conv thread myproject --session a1b2c3d4       # an exact thread, by session-UUID/composerId prefix
agent-conv thread myproject --limit 20               # only its last 20 turns
agent-conv thread myproject --raw                    # include thinking + tool call/result blocks
agent-conv search "deploy-checklist"                 # full-text search across every project and source
agent-conv search "deploy-checklist" --project myproject  # scoped to one project
agent-conv find "deploy-checklist"                   # find a thread by its derived title (name)
agent-conv fork myproject                            # dry-run: shows the thread + command it'd launch (Claude Code only)
agent-conv fork myproject --session a1b2c3d4 --yes   # actually fork that thread
agent-conv send myproject "what's the status of #123?"          # dry-run (Claude Code only)
agent-conv send myproject "what's the status of #123?" --yes    # appends to that same thread
agent-conv send myproject "try another approach" --fork --yes   # sends into a NEW branch instead
agent-conv unread                                    # everything unread, across every project and source
agent-conv unread --project myproject                # scoped to one project
agent-conv unread --mark-all-read                    # catch up in bulk (Claude Code/Codex only — Cursor tracks its own)
agent-conv port myproject --source cursor --into claude          # cursor thread's content -> brand-new claude session
agent-conv port myproject --source codex --into claude --print   # headless, capture the reply
agent-conv port myproject --into codex --session a1b2c3d4 --yes  # actually launch (any dry-run needs --yes)
agent-conv skill-usage                               # every skill invoked, ever: count + last-used timestamp
agent-conv skill-usage --since-days 30 --json        # only the last 30 days, machine-readable
```

`agent-conv --help` lists every subcommand; `agent-conv <cmd> --help` for
per-command options including `--json`, `--limit`, `--match`, `--nth`,
`--session`, `--source`, `--expand`, `--raw`, `--include-subagents`, `--fork`,
`--into`, `--permission-mode`, `--yes`, `--no-mark-read`, `--mark-all-read`,
`--since-days`.

Every read command supports `--json` for structured output. `fork`, `send`,
and `port` are the ones that write. `fork`/`send` are **Claude Code only**
(Codex has an analogous `codex exec resume` but no fork flag; Cursor has no
CLI at all): `fork` hands off to a real interactive `claude --resume
--fork-session` process (a brand-new session ID via Claude Code's own fork
mechanism); `send` does the headless equivalent via `claude --print
--resume`, and — unless `--fork` is passed — genuinely continues the *same*
thread, appending the reply exactly as an interactive resume would. `port`
goes cross-provider instead: it starts a **brand-new** session with a
*different* provider (`--into claude|codex`), seeded with the source
thread's rendered transcript as the opening prompt — not a true resume,
since no provider understands another's session format. All three default
to a dry-run, same convention as the personal-messaging CLIs' `send`
commands.

## How it works

- **`read`/`thread` split mirrors Slack's `read`/`--expand-thread`/`thread`
  exactly** — `read` never targets a single thread; bare, it lists every
  thread's anchor (no content), `--expand` inlines every thread's full
  content instead (`--limit` then caps threads shown, not turns).
  `thread <query>` is the dedicated command for reading exactly one thread in
  full, defaulting to the most recent (`--nth`/`--session` to pick another;
  `--limit` caps turns there). Bare `read` never marks anything read (no
  content was shown); `read --expand` and `thread` do.
- **An exact project-name match auto-merges across sources.** A query
  substring-matches every nested candidate (worktrees, subpackages, *and*
  every source that has history there), which would normally force `--match`
  constantly — but if exactly one real directory's own name equals the
  query, every source's entry for it is merged automatically. Only a
  genuinely ambiguous query prints the numbered `[source] cwd (N threads)`
  disambiguation list.
- **Project resolution doesn't trust the directory name** for Claude Code
  (and Cursor's workspace hash). Claude Code encodes a project's cwd by
  turning every `/` and `.` into `-`, which is lossy on its own — a literal
  dash in a folder name is indistinguishable from an encoded separator.
  Instead, this CLI scans the `cwd` values actually recorded across a
  project directory's session files and picks whichever one re-encodes to
  exactly that directory's name. This matters in practice: a git-worktree
  session can start in the parent repo and only `cd` into
  `.claude/worktrees/<branch>` partway through, and Claude Code still files
  the whole session under the worktree's encoded name — naively trusting a
  session's first `cwd` would collapse several distinct worktree projects
  onto the same (wrong) parent-repo path. Cursor's workspace id resolves to a
  real path via that workspace's own `workspace.json`; Codex just records the
  real `cwd` directly per session, cached across a whole invocation since
  grouping means reading every session file once.
- **Compact rendering by default, per backend.** Only genuine user/assistant
  text is shown. Claude Code: `<system-reminder>`/`<task-notification>`
  blocks stripped, slash-command wrappers collapse to `/name`, pure
  tool-calling turns dropped (no placeholder), and a synthetic `user`
  follow-up turn (Skill's injected body, or a slash command's expanded
  prompt) dropped too — detected as a bare-text `user` turn immediately
  after another `user` turn with no assistant turn in between, which never
  happens for genuine input. Codex: `developer`-role messages (its
  permissions/sandbox preamble) never surface at all, and the `AGENTS.md`
  dump it prepends as its own separate `user` turn is dropped by content
  prefix — the *first* of the two consecutive turns is the synthetic one
  here, the opposite position from Claude Code's case. Cursor: bubbles are
  already clean user/assistant pairs, nothing to strip. Pass `--raw` to
  disable all of this and see everything, including thinking blocks and full
  tool-call/tool-result detail.
- **Subagent forks are excluded by default** (Claude Code's `isSidechain:
  true` events) — pass `--include-subagents` to include them.
- **Search/find use per-backend cheap pre-filters**: a substring check on raw
  file bytes for Claude Code/Codex (before any JSON parsing), one batched SQL
  `LIKE` query across Cursor's bubble table (no single-file check is
  possible there) — so searching everywhere stays fast even with a lot of
  history.
- **No title is stored**, except by Cursor. `find`/`read`/`thread` derive one
  for Claude Code/Codex threads from the first substantive user message.
- **`skill-usage` reads the `Skill` tool_use event itself**, not skill output —
  Claude Code always records `{"name": "Skill", "input": {"skill": "<name>"}}`
  in the main transcript the moment a skill is invoked, even when the skill's
  actual work then forks into a background subagent, so subagent turns never
  need scanning. Same cheap raw-bytes pre-filter as `search`/`find` before any
  JSON parsing keeps a full-history scan fast (a 900MB/2500-session history
  scans in ~1s). It only reports what got used — never installed skills or
  what to do about unused ones; that comparison belongs to the caller. In
  `--json`, each skill also carries a `recent` list of `session`/`cwd`/`ts`
  pointers (`--recent N` to size it) so a caller can jump straight to
  `agent-conv thread <cwd> --session <uuid>` right after a given load and
  judge *how* the skill got used, not just whether it did.
- **Token counts are input + output only, deliberately excluding cache
  reads/writes.** Every thread listing and `thread`/`read --expand` header
  shows a token total (`chats`/JSON output include the raw field too). With
  prompt caching, a long session's later turns each re-read nearly its whole,
  ever-growing context — summing cache fields across turns scales with
  turns × context-size and balloons into the hundreds of millions for long
  sessions (verified: 552M cache-read tokens on one 1193-turn Claude Code
  session, dominated entirely by repeated cache reads). Input + output alone
  tracks how much was actually exchanged instead. Same logic applies to
  Codex: its own `total_token_usage` field has the identical cumulative-cache
  problem, so this sums each call's *new* tokens
  (`last_token_usage.input_tokens - cached_input_tokens + output_tokens`)
  across every `token_count` event instead. Cursor has no cache concept in
  its per-bubble `tokenCount`, so its input+output sum needs no adjustment.
- **`fork` hands off to a real `claude` process** via `os.execvp`, replacing
  this script entirely so the resumed thread gets a proper interactive
  terminal — it `cd`s to the original thread's directory first, then runs
  `claude --resume <uuid> --fork-session`.
- **`send` uses `claude --print --resume` instead** (`subprocess.run`, not
  `execvp`, so it can capture the reply and return control to the caller) —
  no TTY needed. Verified live: forking a thread with `--permission-mode
  plan` and a tool-free prompt returns a reply in a few seconds; the
  original thread's turn count is untouched and a `--fork`'d branch (with
  the reply appended) appears alongside it.
- **`port` seeds a brand-new session with another provider** instead of
  resuming — no provider can literally continue another's session format, so
  the source thread's rendered transcript (same clean text `thread`/`read`
  show, not a raw tool-call replay) becomes the opening prompt of a fresh
  `claude`/`codex` process, started in the same directory. **Cursor can only
  be a `--source`, never a `--into` target** — verified: `cursor --help` is
  purely an editor launcher (open/diff/goto-line), with no chat/prompt
  capability at all. Marks the source thread read (like `thread`) unless
  `--no-mark-read` is passed, since its full content gets rendered either
  way.
- **Read/unread**: Claude Code and Codex have no concept of it, so both are
  tracked via local bookkeeping, not a feature of either tool. A small state
  file (`~/.config/agent-conv-cli/read-state.json`, override with
  `$AGENT_CONV_STATE_DIR`) maps each session id to the file mtime it was
  last read at; `thread`/`read --expand` update it (unless `--no-mark-read`),
  and a thread counts as unread if it's never in that map or its current
  mtime is newer than the recorded one. Deliberately kept out of `~/.claude`
  — Claude Code owns that directory and this CLI never writes into it.
  **Cursor already tracks unread state natively** (`composerHeaders`'
  `hasUnreadMessages`) — that flag is read directly and never written to;
  `unread --mark-all-read` skips Cursor threads entirely.

## Dependencies

Declared inline via PEP 723 in `agent-conv`:

- `click` — CLI framework

Everything else is Python stdlib (`json`, `re`, `sqlite3`, `pathlib`, …).

## Scope

Single-user personal tooling for **your own** Claude Code / Codex / Cursor
history on **your own** machine. It reads local files you already have
access to — there is no network service, no account, and no way to read
anyone else's conversations. The Claude Code and Codex backends are
cross-platform (pure file reads); the Cursor backend auto-detects its data
directory on macOS/Linux/Windows but has only been exercised on macOS.

## See also

Same idea — your own messages, from the terminal, for other channels
(companion tools, same author):

- [**imessage-cli**](https://github.com/ClementWalter/imessage-cli) — your personal iMessage/SMS history
- [**whatsapp-cli**](https://github.com/ClementWalter/whatsapp-cli) — your personal WhatsApp chats (pairs as a linked device)
- [**slack-user-cli**](https://github.com/ClementWalter/slack-user-cli) — Slack via your existing browser session credentials
- [**tg-cli**](https://github.com/ClementWalter/tg-cli) — your own Telegram chats via your user account (Telethon)
