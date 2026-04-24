"use client";

import { useState } from "react";
import type { Agent, AgentRuntime } from "@/lib/types";
import { api } from "@/lib/api";

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function fmtCountdown(target: number | null): string | null {
  if (!target) return null;
  const sec = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AgentSidebar({
  agents,
  selectedId,
  onSelect,
  onNew,
}: {
  agents: { agent: Agent; runtime: AgentRuntime }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-zinc-500">agents</span>
        <button
          onClick={onNew}
          className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          + new
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {agents.length === 0 && (
          <div className="px-3 py-4 text-xs italic text-zinc-600">
            no agents yet — click &ldquo;+ new&rdquo; to create one
          </div>
        )}
        {agents.map(({ agent, runtime }) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            runtime={runtime}
            selected={agent.id === selectedId}
            onSelect={() => onSelect(agent.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function AgentRow({
  agent,
  runtime,
  selected,
  onSelect,
}: {
  agent: Agent;
  runtime: AgentRuntime;
  selected: boolean;
  onSelect: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const dot = runtime.alive
    ? "bg-emerald-400"
    : runtime.scheduledRestartAt
      ? "bg-amber-400 animate-pulse"
      : agent.enabled
        ? "bg-red-500"
        : "bg-zinc-600";

  const countdown = fmtCountdown(runtime.scheduledRestartAt);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer border-b border-zinc-900 px-3 py-2 ${
        selected ? "bg-zinc-900" : "hover:bg-zinc-900/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {agent.name}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 pl-4 text-[10px] text-zinc-500">
        <span>{agent.direction.kind === "file" ? "file" : "inline"}</span>
        <span>·</span>
        <span>{fmtUptime(runtime.uptimeSec)}</span>
        {countdown && (
          <>
            <span>·</span>
            <span className="text-amber-400">resume in {countdown}</span>
          </>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 pl-4 opacity-0 transition group-hover:opacity-100">
        <button
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void act(() => api.update(agent.id, { keepAlive: !agent.keepAlive }));
          }}
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            agent.keepAlive
              ? "bg-emerald-900/60 text-emerald-200 hover:bg-emerald-900"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
          title="when on, supervisor restarts on crash and waits out usage limits"
        >
          {agent.keepAlive ? "❤ keep-alive" : "○ keep-alive"}
        </button>
        {runtime.alive ? (
          <>
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void act(() => api.stop(agent.id));
              }}
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700"
            >
              stop
            </button>
            <button
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                void act(() => api.restart(agent.id));
              }}
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700"
            >
              restart
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void act(() => api.start(agent.id));
            }}
            className="rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] hover:bg-emerald-800"
          >
            start
          </button>
        )}
        <button
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            if (!confirm(`Delete agent "${agent.name}"?`)) return;
            void act(() => api.remove(agent.id));
          }}
          className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-red-900"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
