```
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗███╗   ███╗ █████╗ ██╗██╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝████╗ ████║██╔══██╗██║██║
██║     ██║     ███████║██║   ██║██║  ██║█████╗  ██╔████╔██║███████║██║██║
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  ██║╚██╔╝██║██╔══██║██║██║
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗██║ ╚═╝ ██║██║  ██║██║███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
```

# ClaudeMail

**Multi-account profile manager for Claude Code.**

> Stop re-authenticating. Start switching.

If you're bouncing between two Gmail accounts, running Claude Code on multiple machines, or juggling work and personal identities — ClaudeMail lets you switch profiles in one command. Tokens stored securely in macOS Keychain. Config isolated per profile. Zero friction.

---

## The Problem

Claude Code supports one authenticated account at a time. Switching means:

```bash
claude auth logout
claude auth login --email other@gmail.com
# wait for browser... click... redirect... wait...
```

Every. Single. Time.

## The Solution

```bash
claudemail switch work
source ~/.claude/profiles/active.sh

# done. you're work@company.com now.
```

Or skip the shell entirely:

```bash
claudemail run personal -- -p "summarize my inbox"
```

---

## Quick Start

```bash
# Install
cd /path/to/claudemail && npm install

# Add your first profile (opens browser for OAuth)
claudemail add work --email you@company.com

# Add your second
claudemail add personal --email you@gmail.com

# Switch
claudemail switch work

# Or run a one-off with a specific profile
claudemail run personal -- -p "what's the weather?"
```

---

## Commands

### `claudemail add <name>`

Add a new profile. Three auth methods:

1. **Interactive login** — opens browser, captures token automatically
2. **Paste token** — paste an existing OAuth token or API key
3. **Capture current** — grabs the token from your active Claude session

```bash
claudemail add work --email jacob@company.com
claudemail add personal --email jacob@gmail.com
claudemail add api-account  # no email, paste an API key
```

### `claudemail list`

```
Profiles:

* work      jacob@company.com   [key]
    Last used: 2m ago
  personal  jacob@gmail.com     [key]
    Last used: 3h ago

Active: work (*)
```

### `claudemail switch <name>`

Sets the active profile. Writes a shell snippet to `~/.claude/profiles/active.sh`.

```bash
claudemail switch personal
source ~/.claude/profiles/active.sh
```

**Auto-activate in new terminals** — add to `~/.zshrc`:

```bash
[ -f ~/.claude/profiles/active.sh ] && source ~/.claude/profiles/active.sh
```

### `claudemail run <name> [-- claude args...]`

Run any `claude` command with a specific profile. No switching needed.

```bash
# Interactive session as work
claudemail run work

# One-shot prompt as personal
claudemail run personal -- -p "check my calendar"

# Auth status for a profile
claudemail run work -- auth status
```

### `claudemail status`

```
claudemail status

  Profiles: 2
  Active:   work
  Email:    jacob@company.com
  Token:    present
  Auth:     logged in
  Method:   oauth_token

Environment:
  CLAUDE_CODE_OAUTH_TOKEN: set
  CLAUDE_CONFIG_DIR:       ~/.claude/profiles/work
```

### `claudemail remove <name>`

Deletes the profile, its keychain entry, and its config directory. Asks for confirmation.

---

## How It Works

Each profile = **a named Keychain entry** + **an isolated config directory**.

```
~/.claude/profiles/
├── profiles.json          # Profile registry
├── active.sh              # Shell env for current profile
├── work/                  # CLAUDE_CONFIG_DIR for "work"
│   └── (sessions, history, settings...)
└── personal/              # CLAUDE_CONFIG_DIR for "personal"
    └── (sessions, history, settings...)

macOS Keychain:
  service: "claudemail"
  account: "work"      → OAuth token
  account: "personal"  → OAuth token
```

When you `switch` or `run`:
- `CLAUDE_CODE_OAUTH_TOKEN` is set to the profile's token (overrides Keychain auth)
- `CLAUDE_CONFIG_DIR` points to the profile's isolated directory (separate sessions, history, settings)

Claude Code respects both env vars natively. No patching, no hacks.

---

## Security

- **Tokens in macOS Keychain** — encrypted at rest, never in plaintext files
- **`active.sh` permissions** — created with `0o600` (owner-only read/write)
- **Shell escaping** — tokens wrapped in single quotes with proper escaping
- **Profile name validation** — alphanumeric, dash, underscore only. Path traversal blocked.
- **No token logging** — status command shows "present", never the actual token
- **`execFile()` everywhere** — no shell string interpolation in Keychain commands

---

## Requirements

- macOS (uses `security` CLI for Keychain access)
- Node.js 18+
- Claude Code installed (`claude` CLI available)

---

## Works Great With

### [WADE](https://github.com/JacobiusMakes/WADE-AI-Screen-Agent)

ClaudeMail manages your identities. WADE manages your screen. Together, Claude can check your work email, read a PR review, switch to your personal account, and reply — all without you touching a browser.

```bash
# In WADE chat:
> check my work email for PR reviews
  [search_gmail_messages {"query": "from:linagora.com is:unread"}]
  Found 3 unread from Linagora...
```

---

## License

MIT
