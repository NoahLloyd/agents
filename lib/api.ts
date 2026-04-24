"use client";

import type { Agent } from "./types";

export const WS_HTTP =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:4001`
    : "http://localhost:4001";

export const WS_URL =
  typeof window !== "undefined"
    ? `ws://${window.location.hostname}:4001`
    : "ws://localhost:4001";

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
