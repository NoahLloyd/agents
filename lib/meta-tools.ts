import type Anthropic from "@anthropic-ai/sdk";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Agent } from "./types";

const WS_HTTP = process.env.WS_HTTP ?? "http://localhost:4001";
const HOME = process.env.HOME ?? "/Users/noah";

export type ToolContext = {
  onLog?: (line: string) => void;
};

type ToolExecutor = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<string>;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text) as T;
}

function safeHomePath(p: string): string | null {
  if (!p) return null;
  const abs = path.resolve(p.startsWith("~") ? p.replace(/^~/, HOME) : p);
  if (!abs.startsWith(HOME + "/") && abs !== HOME) return null;
  return abs;
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `exit ${code}`));
      else resolve(out);
    });
  });
}

function summarizeAgent(entry: {
  agent: Agent;
  runtime: {
    alive: boolean;
    pid: number | null;
    uptimeSec: number | null;
    sessionPath: string | null;
    rateLimitedUntil: number | null;
    scheduledRestartAt: number | null;
    lastExit: { ts: number } | null;
  };
}) {
  const { agent, runtime } = entry;
  const status = runtime.alive
    ? "running"
    : runtime.scheduledRestartAt
      ? "restarting"
      : runtime.rateLimitedUntil && runtime.rateLimitedUntil > Date.now()
        ? "rate-limited"
        : agent.enabled
          ? "stopped (enabled)"
          : "stopped";
  return {
    id: agent.id,
    name: agent.name,
    status,
    pid: runtime.pid,
    uptimeSec: runtime.uptimeSec,
    workingDir: agent.workingDir,
    direction: agent.direction,
    model: agent.model,
    effort: agent.effort,
    enabled: agent.enabled,
    keepAlive: agent.keepAlive,
    rateLimitedUntil: runtime.rateLimitedUntil
      ? new Date(runtime.rateLimitedUntil).toISOString()
      : null,
    scheduledRestartAt: runtime.scheduledRestartAt
      ? new Date(runtime.scheduledRestartAt).toISOString()
      : null,
    sessionPath: runtime.sessionPath,
  };
}

function formatEvent(ev: {
  kind: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  ts: number;
}): string {
  const time = new Date(ev.ts).toISOString().slice(11, 19);
  switch (ev.kind) {
    case "text":
      return `[${time}] assistant: ${ev.text ?? ""}`;
    case "thinking":
      return `[${time}] thinking: ${(ev.text ?? "").slice(0, 400)}`;
    case "tool_use": {
      const inp = JSON.stringify(ev.input ?? {});
      return `[${time}] tool_use ${ev.name}: ${inp.slice(0, 400)}`;
    }
    case "tool_result": {
      const c = (ev.content ?? "").slice(0, 600);
      return `[${time}] tool_result${ev.isError ? " (error)" : ""}: ${c}`;
    }
    case "system":
      return `[${time}] system`;
    case "result":
      return `[${time}] result`;
    default:
      return `[${time}] ${ev.kind}`;
  }
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_agents",
    description:
      "List every agent the dashboard knows about, with current runtime status (running / stopped / rate-limited / restarting), uptime, pid, workingDir, direction, model, and scheduling info. Call this first whenever the user asks about what's running.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_agent_events",
    description:
      "Fetch the recent transcript events for one agent — assistant text, thinking, tool calls, and tool results. Use this to answer 'what did X do' or 'what is X currently working on'. Events are ordered oldest→newest.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Agent UUID" },
        max: {
          type: "integer",
          description: "Max events to return (default 60, up to 500).",
        },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "create_agent",
    description:
      "Create and start a new agent. workingDir must be an absolute path inside the user's HOME. Direction is either an inline prompt or a markdown file path that will be re-read each turn.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        workingDir: { type: "string" },
        direction_kind: { type: "string", enum: ["inline", "file"] },
        prompt: {
          type: "string",
          description: "Required when direction_kind is 'inline'.",
        },
        filePath: {
          type: "string",
          description: "Required when direction_kind is 'file'.",
        },
        model: {
          type: "string",
          description:
            "Claude Code model id, default 'claude-opus-4-7'. Ask the user before deviating.",
        },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh", "max"],
          description: "Default 'max'.",
        },
        enabled: { type: "boolean", description: "Default true (spawns immediately)." },
        keepAlive: {
          type: "boolean",
          description: "Default true. Restart on crash and wait out rate limits.",
        },
      },
      required: ["name", "workingDir", "direction_kind"],
    },
  },
  {
    name: "update_agent",
    description:
      "Patch an existing agent's config. Partial — pass only the fields to change. To change direction, pass direction_kind plus prompt or filePath. Changes take effect on next spawn.",
    input_schema: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        name: { type: "string" },
        workingDir: { type: "string" },
        direction_kind: { type: "string", enum: ["inline", "file"] },
        prompt: { type: "string" },
        filePath: { type: "string" },
        model: { type: "string" },
        effort: { type: "string", enum: ["low", "medium", "high", "xhigh", "max"] },
        enabled: { type: "boolean" },
        keepAlive: { type: "boolean" },
      },
      required: ["agent_id"],
    },
  },
  {
    name: "start_agent",
    description: "Start a stopped agent (sets enabled=true and spawns).",
    input_schema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
  },
  {
    name: "stop_agent",
    description: "Stop a running agent (sets enabled=false and kills the process).",
    input_schema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
  },
  {
    name: "restart_agent",
    description:
      "Kill and respawn an agent immediately. Useful when direction or model changed and you want the update to take effect now.",
    input_schema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
  },
  {
    name: "delete_agent",
    description:
      "Permanently remove an agent from the registry. This kills the process and deletes the config entry. Confirm destructive intent with the user before calling.",
    input_schema: {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a file under the user's HOME directory. Useful for reading an agent's direction markdown, a README, or recent log output.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path inside $HOME." },
        tail_lines: {
          type: "integer",
          description: "If set, return only the last N lines (useful for logs).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "git_log",
    description:
      "Show the last commits in an agent's working directory. Use to answer 'what has agent X committed recently'.",
    input_schema: {
      type: "object",
      properties: {
        workingDir: { type: "string", description: "Absolute path to a git repo." },
        count: { type: "integer", description: "Default 10." },
      },
      required: ["workingDir"],
    },
  },
  {
    name: "git_diff",
    description:
      "Show the pending (uncommitted) diff in an agent's working directory. Use to see what an agent is currently working on that isn't committed yet.",
    input_schema: {
      type: "object",
      properties: {
        workingDir: { type: "string" },
        max_chars: { type: "integer", description: "Truncate after N chars (default 6000)." },
      },
      required: ["workingDir"],
    },
  },
];

const EXECUTORS: Record<string, ToolExecutor> = {
  async list_agents() {
    const { agents } = await fetchJson<{
      agents: Parameters<typeof summarizeAgent>[0][];
    }>(`${WS_HTTP}/agents`);
    return JSON.stringify(agents.map(summarizeAgent), null, 2);
  },

  async get_agent_events(input) {
    const id = String(input.agent_id);
    const max = Math.min(500, Number(input.max ?? 60));
    const { events } = await fetchJson<{
      events: Parameters<typeof formatEvent>[0][];
    }>(`${WS_HTTP}/agents/${id}/events?max=${max}`);
    if (events.length === 0) return "(no transcript events yet)";
    return events.map(formatEvent).join("\n");
  },

  async create_agent(input) {
    const kind = String(input.direction_kind);
    let direction;
    if (kind === "inline") {
      if (!input.prompt) throw new Error("prompt required for direction_kind='inline'");
      direction = { kind: "inline", prompt: String(input.prompt) };
    } else if (kind === "file") {
      if (!input.filePath) throw new Error("filePath required for direction_kind='file'");
      direction = { kind: "file", filePath: String(input.filePath) };
    } else {
      throw new Error(`unknown direction_kind: ${kind}`);
    }
    const body: Partial<Agent> = {
      name: String(input.name),
      workingDir: String(input.workingDir),
      direction: direction as Agent["direction"],
      model: input.model ? String(input.model) : "claude-opus-4-7",
      fallbackModel: "claude-opus-4-6",
      effort: (input.effort as Agent["effort"]) ?? "max",
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      keepAlive: input.keepAlive === undefined ? true : Boolean(input.keepAlive),
    };
    const res = await fetchJson<{ agent: Agent }>(`${WS_HTTP}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return JSON.stringify(
      { ok: true, id: res.agent.id, name: res.agent.name },
      null,
      2,
    );
  },

  async update_agent(input) {
    const id = String(input.agent_id);
    const patch: Partial<Agent> = {};
    if (input.name !== undefined) patch.name = String(input.name);
    if (input.workingDir !== undefined) patch.workingDir = String(input.workingDir);
    if (input.direction_kind !== undefined) {
      const kind = String(input.direction_kind);
      if (kind === "inline") {
        if (!input.prompt) throw new Error("prompt required when changing to inline");
        patch.direction = { kind: "inline", prompt: String(input.prompt) };
      } else {
        if (!input.filePath) throw new Error("filePath required when changing to file");
        patch.direction = { kind: "file", filePath: String(input.filePath) };
      }
    }
    if (input.model !== undefined) patch.model = String(input.model);
    if (input.effort !== undefined) patch.effort = input.effort as Agent["effort"];
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    if (input.keepAlive !== undefined) patch.keepAlive = Boolean(input.keepAlive);
    await fetchJson(`${WS_HTTP}/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return "ok";
  },

  async start_agent(input) {
    await fetchJson(`${WS_HTTP}/agents/${String(input.agent_id)}/start`, {
      method: "POST",
    });
    return "started";
  },

  async stop_agent(input) {
    await fetchJson(`${WS_HTTP}/agents/${String(input.agent_id)}/stop`, {
      method: "POST",
    });
    return "stopped";
  },

  async restart_agent(input) {
    await fetchJson(`${WS_HTTP}/agents/${String(input.agent_id)}/restart`, {
      method: "POST",
    });
    return "restarted";
  },

  async delete_agent(input) {
    await fetchJson(`${WS_HTTP}/agents/${String(input.agent_id)}`, {
      method: "DELETE",
    });
    return "deleted";
  },

  async read_file(input) {
    const abs = safeHomePath(String(input.path));
    if (!abs) throw new Error("path must be absolute and inside $HOME");
    const s = await stat(abs);
    if (!s.isFile()) throw new Error("not a file");
    const content = await readFile(abs, "utf8");
    const tail = Number(input.tail_lines ?? 0);
    if (tail > 0) {
      const lines = content.split("\n");
      return lines.slice(-tail).join("\n");
    }
    if (content.length > 20_000) {
      return content.slice(0, 20_000) + "\n... (truncated, file is larger)";
    }
    return content;
  },

  async git_log(input) {
    const cwd = safeHomePath(String(input.workingDir));
    if (!cwd) throw new Error("workingDir must be inside $HOME");
    const count = Number(input.count ?? 10);
    const log = await runGit(
      ["log", `--pretty=format:%h %ci %s`, `-${count}`],
      cwd,
    );
    return log || "(no commits)";
  },

  async git_diff(input) {
    const cwd = safeHomePath(String(input.workingDir));
    if (!cwd) throw new Error("workingDir must be inside $HOME");
    const max = Number(input.max_chars ?? 6000);
    const diff = await runGit(["diff", "--stat", "HEAD"], cwd);
    const full = await runGit(["diff", "HEAD"], cwd);
    const combined = `${diff}\n---\n${full}`;
    if (combined.length > max) {
      return combined.slice(0, max) + "\n... (truncated)";
    }
    return combined || "(no pending changes)";
  },
};

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<{ content: string; isError: boolean }> {
  const fn = EXECUTORS[name];
  if (!fn) return { content: `unknown tool: ${name}`, isError: true };
  try {
    const content = await fn(input, ctx);
    return { content, isError: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: `error: ${msg}`, isError: true };
  }
}
