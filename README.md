# claude-conv-cli

Terminal access to your **own** Claude Code conversation history by reading
the local session transcripts read-only:

```bash
claude-conv chats                        # projects (channels) you've worked in, most recent first
claude-conv read "myproject"              # list every thread's anchor in that project
claude-conv thread "myproject"            # render the most recent thread in full
claude-conv read "myproject" --expand     # render EVERY thread in that project in full
claude-conv search "deploy-checklist"     # full-text search across everything
claude-conv find "deploy-checklist"       # find a thread by name (its derived title)
claude-conv fork "myproject" --yes        # continue a past thread interactively, as a new one
claude-conv send "myproject" "..." --yes  # send a message into a thread headlessly, print the reply
claude-conv unread                        # what's new since you last viewed it
```

Claude Code writes every session to
`~/.claude/projects/<cwd-encoded>/<session-uuid>.jsonl` — one JSON-lines file
per session, in (roughly) the Anthropic Messages API shape. Same shape as
Slack, one level up: a **project** (the directory you ran `claude` in) is a
**channel**, and a **session IS a thread** — an anchor message (its first
turn) plus every turn tied to it. The command set mirrors Slack's exactly:

| Slack | claude-conv-cli |
|---|---|
| `channels` | `chats` |
| `read <channel>` (flat) | bare `read <query>` (every thread's anchor) |
| `read <channel> --expand-thread` | `read <query> --expand` |
| `thread <channel> <ts>` | `thread <query>` (`--session`/`--nth` instead of a `ts`) |
| `search <query>` | `search <text>` |

Unlike Slack, there's no "loose message outside any thread" — every turn
belongs to some session, so a project has nothing to show beyond its
threads.

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
`bin/claude-conv` directly; the `#!/usr/bin/env -S uv run --script` shebang and
[PEP 723](https://peps.python.org/pep-0723/) inline metadata make `uv` pull
deps on the first run.

```bash
git clone <repo> claude-conv-cli
cd claude-conv-cli
./bin/claude-conv chats
```

**B — As an agent skill.** The repo ships a `SKILL.md` and the self-contained
`bin/claude-conv` launcher at the project root, in the
[Vercel Labs `skills`](https://github.com/vercel-labs/skills) format:

```bash
npx skills add <owner>/claude-conv-cli
```

This drops the skill under `~/.agents/skills/claude-conv-cli/` and symlinks it
into every supported agent runtime installed on your machine (Claude Code,
Cursor, Windsurf, Codex, Gemini CLI, …). Agents then drive the CLI by invoking
the bundled `bin/claude-conv` script directly.

To install locally for development instead, symlink the checkout so the skill
picks up live edits:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)" ~/.claude/skills/claude-conv-cli
```

## Usage

```bash
claude-conv chats                                     # projects/channels, most recently active first
claude-conv chats --limit 100 --json                  # everything, machine-readable
claude-conv read myproject                            # every thread's anchor: title, turns, timestamp
claude-conv read myproject --match 2                  # disambiguate when multiple projects match
claude-conv read myproject --expand                   # every thread in that project, in full
claude-conv read myproject --expand --limit 5         # cap to the 5 most recent threads, in full
claude-conv thread myproject                          # ONE thread in full — most recently active by default
claude-conv thread myproject --nth 2                  # the thread before the most recent one
claude-conv thread myproject --session a1b2c3d4       # an exact thread, by session-UUID prefix
claude-conv thread myproject --limit 20               # only its last 20 turns
claude-conv thread myproject --raw                    # include thinking + tool call/result blocks
claude-conv search "deploy-checklist"                 # full-text search across every project
claude-conv search "deploy-checklist" --project myproject  # scoped to one project
claude-conv find "deploy-checklist"                   # find a thread by its derived title (name)
claude-conv fork myproject                            # dry-run: shows the thread + command it'd launch
claude-conv fork myproject --session a1b2c3d4 --yes   # actually fork that thread
claude-conv send myproject "what's the status of #123?"          # dry-run
claude-conv send myproject "what's the status of #123?" --yes    # appends to that same thread
claude-conv send myproject "try another approach" --fork --yes   # sends into a NEW branch instead
claude-conv unread                                    # everything unread, across every project
claude-conv unread --project myproject                # scoped to one project
claude-conv unread --mark-all-read                    # catch up in bulk instead of listing
```

`claude-conv --help` lists every subcommand; `claude-conv <cmd> --help` for
per-command options including `--json`, `--limit`, `--match`, `--nth`,
`--session`, `--expand`, `--raw`, `--include-subagents`, `--fork`,
`--permission-mode`, `--yes`, `--no-mark-read`, `--mark-all-read`.

Every read command supports `--json` for structured output. `fork` and `send`
are the two that write: `fork` hands off to a real interactive `claude
--resume --fork-session` process (a brand-new session ID via Claude Code's
own fork mechanism); `send` does the headless equivalent via `claude --print
--resume`, and — unless `--fork` is passed — genuinely continues the *same*
thread, appending the reply exactly as an interactive resume would. Both
default to a dry-run, same convention as the personal-messaging CLIs' `send`
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
- **Project resolution doesn't trust the directory name.** Claude Code encodes
  a project's cwd by turning every `/` and `.` into `-`, which is lossy on its
  own — a literal dash in a folder name is indistinguishable from an encoded
  separator. Instead, this CLI scans the `cwd` values actually recorded across
  a project directory's session files and picks whichever one re-encodes to
  exactly that directory's name. This matters in practice: a git-worktree
  session can start in the parent repo and only `cd` into
  `.claude/worktrees/<branch>` partway through, and Claude Code still files
  the whole session under the worktree's encoded name — naively trusting a
  session's first `cwd` would collapse several distinct worktree projects
  onto the same (wrong) parent-repo path.
- **Compact rendering by default.** Only genuine user/assistant text is
  shown: `<system-reminder>` and `<task-notification>` blocks are stripped,
  slash-command wrappers collapse to `/name`, and a turn that was pure
  tool-calling is dropped entirely (no placeholder). Any "user" turn that's
  really injected content rather than something you typed is dropped too —
  detected as a *separate* follow-up `user` turn with no assistant turn in
  between, which never happens for genuine input. Two things produce this:
  Skill replies with a short `tool_result` ack then a follow-up turn carrying
  the full `SKILL.md` body as plain text; and typing `/name` sends the
  trigger turn, then Claude Code appends a follow-up turn with the slash
  command's entire expanded prompt body substituted in (otherwise a slash
  command reads as that one line, immediately followed by a wall of the
  command file's own instructions before the assistant ever replies). Pass
  `--raw` to disable all of this and see everything, including thinking
  blocks and full tool-call/tool-result detail.
- **Subagent forks are excluded by default** (`isSidechain: true` events) —
  pass `--include-subagents` to include them.
- **Search is a two-stage filter**: a substring check on raw file bytes before
  any JSON parsing, so a workspace with a lot of history stays fast to search.
- **No title is stored** — Claude Code doesn't persist a thread name (the
  ephemeral `~/.claude/sessions/<pid>.json` pointer file has one while a
  session is running, but it isn't written into the transcript itself), so
  `find`/`read`/`thread` all derive one from the first substantive user
  message instead.
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
- **Read/unread is local bookkeeping, not a Claude Code feature.** A small
  state file (`~/.config/claude-conv-cli/read-state.json`, override with
  `$CLAUDE_CONV_STATE_DIR`) maps each session UUID to the file mtime it was
  last read at; `thread`/`read --expand` update it (unless `--no-mark-read`),
  and a thread counts as unread if it's never in that map or its current
  mtime is newer than the recorded one. Deliberately kept out of `~/.claude`
  — Claude Code owns that directory and this CLI never writes into it.

## Dependencies

Declared inline via PEP 723 in `bin/claude-conv`:

- `click` — CLI framework

Everything else is Python stdlib (`json`, `re`, `pathlib`, …).

## Scope

Single-user personal tooling for **your own** Claude Code history on **your
own** machine. It reads local JSONL files you already have access to — there
is no network service, no account, and no way to read anyone else's
conversations. Cross-platform (pure file reads).

## See also

Same idea — your own messages, from the terminal, for other channels
(companion tools, same author):

- **imessage-cli** — your personal iMessage/SMS history
- **whatsapp-cli** — your personal WhatsApp chats (pairs as a linked device)
- **slack-user-cli** — Slack via your existing browser session credentials
