<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploying changes to this app

This dashboard runs as a persistent systemd user service (`agents.service`) at **http://localhost:4000**. When asked to make changes to the app itself, follow this sequence:

1. **Edit** the source files as needed.
2. **Restart the service**: `systemctl --user restart agents.service`
   - The unit's `ExecStartPre` runs `bun run build` automatically — the restart will fail if the build fails (TypeScript errors, etc.), so check `journalctl --user -u agents.service` if it doesn't come back up.
   - This restarts **only Next.js**. The WebSocket server (`agents-ws.service`) keeps running, so supervisor agents are unaffected.
   - The unit is defined in `~/.config/systemd/user/agents.service`. It runs `bun scripts/web.ts`, which starts Next.js on port 4000.
   - `Restart=always` respawns it on crash; linger is enabled for `noah` so it autostarts at boot.
3. **Verify**: wait ~30 seconds (build + start), then check `curl -s http://localhost:4000 | head -5` to confirm it's back up.

> **Don't run `bun run dev` (or `next dev`) in `/srv/agents/repos/agents`** — it overwrites `.next/` with a turbopack/dev layout that has no `BUILD_ID`, breaking `next start`. Use a separate worktree for dev.

The supervisor logic lives in `lib/supervisor.ts`. The WebSocket server is `ws-server.ts`. The MCP server (used by the Houston meta-agent) is `mcp-houston.ts`.
