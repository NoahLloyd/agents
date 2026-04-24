"use client";

import type { Agent } from "./types";

// Port the dev launcher assigned to ws-server.ts; falls back to 4001 for
// `start` / direct `dev:web` invocations that didn't go through scripts/dev.ts.
const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT ?? "4001";

export const WS_HTTP =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:${WS_PORT}`
    : `http://localhost:${WS_PORT}`;

export const WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:${WS_PORT}`
    : `ws://localhost:${WS_PORT}`;

async function jfetch<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => "")}`);
  return (await r.json()) as T;
}

export const api = {
  list: () => jfetch<{ agents: { agent: Agent; runtime: import("./types").AgentRuntime }[] }>(`${WS_HTTP}/agents`),
  create: (body: Partial<Agent>) =>
    jfetch<{ agent: Agent; runtime: import("./types").AgentRuntime }>(`${WS_HTTP}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<Agent>) =>
    jfetch<{ ok: boolean }>(`${WS_HTTP}/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    jfetch<{ ok: boolean }>(`${WS_HTTP}/agents/${id}`, { method: "DELETE" }),
  start: (id: string) =>
    jfetch<{ ok: boolean }>(`${WS_HTTP}/agents/${id}/start`, { method: "POST" }),
  stop: (id: string) =>
    jfetch<{ ok: boolean }>(`${WS_HTTP}/agents/${id}/stop`, { method: "POST" }),
  restart: (id: string) =>
    jfetch<{ ok: boolean }>(`${WS_HTTP}/agents/${id}/restart`, { method: "POST" }),
  events: (id: string, max = 200) =>
    jfetch<{ events: import("./types").TranscriptEvent[] }>(
      `${WS_HTTP}/agents/${id}/events?max=${max}`,
    ),
  claudeProcs: () =>
    jfetch<{
      procs: {
        pid: number;
        ppid: number;
        cpu: number;
        rssMb: number;
        cmd: string;
        agentName: string | null;
      }[];
    }>(`${WS_HTTP}/claude-procs`),
  readFile: (p: string) =>
    jfetch<{ content: string; path: string; mtimeMs: number }>(
      `/api/file?path=${encodeURIComponent(p)}`,
    ),
  writeFile: (p: string, content: string) =>
    jfetch<{ ok: boolean }>(`/api/file`, {
      method: "PUT",
      body: JSON.stringify({ path: p, content }),
    }),
};
