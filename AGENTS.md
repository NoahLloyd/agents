<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Deploying changes to this app

This dashboard runs as a persistent launchd service (`com.noah.agents`) at **http://localhost:4000**. When asked to make changes to the app itself, follow this sequence:

1. **Edit** the source files as needed.
2. **Build**: `bun run build` (runs `next build` — must succeed before proceeding).
3. **Restart the service**: `launchctl stop com.noah.agents && launchctl start com.noah.agents`
   - The service is defined in `~/Library/LaunchAgents/com.noah.agents.plist`.
   - It runs `bun scripts/prod.ts`, which starts Next.js on port 4000 and the WebSocket server on port 4001.
   - launchd's `KeepAlive` will respawn it automatically after the stop.
4. **Verify**: wait ~5 seconds, then check `curl -s http://localhost:4000 | head -5` to confirm it's back up.

The supervisor logic lives in `lib/supervisor.ts`. The WebSocket server is `ws-server.ts`. The MCP server (used by the Houston meta-agent) is `mcp-houston.ts`.
