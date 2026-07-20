---
name: claude-conv-cli
description:
  "Read your own local Claude Code conversation history from the terminal via
  the bundled `bin/claude-conv` command. Claude Code writes every session to
  `~/.claude/projects/<cwd-encoded>/<uuid>.jsonl`; this CLI reads those files
  directly (read-only). `claude-conv chats` lists projects you've worked in,
  most recently active first, `claude-conv sessions <query>` lists individual
  sessions within a matched project, `claude-conv read <query>` renders a
  session as a dialogue (defaults to the most recent), `claude-conv search
  <text>` full-text-searches across everything, `claude-conv find <text>`
  locates a session by its derived title (name) across every project, and
  `claude-conv fork <query>` hands off to `claude --resume --fork-session` to
  continue a past session as a new one (dry-run by default). No auth, no
  network — it's a local file reader, the counterpart to
  imessage-cli/whatsapp-cli/slack-user-cli for your own Claude Code history.
  Use when the user wants to recall, search, review, or continue a past
  Claude Code conversation, session, or project's history."
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

There's no "chat partner" here — a **project** (the directory you ran `claude`
in) is the closest analog to a chat, and a **session** is one sitting within
it. `chats` lists projects; `sessions <query>` lists the sessions within one;
`read <query>` renders a session's transcript, defaulting to the most recent.

## When to use

Trigger when the user wants to **recall, search, or review a past Claude Code
conversation** — "what did we decide about X last week", "find that
conversation where I asked about Y", "show me the session where I built Z",
"how many sessions have I had in project W".

Everything except `fork` is read-only by construction. `fork` is the one
command that acts — it launches a real `claude` process — and defaults to a
dry-run, same convention as the personal-messaging CLIs' `send` commands.

## Commands

### `claude-conv chats [--limit N] [--json]`

List projects, most recently active first: real cwd (not the lossy encoded
directory name), session count, last-active timestamp.

### `claude-conv sessions <query> [--limit N] [--match N] [--json]`

List sessions within the project matching `<query>` (fuzzy against the real
cwd or the encoded directory name), most recently active first: short UUID,
turn count, and a derived title (the first substantive thing the user said —
Claude Code doesn't store a title). Ambiguous project matches print a numbered
list — pick with `--match N`.

### `claude-conv read <query> [--nth N] [--session UUID] [--limit N] [--raw] [--include-subagents] [--json]`

Render a session's transcript from the project matching `<query>`.

```bash
bin/claude-conv read zama                    # most recently active session in a "zama" project
bin/claude-conv read zama --match 2          # disambiguate when multiple projects match
bin/claude-conv read zama --nth 2            # the session before the most recent one
bin/claude-conv read zama --session 573496f4 # an exact session (UUID prefix)
bin/claude-conv read zama --limit 20         # only the last 20 turns
bin/claude-conv read zama --raw              # include thinking + tool_use/tool_result blocks
```

Compact mode (default) shows only assistant prose and user text, stripped of
`<system-reminder>` noise, with slash-command wrappers collapsed to `/name`;
a turn that was pure tool-calling collapses to `(used tool: X, Y — use --raw
for details)`. Subagent/sidechain forks are excluded unless
`--include-subagents` is passed.

### `claude-conv search <text> [--project QUERY] [--limit N] [--json]`

Full-text search across session transcripts (all projects by default, or
scoped with `--project`). A cheap raw-bytes substring pre-filter runs before
any JSON parsing, so this stays fast even across a lot of history.

### `claude-conv find <text> [--limit N] [--json]`

Find sessions **by name** — i.e. by their derived title — across every
project. Unlike `search` (matches anywhere, one row per matching turn), `find`
matches only the title and returns one row per session, most recently active
first. This is the practical answer to "no title is stored" below: the title
*is* searchable, it's just derived rather than set.

### `claude-conv fork <query> [--nth N] [--session UUID] [--match N] [--yes]`

Continue a past session as a **new** session, via Claude Code's own
`claude --resume <uuid> --fork-session` — the original session is left
untouched, exactly like branching in git. Resolves the session the same way
`read` does. **Defaults to a dry-run** that prints the resolved session and
the command that would run; pass `--yes` to actually launch it (this replaces
the current process and hands the terminal off to a real, writable
interactive `claude` session — run it from an actual terminal, not scripted).

```bash
bin/claude-conv fork zama                     # dry-run: shows what would launch
bin/claude-conv fork zama --session 573496f4 --yes  # actually fork that session
```

## Notes

- **The directory name is not the source of truth.** Claude Code encodes a
  project's cwd by turning every `/` and `.` into `-`, which is lossy on its
  own (can't tell an encoded separator from a literal dash). This CLI instead
  reconciles the `cwd` values actually recorded inside each project's session
  files against the directory name (`_project_cwd`), so it correctly resolves
  distinct projects that collide under a naive decode — e.g. a git worktree
  session that started in the parent repo and only `cd`'d into
  `.claude/worktrees/<branch>` partway through.
- **A session's own `cwd` can drift mid-conversation** (the agent runs `cd`,
  works in a subdirectory, etc.) — every event's `cwd` reflects the live shell
  state at that point, not a fixed session identity.
- **No title is stored.** `sessions`/`read` derive one from the first
  substantive user message.
- Every command supports `--json` for structured output.
