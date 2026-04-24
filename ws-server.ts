import path from "node:path";
import { randomUUID } from "node:crypto";
import chokidar from "chokidar";
import { VAULT } from "./lib/vault";
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
import type { Agent, FileChange, WsMessage } from "./lib/types";

const PORT = Number(process.env.WS_PORT ?? 4001);

type ClientData = { id: number };
let nextClientId = 1;

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

    // GET /agents — list
    if (url.pathname === "/agents" && req.method === "GET") {
      return json({ agents: listLive() });
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

function emitFileChange(kind: FileChange["kind"], absPath: string): void {
  const relPath = path.relative(VAULT, absPath);
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

const fileWatcher = chokidar.watch(VAULT, {
  ignored: (p: string) =>
    p.includes("/.git/") || p.endsWith("/logs") || p.includes("/state/claude.pid"),
  ignoreInitial: true,
  persistent: true,
});

fileWatcher
  .on("add", (p: string) => emitFileChange("add", p))
  .on("change", (p: string) => emitFileChange("change", p))
  .on("unlink", (p: string) => emitFileChange("unlink", p));
