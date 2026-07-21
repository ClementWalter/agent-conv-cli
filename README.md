# claude-conv-cli

Terminal access to your **own** Claude Code conversation history by reading
the local session transcripts read-only:

```bash
claude-conv chats                   # projects you've worked in, most recent first
claude-conv sessions "zama"         # sessions within a matched project
claude-conv read "zama"             # render the most recent session as a dialogue
claude-conv search "vault-update"   # full-text search across everything
claude-conv find "vault-update"     # find a session by name (its derived title)
claude-conv fork "zama" --yes       # continue a past session interactively, as a new one
claude-conv send "zama" "..." --yes # send a message into a session headlessly, print the reply
```

Claude Code writes every session to
`~/.claude/projects/<cwd-encoded>/<session-uuid>.jsonl` — one JSON-lines file
per session, in (roughly) the Anthropic Messages API shape. There's no
"chat partner" here: a **project** (the directory you ran `claude` in) is the
closest analog to a chat, and a **session** is one sitting within it.

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
npx skills add ClementWalter/claude-conv-cli
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
claude-conv chats                        # projects, most recently active first
claude-conv chats --limit 100 --json     # everything, machine-readable
claude-conv sessions zama                # sessions within the "zama" project
claude-conv sessions zama --match 2      # disambiguate when multiple projects match
claude-conv read zama                    # render the most recent session
claude-conv read zama --nth 2            # the session before the most recent one
claude-conv read zama --session 573496f4 # an exact session, by UUID prefix
claude-conv read zama --limit 20         # only the last 20 turns
claude-conv read zama --raw              # include thinking + tool call/result blocks
claude-conv search "vault-update"        # full-text search across every project
claude-conv search "vault-update" --project zama  # scoped to one project
claude-conv find "vault-update"          # find a session by its derived title (name)
claude-conv fork zama                    # dry-run: shows the session + command it'd launch
claude-conv fork zama --session 573496f4 --yes  # actually fork that session
claude-conv send zama "what's the status of #229?"          # dry-run
claude-conv send zama "what's the status of #229?" --yes    # appends to that same session
claude-conv send zama "try another approach" --fork --yes   # sends into a NEW branch instead
```

`claude-conv --help` lists every subcommand; `claude-conv <cmd> --help` for
per-command options including `--json`, `--limit`, `--match`, `--nth`,
`--session`, `--raw`, `--include-subagents`, `--fork`, `--permission-mode`,
`--yes`.

Every read command supports `--json` for structured output. `fork` and `send`
are the two that write: `fork` hands off to a real interactive `claude
--resume --fork-session` process (a brand-new session ID via Claude Code's
own fork mechanism); `send` does the headless equivalent via `claude --print
--resume`, and — unless `--fork` is passed — genuinely continues the *same*
session, appending the reply exactly as an interactive resume would. Both
default to a dry-run, same convention as the personal-messaging CLIs' `send`
commands.

## How it works

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
- **Compact rendering by default.** Only user/assistant text is shown;
  `<system-reminder>` blocks are stripped, slash-command wrappers collapse to
  `/name`, and a turn that was pure tool-calling shows as a one-line summary.
  Pass `--raw` for thinking blocks and full tool-call/tool-result detail.
- **Subagent forks are excluded by default** (`isSidechain: true` events) —
  pass `--include-subagents` to include them.
- **Search is a two-stage filter**: a substring check on raw file bytes before
  any JSON parsing, so a workspace with a lot of history stays fast to search.
- **No title is stored** — Claude Code doesn't persist a session name (the
  ephemeral `~/.claude/sessions/<pid>.json` pointer file has one while a
  session is running, but it isn't written into the transcript itself), so
  `find`/`sessions`/`read` all derive one from the first substantive user
  message instead.
- **`fork` hands off to a real `claude` process** via `os.execvp`, replacing
  this script entirely so the resumed session gets a proper interactive
  terminal — it `cd`s to the original session's directory first, then runs
  `claude --resume <uuid> --fork-session`.
- **`send` uses `claude --print --resume` instead** (`subprocess.run`, not
  `execvp`, so it can capture the reply and return control to the caller) —
  no TTY needed. Verified live: forking a session with `--permission-mode
  plan` and a tool-free prompt returns a reply in a few seconds; the
  original session's turn count is untouched and a `--fork`'d branch (with
  the reply appended) appears alongside it.

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

Same idea — your own messages, from the terminal, for other channels:

- [imessage-cli](https://github.com/ClementWalter/imessage-cli) — your
  personal iMessage/SMS history
- [whatsapp-cli](https://github.com/ClementWalter/whatsapp-cli) — your
  personal WhatsApp chats (pairs as a linked device)
- [slack-user-cli](https://github.com/ClementWalter/slack-user-cli) — Slack
  via your existing browser session credentials
