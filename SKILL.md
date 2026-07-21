---
name: claude-conv-cli
description:
  "Read your own local Claude Code conversation history from the terminal via
  the bundled `bin/claude-conv` command. Claude Code writes every session to
  `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`; this CLI reads those files
  directly (read-only). Same shape as Slack, one level up: a project is a
  channel, a session IS a thread. `claude-conv chats` lists projects/channels,
  most recently active first. `claude-conv read <query>` mirrors Slack's
  `read <channel>`: bare, it lists every thread's anchor (title/turns/
  timestamp, no content); `--expand` inlines every thread's full content,
  like `--expand-thread`. `claude-conv thread <query>` mirrors Slack's
  `thread <channel> <ts>`: reads exactly one thread in full (defaults to the
  most recent; `--nth`/`--session` to pick another). `claude-conv search
  <text>` full-text-searches across everything; `claude-conv find <text>`
  locates a thread by its derived title (name) across every project.
  `claude-conv fork <query>` hands off to `claude --resume --fork-session` to
  continue a past thread as a new one interactively (dry-run by default).
  `claude-conv send <query> <message>` does the same headlessly and prints
  the reply, appending to that same thread unless `--fork` is passed
  (dry-run by default). `claude-conv unread` lists threads with activity you
  haven't seen yet (local bookkeeping; `thread`/`read --expand` mark read,
  `chats`/`read` show unread counts/markers). No auth, no network — it's a
  local file reader, the counterpart to imessage-cli/whatsapp-cli/
  slack-user-cli for your own Claude Code history. Use when the user wants
  to recall, search, review, or continue a past Claude Code conversation,
  thread, or project's history."
---

# Claude Code conversation reader CLI

Terminal access to your **own** Claude Code conversation history by reading
the local session transcripts (`~/.claude/projects/**/*.jsonl`) directly,
read-only.

## How to invoke

Run the bundled launcher **`bin/claude-conv`** (PEP 723 — `uv` resolves deps
inline on first run). Resolve `bin/claude-conv` against this skill's
directory; from elsewhere use the absolute path.

## Mental model

Same shape as Slack, one level up: a **project** (the directory you ran
`claude` in) is a **channel**, and a **session** IS a **thread** — an anchor
message (its first turn) plus every turn tied to it. The command set mirrors
Slack's exactly:

| Slack | claude-conv-cli |
|---|---|
| `channels` | `chats` |
| `read <channel>` (flat) | bare `read <query>` (every thread's anchor) |
| `read <channel> --expand-thread` | `read <query> --expand` |
| `thread <channel> <ts>` | `thread <query>` (`--session`/`--nth` instead of a `ts`, since a session has no natural timestamp handle) |
| `search <query>` | `search <text>` |
| *(no equivalent)* | `find <text>` — locate a thread by its title across every project |
| *(no equivalent)* | `fork` / `send` — continue a thread, live or headless |
| *(no equivalent)* | `unread` — Claude Code has no read/unread concept; this is local bookkeeping |

Unlike Slack, there's no "loose message outside any thread" case — every turn
belongs to exactly one session, so a project has nothing to show beyond its
threads.

## When to use

Trigger when the user wants to **recall, search, or review a past Claude Code
conversation** — "what did we decide about X last week", "find that
conversation where I asked about Y", "show me the thread where I built Z",
"how many threads have I had in project W".

Everything except `fork`/`send` is read-only by construction. Those two
launch a real `claude` process — and both default to a dry-run, same
convention as the personal-messaging CLIs' `send` commands.

## Commands

### `claude-conv chats [--limit N] [--json]`

List projects (channels), most recently active first: real cwd (not the
lossy encoded directory name), thread count, last-active timestamp, and an
unread count when nonzero (see `unread`).

### `claude-conv read <query> [--expand] [--limit N] [--match N] [--raw] [--include-subagents] [--no-mark-read] [--json]`

The channel's top-level view — never targets a single thread (use `thread`
for that):

```bash
bin/claude-conv read zama                     # every thread's anchor: title, turns, timestamp
bin/claude-conv read zama --expand            # every thread's FULL content, one after another
bin/claude-conv read zama --expand --limit 5  # cap to the 5 most recent threads in expand mode
bin/claude-conv read zama --raw               # (with --expand) include thinking + tool_use/tool_result
```

Bare, `--limit` caps how many threads are *listed*; with `--expand`, `--limit`
caps how many are *shown in full* (turns aren't capped per-thread in this
mode — use `thread --limit` for that). Bare mode never marks anything read
(no content was actually shown); `--expand` marks every thread it renders as
read (see `unread`) unless `--no-mark-read` is passed.

### `claude-conv thread <query> [--session UUID | --nth N] [--limit N] [--match N] [--raw] [--include-subagents] [--no-mark-read] [--json]`

Read exactly one thread in full — Slack's `thread <channel> <ts>`, standing
in a UUID or position (`--nth`) for the `ts` Slack would use:

```bash
bin/claude-conv thread zama                    # most recently active thread, in full
bin/claude-conv thread zama --nth 2            # the thread before that
bin/claude-conv thread zama --session 573496f4 # an exact thread (session UUID prefix)
bin/claude-conv thread zama --limit 20         # only its last 20 turns
bin/claude-conv thread zama --raw              # include thinking + tool_use/tool_result blocks
```

Compact mode (default) shows only genuine assistant prose and user text.
Stripped entirely: `<system-reminder>` and `<task-notification>` blocks,
slash-command wrappers (collapsed to `/name`), turns that were pure
tool-calling (no placeholder shown — just dropped), and a "user" turn that's
really a tool's injected payload rather than human input (Skill replies with
a short `tool_result` ack and then a *separate* follow-up `user` turn
carrying the full SKILL.md body as plain text — that follow-up is dropped
too). Subagent/sidechain forks are excluded unless `--include-subagents` is
passed. `--raw` disables all of this and shows everything, including thinking
and full tool_use/tool_result detail. Marks the thread read (see `unread`)
unless `--no-mark-read` is passed.

### `claude-conv search <text> [--project QUERY] [--limit N] [--json]`

Full-text search across session transcripts (all projects by default, or
scoped with `--project`). A cheap raw-bytes substring pre-filter runs before
any JSON parsing, so this stays fast even across a lot of history. Matches
anywhere in a transcript, one row per matching turn — for a title-only,
one-row-per-thread search see `find`.

### `claude-conv find <text> [--limit N] [--json]`

Find a thread **by name** — i.e. by its derived title — across every
project. Unlike `search` (matches anywhere, one row per matching turn),
`find` matches only the title and returns one row per thread, most recently
active first. This is the practical answer to "no title is stored" below:
the title *is* searchable, it's just derived rather than set.

### `claude-conv unread [--project QUERY] [--limit N] [--mark-all-read] [--json]`

List threads with activity you haven't seen yet, most recently active first.
This is local bookkeeping only (`~/.config/claude-conv-cli/read-state.json`,
override with `$CLAUDE_CONV_STATE_DIR`) — Claude Code itself has no concept
of read/unread. A thread you've never viewed in full (via `thread` or
`read --expand`) counts as unread by default, same as a message you've never
opened; new activity since the last time it was marked read makes it unread
again.

```bash
bin/claude-conv unread                        # everything unread, across every project
bin/claude-conv unread --project zama         # scoped to one project
bin/claude-conv unread --mark-all-read        # catch up in bulk instead of listing
```

The first run will likely show your whole history as unread (nothing has
ever been marked read yet) — run `unread --mark-all-read` once to start
clean, then normal usage keeps it current. `chats` shows a per-project
unread count and bare `read` prefixes unread rows with `●`.

### `claude-conv fork <query> [--nth N] [--session UUID] [--match N] [--yes]`

Continue a past thread as a **new** thread, via Claude Code's own
`claude --resume <uuid> --fork-session` — the original is left untouched,
exactly like branching in git. Resolves the thread the same way `thread`
does. **Defaults to a dry-run** that prints the resolved thread and the
command that would run; pass `--yes` to actually launch it (this replaces
the current process and hands the terminal off to a real, writable
interactive `claude` session — run it from an actual terminal, not scripted).

```bash
bin/claude-conv fork zama                     # dry-run: shows what would launch
bin/claude-conv fork zama --session 573496f4 --yes  # actually fork that thread
```

### `claude-conv send <query> <message> [--nth N] [--session UUID] [--match N] [--fork] [--permission-mode MODE] [--timeout SECS] [--yes] [--json]`

Send `<message>` into a thread non-interactively and print Claude's reply —
runs `claude --print --resume <uuid> <message>` from that thread's own
directory. **Without `--fork` this appends to the same thread**, exactly as
if you had resumed it in an interactive terminal and typed the message
yourself; pass `--fork` to branch into a new thread instead (same
`--fork-session` mechanism as `fork`, but the message is sent and the reply
captured immediately rather than opening a terminal).

```bash
bin/claude-conv send zama "what's the status of #229?"           # dry-run
bin/claude-conv send zama "what's the status of #229?" --yes     # actually sends, appends to that thread
bin/claude-conv send zama "try a different approach" --fork --yes  # sends into a NEW branch instead
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

## Notes

- **The directory name is not the source of truth.** Claude Code encodes a
  project's cwd by turning every `/` and `.` into `-`, which is lossy on its
  own (can't tell an encoded separator from a literal dash). This CLI instead
  reconciles the `cwd` values actually recorded inside each project's session
  files against the directory name (`_project_cwd`), so it correctly resolves
  distinct projects that collide under a naive decode — e.g. a git worktree
  session that started in the parent repo and only `cd`'d into
  `.claude/worktrees/<branch>` partway through.
- **A thread's own `cwd` can drift mid-conversation** (the agent runs `cd`,
  works in a subdirectory, etc.) — every event's `cwd` reflects the live shell
  state at that point, not a fixed identity.
- **No title is stored.** `find`/`read`/`thread` derive one from the first
  substantive user message.
- Every command supports `--json` for structured output.
