# agents

A local dashboard for running multiple Claude Code agents in parallel — each with its own working directory, direction (inline prompt or a markdown file it re-reads each turn), and keep-alive supervisor that auto-restarts on crash and auto-resumes when usage limits reset.

Built to replace a launchd-based heartbeat with something visible and controllable from a UI.

## Stack

- **Next.js 16** (App Router, Turbopack) on port `4000` — UI, file I/O API routes
- **Bun** WebSocket + HTTP server on port `4001` — agent supervisor, transcript streaming, file-change events
- **Claude Code CLI** spawned per agent (`--dangerously-skip-permissions`, configurable model / fallback / effort)
- **Tailwind v4**

## Features

- Multiple agents running concurrently, each with its own `workingDir`
- Two direction modes: inline prompt, or "re-read this markdown file each turn"
- Live transcript per agent (JSONL session file watching), with pause-on-scroll-up autoscroll
- Keep-alive supervisor: restarts on crash, parses `usage limit reached|<ts>` from stderr and auto-resumes after the reset
- Per-agent file activity + diff panel
- Pinned notes as tabs (fuzzy vault search when adding)
- Registry persisted to `data/agents.json`; PID files let the supervisor reattach to surviving children across reloads

## Run

```bash
bun install
bun dev            # starts Next (4000) + ws-server (4001) under concurrently
```

Open <http://localhost:4000>.

The supervisor detaches children and `unref`s them, so `bun --watch` reloads don't kill running agents — it re-attaches via PID files on next init.

## Cost

Agents run against the Claude Code CLI's OAuth credentials (Max plan). The supervisor explicitly strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `CLAUDE_CODE_OAUTH_TOKEN` from the child env to make sure no leaked API key can route a spawned agent to pay-per-token billing.
