---
name: agent-conv-cli
description:
  "Read your own local Claude Code / Codex CLI / Cursor conversation history
  from the terminal via the bundled `agent-conv` command — one unified
  reader across all three. Same shape as Slack, one level up: a project is a
  channel, a session IS a thread. `agent-conv chats` lists projects/channels
  across every source, most recently active first, tagged. `agent-conv read
  <query>` mirrors Slack's `read <channel>`: bare, it lists every thread's
  anchor (title/turns/timestamp, no content); `--expand` inlines every
  thread's full content, like `--expand-thread`. A query that exactly names
  one real directory merges every source's threads for it into one list.
  `agent-conv thread <query>` mirrors Slack's `thread <channel> <ts>`: reads
  exactly one thread in full (defaults to the most recent; `--nth`/`--session`
  to pick another). `--source claude|codex|cursor` scopes any command to one
  backend. `agent-conv search <text>` full-text-searches across everything;
  `agent-conv find <text>` locates a thread by its derived title (name)
  across every project. `agent-conv fork <query>` hands off to `claude
  --resume --fork-session` to continue a past Claude Code thread as a new one
  interactively (dry-run by default; Claude-only — Codex/Cursor have no
  equivalent CLI hook). `agent-conv send <query> <message>` does the same
  headlessly and prints the reply, appending to that same thread unless
  `--fork` is passed (dry-run by default). `agent-conv unread` lists threads
  with activity you haven't seen yet (Claude Code/Codex: local bookkeeping;
  Cursor: its own native unread flag, read directly). `agent-conv skill-usage`
  tallies every Skill-tool invocation across all Claude Code history — count,
  last-used timestamp, and (in `--json`) per-invocation session/cwd pointers
  to drill into how a skill actually got used. No auth, no network —
  it's a local file reader, the counterpart to
  imessage-cli/whatsapp-cli/slack-user-cli for your own coding-agent history.
  Use when the user wants to recall, search, review, or continue a past
  Claude Code, Codex, or Cursor conversation, thread, or project's history."
---

# Claude Code / Codex / Cursor conversation reader CLI

Terminal access to your **own** conversation history across three coding
agents by reading each one's local storage directly, read-only:

- **Claude Code** — `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`, one
  JSON-lines file per session (Anthropic Messages API shape).
- **Codex CLI** — `~/.codex/sessions/<Y>/<m>/<d>/rollout-*.jsonl` and
  `~/.codex/archived_sessions/*.jsonl` (OpenAI Responses-API shape); not
  bucketed by project at all, so this CLI groups sessions by their own
  recorded `cwd` itself.
- **Cursor** — one SQLite database,
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`. A
  `composerHeaders` table (one row per chat, with a *real* stored title and
  native unread flag) plus a `cursorDiskKV` blob table keyed by
  `composerData:<id>` (bubble order) and `bubbleId:<composerId>:<bubbleId>`
  (each bubble's text). Opened read-only (`mode=ro`) — no snapshot-copy
  needed (the db is often 1GB+; SQLite's own WAL readers already get a
  consistent view without one).

Every backend normalizes into the same `Turn(ts, role, blocks)` shape, so
rendering, cleaning, and search all work identically regardless of source.

## How to invoke

Invoke it as **`agent-conv`** — on `$PATH` via a symlink in `~/.local/bin` onto this
repo's `bin/agent-conv`, so it always runs the current checkout: a `git pull`, or even
an uncommitted edit, takes effect immediately with nothing to reinstall.

```bash
agent-conv chats
```

Examples in this doc are written that way. If `agent-conv` is not on `$PATH`, run the
bundled launcher `bin/agent-conv` resolved against this skill's own directory (PEP 723
— `uv` resolves deps inline on first run), or link it once:

```bash
ln -sfn <skill-dir>/bin/agent-conv ~/.local/bin/agent-conv
```

## Mental model

Same shape as Slack, one level up: a **project** (the directory an agent ran
in) is a **channel**, and a **session** IS a **thread** — an anchor message
(its first turn) plus every turn tied to it. The command set mirrors Slack's
exactly, across all three sources at once:

| Slack | agent-conv-cli |
|---|---|
| `channels` | `chats` |
| `read <channel>` (flat) | bare `read <query>` (every thread's anchor) |
| `read <channel> --expand-thread` | `read <query> --expand` |
| `thread <channel> <ts>` | `thread <query>` (`--session`/`--nth` instead of a `ts`, since a session has no natural timestamp handle) |
| `search <query>` | `search <text>` |
| *(no equivalent)* | `find <text>` — locate a thread by its title across every project |
| *(no equivalent)* | `fork` / `send` — continue a Claude Code thread, live or headless |
| *(no equivalent)* | `unread` — read/unread tracking, native for Cursor, local bookkeeping for Claude Code/Codex |
| *(no equivalent)* | `--source claude\|codex\|cursor` — scope any command to one backend |

Unlike Slack, there's no "loose message outside any thread" case — every turn
belongs to exactly one session, so a project has nothing to show beyond its
threads.

**The unifying idea**: the same real directory is often driven by more than
one of these three tools (you `cd` into a repo and reach for whichever agent
fits). `chats` lists every (source, project) pair as its own row, tagged —
but `read`/`thread`/`search`/`find`/`unread` treat a query that exactly names
one real directory as spanning *all* sources for it at once, merging their
threads into one recency-sorted list. `--source` narrows any of them back to
one backend when that's what you want instead.

## When to use

Trigger when the user wants to **recall, search, or review a past coding-agent
conversation** — "what did we decide about X last week", "find that
conversation where I asked about Y", "show me the thread where I built Z",
"how many threads have I had in project W", regardless of which of the three
tools it happened in.

Everything except `fork`/`send` is read-only by construction. Those two
launch a real `claude` process (Claude Code only) — and both default to a
dry-run, same convention as the personal-messaging CLIs' `send` commands.

## Commands

### `agent-conv chats [--source S] [--limit N] [--json]`

List projects (channels) across every source, most recently active first:
real cwd, which source, thread count, last-active timestamp, and an unread
count when nonzero (see `unread`). The *same* real directory can appear as
several rows — one per source that has history there.

### `agent-conv read <query> [--source S] [--expand] [--limit N] [--match N] [--raw] [--include-subagents] [--no-mark-read] [--json]`

The channel's top-level view — never targets a single thread (use `thread`
for that). Searches all three sources at once unless `--source` narrows it;
an exact directory-name match merges every source's threads for it:

```bash
agent-conv read myproject                     # every thread's anchor, across all sources for that project
agent-conv read myproject --source cursor     # same, but only Cursor's threads
agent-conv read myproject --expand            # every thread's FULL content, one after another
agent-conv read myproject --expand --limit 5  # cap to the 5 most recent threads in expand mode
agent-conv read myproject --raw               # (with --expand) include thinking + tool_use/tool_result
```

Bare, `--limit` caps how many threads are *listed*; with `--expand`, `--limit`
caps how many are *shown in full* (turns aren't capped per-thread in this
mode — use `thread --limit` for that). Bare mode never marks anything read
(no content was actually shown); `--expand` marks every thread it renders as
read (see `unread`) unless `--no-mark-read` is passed.

### `agent-conv thread <query> [--source S] [--session UUID | --nth N] [--limit N] [--match N] [--raw] [--include-subagents] [--no-mark-read] [--json]`

Read exactly one thread in full — Slack's `thread <channel> <ts>`, standing
in a UUID or position (`--nth`) for the `ts` Slack would use. When a query
merges threads from multiple sources, `--nth` ranks across all of them by
recency together:

```bash
agent-conv thread myproject                    # most recently active thread, any source, in full
agent-conv thread myproject --source codex     # most recent Codex thread specifically
agent-conv thread myproject --nth 2            # the thread before that
agent-conv thread myproject --session a1b2c3d4 # an exact thread (session UUID / composerId prefix)
agent-conv thread myproject --limit 20         # only its last 20 turns
agent-conv thread myproject --raw              # include thinking + tool_use/tool_result blocks
```

Compact mode (default) shows only genuine assistant prose and user text.
Each backend has its own noise stripped: Claude Code's `<system-reminder>`/
`<task-notification>` blocks, slash-command wrappers (collapsed to `/name`),
turns that were pure tool-calling (dropped, no placeholder), and a "user"
turn that's really injected content — a *separate* follow-up `user` turn
with no assistant turn in between, which never happens for genuine input
(Skill's `tool_result` ack + a follow-up turn carrying the whole SKILL.md
body; or a slash command's trigger turn + a follow-up turn with the command's
entire expanded prompt substituted in). Codex has an analogous but distinct
pattern: its `developer`-role permissions/sandbox preamble is never surfaced
at all, and the `AGENTS.md` dump it prepends as its own separate `user` turn
is dropped by content-prefix, not position (unlike Claude's case, here it's
the *first* of the two consecutive turns that's synthetic). Cursor's bubbles
are already clean user/assistant pairs — no equivalent noise to strip.
Subagent/sidechain forks (Claude Code only) are excluded unless
`--include-subagents` is passed. `--raw` disables all cleaning and shows
everything, including thinking and full tool_use/tool_result detail. Marks
the thread read (see `unread`) unless `--no-mark-read` is passed.

### `agent-conv search <text> [--source S] [--project QUERY] [--limit N] [--json]`

Full-text search across every source's transcripts (or scoped with
`--project`/`--source`). A cheap pre-filter runs before any full parsing — a
raw-bytes substring check for Claude Code/Codex's flat JSONL files, one
batched SQL `LIKE` query for Cursor's SQLite store (no single-file check is
possible there) — so searching everywhere stays fast even with a lot of
history. Matches anywhere in a transcript, one row per matching turn — for a
title-only, one-row-per-thread search see `find`.

### `agent-conv find <text> [--source S] [--limit N] [--json]`

Find a thread **by name** — i.e. by its derived title — across every project
and source. Only Cursor stores a real thread title; Claude Code/Codex don't,
so "name" there is the first substantive thing you said in it (same text
`chats`/`read` derive titles from). Unlike `search` (matches anywhere, one row
per matching turn), `find` matches only the title and returns one row per
thread, most recently active first.

### `agent-conv unread [--source S] [--project QUERY] [--limit N] [--mark-all-read] [--json]`

List threads with activity you haven't seen yet, most recently active first,
across every source. Claude Code and Codex have no concept of read/unread, so
those two are tracked via local bookkeeping
(`~/.config/agent-conv-cli/read-state.json`, override with
`$AGENT_CONV_STATE_DIR`): a thread counts as unread until you view its full
content via `thread` or `read --expand` (or catch up in bulk with
`--mark-all-read`), same as a message you've never opened, and new activity
since the last time makes it unread again. **Cursor already tracks its own
unread state natively** — that flag is read directly and never written to;
`--mark-all-read` skips Cursor threads (open them in Cursor itself to clear
its own flag).

```bash
agent-conv unread                        # everything unread, across every project and source
agent-conv unread --project myproject    # scoped to one project
agent-conv unread --source claude        # scoped to one backend
agent-conv unread --mark-all-read        # catch up in bulk instead of listing (claude/codex only)
```

The first run will likely show your whole Claude Code/Codex history as
unread (nothing has ever been marked read yet) — run `unread --mark-all-read`
once to start clean, then normal usage keeps it current. `chats` shows a
per-project unread count and bare `read` prefixes unread rows with `●`.

### `agent-conv skill-usage [--since-days N] [--recent N] [--json]`

**Claude Code only** — Codex and Cursor have no equivalent "Skill" tool
concept. Tallies every `Skill` tool invocation across every project's
session history: Claude Code records `{"name": "Skill", "input": {"skill":
"<name>"}}` in the main transcript the moment a skill is invoked (even when
the skill's own work then forks into a background subagent), so this never
needs to scan subagent/sidechain turns. Reports one row per distinct skill
name actually invoked — count and most recent use, most recently used first:

```bash
agent-conv skill-usage                     # every skill ever invoked: count + last-used timestamp
agent-conv skill-usage --since-days 30     # only sessions touched in the last 30 days
agent-conv skill-usage --json              # machine-readable, includes drill-down pointers
agent-conv skill-usage --json --recent 10  # keep the last 10 invocations' pointers per skill (default 5)
```

In `--json`, each row also carries `recent`: its last N invocations'
`session`/`cwd`/`ts`, enough to jump straight to the transcript right after a
given load — `agent-conv thread <cwd> --source claude --session <uuid>` (add
`--match N` if that `cwd` is ambiguous among nested worktrees) — to actually
judge how the skill got used (one clean action vs. floundering, unclear
back-and-forth), not just whether it got used at all. Text mode only prints
the count + most recent timestamp.

`--since-days 0` (the default) scans full history — a cheap raw-bytes
pre-filter on each session file (same trick `search`/`find` use) before any
JSON parsing keeps this fast even across years of transcripts. This command
only reports what got *used*; it has no notion of which skills are currently
installed, so pair it with a listing of your skills directory to work out
what's unused — that comparison is left to the caller.

### `agent-conv fork <query> [--nth N] [--session UUID] [--match N] [--yes]`

**Claude Code only** — Codex has an analogous `codex exec resume` but no fork
flag, and Cursor has no CLI at all. Continue a past thread as a **new**
thread, via Claude Code's own `claude --resume <uuid> --fork-session` — the
original is left untouched, exactly like branching in git. Resolves the
thread the same way `thread` does (but only within Claude Code — no
`--source`). **Defaults to a dry-run** that prints the resolved thread and
the command that would run; pass `--yes` to actually launch it (this replaces
the current process and hands the terminal off to a real, writable
interactive `claude` session — run it from an actual terminal, not scripted).

```bash
agent-conv fork myproject                     # dry-run: shows what would launch
agent-conv fork myproject --session a1b2c3d4 --yes  # actually fork that thread
```

### `agent-conv send <query> <message> [--nth N] [--session UUID] [--match N] [--fork] [--permission-mode MODE] [--timeout SECS] [--yes] [--json]`

**Claude Code only.** Send `<message>` into a thread non-interactively and
print Claude's reply — runs `claude --print --resume <uuid> <message>` from
that thread's own directory. **Without `--fork` this appends to the same
thread**, exactly as if you had resumed it in an interactive terminal and
typed the message yourself; pass `--fork` to branch into a new thread instead
(same `--fork-session` mechanism as `fork`, but the message is sent and the
reply captured immediately rather than opening a terminal).

```bash
agent-conv send myproject "what's the status of #123?"           # dry-run
agent-conv send myproject "what's the status of #123?" --yes     # actually sends, appends to that thread
agent-conv send myproject "try a different approach" --fork --yes  # sends into a NEW branch instead
```

This is a real write action: the resumed thread may run tools (edit files,
run commands, ...) depending on its permission mode, which is why it defaults
to a dry-run. `--permission-mode` passes straight through to `claude`
(`plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`, ...); without it,
whatever the resumed thread's own default is applies — which may block on
anything needing approval, since there's no interactive terminal to approve
it in. Verified live: forking a small thread with `--permission-mode plan`
and a tool-free prompt returns a reply in a few seconds, and the original
thread's turn count is untouched (only a `--fork`'d branch grows).

### `agent-conv port <query> --into claude|codex [--source S] [--session UUID | --nth N] [--match N] [--limit N] [--raw] [--include-subagents] [--print] [--permission-mode MODE] [--timeout SECS] [--no-mark-read] [--yes]`

Port a thread's content from **any** source into a **brand-new** conversation
with another provider. This is *not* a true resume — each provider only
understands its own session format, so a Codex or Cursor thread can never
literally continue inside Claude Code (or vice versa) — instead, the source
thread's rendered transcript (the same clean text `thread`/`read` show, no
raw tool-call replay) becomes the *opening prompt* of a fresh session with
the target provider, started in the same directory, so the model has full
context to pick up from a similar point without an exact state replay.

**Cursor can only ever be a source, never a `--into` target** — it has no CLI
at all to start or seed a chat with a prompt (verified: `cursor --help` is
purely an editor launcher — open files, diff, goto-line; no chat/composer
flags exist).

```bash
agent-conv port myproject --source cursor --into claude          # interactive: cursor thread -> new claude session
agent-conv port myproject --source codex --into claude --print   # headless: codex thread -> claude --print, capture reply
agent-conv port myproject --source claude --into codex           # claude thread -> new interactive codex session
agent-conv port myproject --into codex --session a1b2c3d4 --yes  # actually launch (any dry-run needs --yes)
```

Defaults to a dry-run (same convention as `fork`/`send`) that prints the
resolved source thread and what would be launched, without dumping the full
seed transcript into the terminal. Without `--print`, hands the terminal off
to a real interactive session (`claude "<seed>"` or `codex "<seed>"`, both of
which accept an initial prompt to start fresh); with `--print`, headless via
`claude --print "<seed>"` / `codex exec "<seed>"`, capturing and printing
just the reply. Since the source thread's full content gets rendered either
way, marks it read (see `unread`) unless `--no-mark-read` is passed. Verified
live: a real 2-turn Cursor thread ("Forge script profile") ported headlessly
into a fresh `claude --print` session picked up the topic correctly and
investigated the actual repo, with no interference to the source thread.

## Notes

- **The directory name is not the source of truth for the project path**
  (Claude Code, and Cursor's workspace hash). Claude Code encodes the cwd by
  turning every `/` and `.` into `-`, lossy on its own (a literal dash in a
  folder name is indistinguishable from an encoded separator) — this CLI
  instead reconciles the `cwd` values actually recorded inside each project's
  session files against the directory name, so it correctly resolves distinct
  projects that collide under a naive decode (e.g. a git worktree session
  that started in the parent repo and only `cd`'d into
  `.claude/worktrees/<branch>` partway through). Cursor's workspace id
  resolves to a real path via that workspace's own `workspace.json`. Codex
  just records the real `cwd` directly per session (no bucketing at all —
  every project's sessions share one date-tree, grouped by this CLI itself,
  cached per invocation since it means reading every session file once).
- **A thread's own `cwd` can drift mid-conversation** (the agent runs `cd`,
  works in a subdirectory, etc.) — every event's `cwd` reflects the live shell
  state at that point, not a fixed identity.
- **No title is stored**, except by Cursor. `find`/`read`/`thread` derive one
  for Claude Code/Codex threads from the first substantive user message.
- **An exact project-name match auto-merges across sources.** If a query
  substring-matches many candidates (nested worktrees, subpackages, *and*
  every source that has history there) but exactly one real directory's own
  name equals the query, every source's entry for that directory is used
  together — no `--match` needed for the common case. Genuinely ambiguous
  queries still print a numbered `[source] cwd (N threads)` list.
- Every command supports `--json` for structured output.
- **Token counts (`chats`/`read`/`thread` and their `--json`) are input +
  output only** — cache reads/writes are deliberately excluded. Prompt
  caching means a long session's later turns each re-read nearly its whole,
  ever-growing context, so summing cache fields across turns scales with
  turns × context-size (verified: 552M cache-read tokens on one 1193-turn
  Claude Code session — pure caching artifact, not real content). Codex's
  own `total_token_usage` has the identical problem, so its total is built
  by summing each call's *new* tokens instead
  (`last_token_usage.input_tokens - cached_input_tokens + output_tokens`)
  rather than trusting that cumulative field. No pricing/cost is computed —
  raw token counts only.
