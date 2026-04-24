import path from "node:path";
import { randomUUID } from "node:crypto";
import chokidar from "chokidar";
import { getVaultDir } from "./lib/vault";
import { getConfig, updateConfig } from "./lib/config";
import {
  init as initSupervisor,
  setBroadcaster,
  listLive,
  getInitialEvents,
  createAgent,
  updateAgent,
  removeAgent,
  startAgent,
  stopAgent,
  restartAgent,
} from "./lib/supervisor";
import {
  startAutoCommit,
  tickOnce,
  type DirsByAgent,
} from "./lib/git-autocommit";
import type { Agent, FileChange, WsMessage } from "./lib/types";

const PORT = Number(process.env.WS_PORT ?? 4001);

type ClientData = { id: number };
let nextClientId = 1;

/**
 * Pull the path to the `claude` binary out of a full ps command line.
 * ps paths can include spaces (e.g. "Application Support") so we match
 * everything up to and including `/claude` that precedes a space or EOL.
 */
function extractClaudePath(cmd: string): string {
  const m = cmd.match(/(\S(?:[^\n]*?))\/claude(?=\s|$)/);
  return m ? `${m[1]}/claude` : "claude";
}

function classifyClaudeSource(claudePath: string, cmd: string): string {
  if (claudePath.includes("/com.conductor.app/")) return "conductor";
  if (claudePath.includes("/Claude/claude-code/")) return "desktop";
  if (claudePath.endsWith("/.bun/bin/claude")) return "agent-dashboard";
  if (/ --resume /.test(cmd)) return "cli (resumed)";
  if (/ -p /.test(cmd)) return "cli (headless)";
  return "cli";
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

const server = Bun.serve<ClientData, never>({
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/ws") {
      const id = nextClientId++;
      if (srv.upgrade(req, { data: { id } })) return;
      return new Response("agents-ws", { status: 200 });
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // GET /config — app-wide settings
    if (url.pathname === "/config" && req.method === "GET") {
      return json(getConfig());
    }

    // PATCH /config — update app-wide settings
    if (url.pathname === "/config" && req.method === "PATCH") {
      const body = (await req.json()) as Partial<import("./lib/config").AppConfig>;
      return json(updateConfig(body));
    }

    // GET /agents — list
    if (url.pathname === "/agents" && req.method === "GET") {
      return json({ agents: listLive() });
    }

    // POST /autocommit — run a tick now (for testing or a "commit now" button)
    if (url.pathname === "/autocommit" && req.method === "POST") {
      const results = await tickOnce(runningDirsByAgent, onAutoCommitResult);
      return json({ results });
    }

    // GET /claude-procs — enumerate claude CLI processes on this machine and
    // flag which ones this dashboard manages.
    if (url.pathname === "/claude-procs" && req.method === "GET") {
      const proc = Bun.spawnSync({
        cmd: ["ps", "-axo", "pid,ppid,pcpu,rss,command"],
      });
      const out = new TextDecoder().decode(proc.stdout);
      const self = process.pid;
      const rows: {
        pid: number;
        ppid: number;
        cpu: number;
        rssMb: number;
        cmd: string;
        source: string;
      }[] = [];
      for (const line of out.split("\n").slice(1)) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const ppid = Number(m[2]);
        const cpu = Number(m[3]);
        const rssKb = Number(m[4]);
        const cmd = m[5];
        if (pid === self) continue;
        // Paths in `ps` output can have embedded spaces (e.g., `Application
        // Support`), so we can't split on whitespace to get the binary.
        // Instead: the claude CLI binary is always spelled lowercase
        // `claude`; its path ends with `/claude` and is followed by either
        // whitespace (args) or end-of-string. The Electron app uses
        // capital-C `Claude` so case-sensitive matching excludes it.
        const match = cmd.match(/(^|[/\s])(\S*\/)?claude(\s|$)/);
        if (!match) continue;
        // Skip the macOS `disclaimer` launcher wrapper, which shows the
        // inner claude path as its argument — it would otherwise double-
        // count alongside the real claude process it spawns.
        if (/\/disclaimer\s/.test(cmd)) continue;
        if (/Claude Helper/.test(cmd)) continue;
        if (/^(?:ps|grep)\b/.test(cmd)) continue;
        // Extract the binary path so we can classify the source.
        const claudePath = extractClaudePath(cmd);
        rows.push({
          pid,
          ppid,
          cpu,
          rssMb: Math.round(rssKb / 1024),
          cmd,
          source: classifyClaudeSource(claudePath, cmd),
        });
      }
      const live = listLive();
      const pidToAgent = new Map<number, string>();
      for (const l of live) {
        if (l.runtime.pid != null) pidToAgent.set(l.runtime.pid, l.agent.name);
      }
      const procs = rows.map((r) => ({
        ...r,
        agentName: pidToAgent.get(r.pid) ?? pidToAgent.get(r.ppid) ?? null,
      }));
      return json({ procs });
    }

    // POST /agents — create
    if (url.pathname === "/agents" && req.method === "POST") {
      const body = (await req.json()) as Partial<Agent>;
      if (!body.name || !body.workingDir || !body.direction) {
        return json({ error: "name, workingDir, direction required" }, 400);
      }
      const agent: Agent = {
        id: randomUUID(),
        name: body.name,
        workingDir: body.workingDir,
        direction: body.direction,
        model: body.model ?? "claude-opus-4-7",
        fallbackModel: body.fallbackModel ?? "claude-opus-4-6",
        effort: body.effort ?? "max",
        enabled: body.enabled ?? true,
        keepAlive: body.keepAlive ?? true,
        createdAt: Date.now(),
      };
      const la = createAgent(agent);
      return json({ agent: la.agent, runtime: la.runtime }, 201);
    }

    // /agents/:id ...
    const m = url.pathname.match(/^\/agents\/([^/]+)(?:\/([^/]+))?$/);
    if (m) {
      const id = m[1];
      const action = m[2];
      if (!action && req.method === "PATCH") {
        const body = (await req.json()) as Partial<Agent>;
        const ok = updateAgent(id, body);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (!action && req.method === "DELETE") {
        const ok = removeAgent(id);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (action === "start" && req.method === "POST") {
        const ok = startAgent(id);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (action === "stop" && req.method === "POST") {
        const ok = stopAgent(id);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (action === "restart" && req.method === "POST") {
        const ok = restartAgent(id);
        return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      if (action === "events" && req.method === "GET") {
        const max = Number(url.searchParams.get("max") ?? 200);
        return json({ events: getInitialEvents(id, max) });
      }
    }

    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      console.log(`[ws] client ${ws.data.id} connected`);
      ws.subscribe("events");
      const snapshot: WsMessage = {
        type: "agents_snapshot",
        agents: listLive(),
      };
      ws.send(JSON.stringify(snapshot));
    },
    message(ws, msg) {
      console.log(`[ws] client ${ws.data.id} sent: ${msg.toString().slice(0, 100)}`);
    },
    close(ws) {
      console.log(`[ws] client ${ws.data.id} disconnected`);
    },
  },
});

console.log(`[ws] listening on http://localhost:${PORT}`);

function broadcast(msg: WsMessage): void {
  server.publish("events", JSON.stringify(msg));
}

setBroadcaster(broadcast);
initSupervisor();

setInterval(() => {
  broadcast({ type: "agents_snapshot", agents: listLive() });
}, 5000);

function runningDirsByAgent(): DirsByAgent {
  const dirs: DirsByAgent = new Map();
  for (const { agent, runtime } of listLive()) {
    if (!runtime.alive) continue;
    const list = dirs.get(agent.workingDir) ?? [];
    if (!list.includes(agent.name)) list.push(agent.name);
    dirs.set(agent.workingDir, list);
  }
  return dirs;
}

function onAutoCommitResult(info: import("./lib/types").AutoCommitInfo): void {
  const tag = info.hash ? ` ${info.hash}` : "";
  const pushTag = info.pushed
    ? " pushed"
    : info.state === "committed"
      ? " (push failed)"
      : "";
  console.log(
    `[autocommit] ${info.workingDir} → ${info.state}${tag}${pushTag}${
      info.message ? ` · ${info.message}` : ""
    }`,
  );
  broadcast({ type: "auto_commit", info });
}

startAutoCommit({
  getRunningDirs: runningDirsByAgent,
  onResult: onAutoCommitResult,
});

function emitFileChange(kind: FileChange["kind"], absPath: string): void {
  const relPath = path.relative(getVaultDir(), absPath);
  if (relPath.startsWith(".git") || relPath.startsWith("logs")) return;
  let agentId: string | null = null;
  for (const { agent } of listLive()) {
    if (absPath.startsWith(agent.workingDir + path.sep)) {
      agentId = agent.id;
      break;
    }
  }
  broadcast({
    type: "file",
    agentId,
    change: { path: absPath, relPath, kind, ts: Date.now() },
  });
}

const fileWatcher = chokidar.watch(getVaultDir(), {
  ignored: (p: string) =>
    p.includes("/.git/") || p.endsWith("/logs") || p.includes("/state/claude.pid"),
  ignoreInitial: true,
  persistent: true,
});

fileWatcher
  .on("add", (p: string) => emitFileChange("add", p))
  .on("change", (p: string) => emitFileChange("change", p))
  .on("unlink", (p: string) => emitFileChange("unlink", p));
