"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Settings } from "lucide-react";
import type { Agent, AgentRuntime } from "@/lib/types";
import { api } from "@/lib/api";
import ClaudeInstances from "./ClaudeInstances";

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
  connected,
  metaOpen,
  onSelect,
  onNew,
  onOpenInNewTab,
  onToggleMeta,
  onOpenSettings,
  onOpenAgentSettings,
}: {
  agents: { agent: Agent; runtime: AgentRuntime }[];
  selectedId: string | null;
  connected: boolean;
  metaOpen: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenInNewTab?: (id: string) => void;
  onToggleMeta: () => void;
  onOpenSettings: () => void;
  onOpenAgentSettings: (agentId: string) => void;
}) {
  return (
    <aside className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <span
          className={`flex-1 truncate text-xs uppercase tracking-wider ${
            connected ? "text-zinc-500" : "text-red-400"
          }`}
          title={connected ? "connected" : "ws disconnected"}
        >
          {connected ? "agents" : "agents · offline"}
        </span>
        <button
          onClick={onToggleMeta}
          title="Ask Meta (⌘K)"
          className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] transition ${
            metaOpen
              ? "bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          <MessageSquare size={10} strokeWidth={2.25} />
          Meta
        </button>
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
            onSelect={(meta) =>
              meta && onOpenInNewTab ? onOpenInNewTab(agent.id) : onSelect(agent.id)
            }
            onOpenSettings={() => onOpenAgentSettings(agent.id)}
          />
        ))}
        <ClaudeInstances />
      </div>
      <button
        onClick={onOpenSettings}
        disabled={!selectedId}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-zinc-800 px-3 text-left text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent"
        title={selectedId ? "Agent settings" : "Select an agent to open its settings"}
      >
        <Settings size={12} />
        <span>settings</span>
      </button>
    </aside>
  );
}

function AgentRow({
  agent,
  runtime,
  selected,
  onSelect,
  onOpenSettings,
}: {
  agent: Agent;
  runtime: AgentRuntime;
  selected: boolean;
  onSelect: (openInNewTab: boolean) => void;
  onOpenSettings: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const dot = runtime.alive
    ? agent.keepAlive ? "bg-emerald-400" : "bg-sky-400"
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

  // Primary action: start when stopped, stop when running. When waiting to
  // auto-resume, stop cancels the schedule (stop API disables + clears it).
  const primary = runtime.alive
    ? {
        icon: "◼",
        title: "stop",
        colorClass: "text-zinc-400 hover:text-red-400",
        run: () => act(() => api.stop(agent.id)),
      }
    : {
        icon: "▶",
        title: runtime.scheduledRestartAt ? "start now" : "start",
        colorClass: "text-emerald-500 hover:text-emerald-300",
        run: () => act(() => api.start(agent.id)),
      };

  return (
    <div
      onClick={(e) => onSelect(e.metaKey || e.ctrlKey)}
      className={`group cursor-pointer border-b border-zinc-900 px-3 py-2 ${
        selected ? "bg-zinc-900" : "hover:bg-zinc-900/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {agent.name}
        </span>
        <button
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void primary.run();
          }}
          title={primary.title}
          className={`text-[11px] opacity-60 transition hover:opacity-100 group-hover:opacity-100 ${primary.colorClass}`}
        >
          {primary.icon}
        </button>
        <AgentMenu
          agent={agent}
          runtime={runtime}
          busy={busy}
          onAction={act}
          onOpenSettings={onOpenSettings}
        />
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
    </div>
  );
}

function AgentMenu({
  agent,
  runtime,
  busy,
  onAction,
  onOpenSettings,
}: {
  agent: Agent;
  runtime: AgentRuntime;
  busy: boolean;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 180;
    setPos({
      top: rect.bottom + 2,
      left: Math.min(rect.left, window.innerWidth - menuWidth - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !btnRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = async (fn: () => Promise<unknown>) => {
    setOpen(false);
    await onAction(fn);
  };

  return (
    <>
      <button
        ref={btnRef}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="more actions"
        className="text-zinc-500 opacity-60 hover:text-zinc-200 group-hover:opacity-100"
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
            className="z-50 w-[180px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-xl"
          >
            {runtime.alive && (
              <MenuItem
                onClick={() => void run(() => api.restart(agent.id))}
                label="Restart"
                icon="↻"
              />
            )}
            <MenuItem
              onClick={() =>
                void run(() => api.update(agent.id, { keepAlive: !agent.keepAlive }))
              }
              label={agent.keepAlive ? "Keep-alive on" : "Keep-alive"}
              icon={agent.keepAlive ? "✓" : ""}
              iconClass={agent.keepAlive ? "text-emerald-400" : ""}
              hint="auto-restart on crash, auto-resume after usage limit"
            />
            <MenuItem
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              label="Settings…"
              icon="⚙"
            />
            <div className="my-1 border-t border-zinc-800" />
            <MenuItem
              onClick={() => {
                if (!confirm(`Delete agent "${agent.name}"?`)) return;
                void run(() => api.remove(agent.id));
              }}
              label="Delete"
              icon="✕"
              destructive
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  onClick,
  label,
  icon,
  iconClass,
  hint,
  destructive,
}: {
  onClick: () => void;
  label: string;
  icon?: string;
  iconClass?: string;
  hint?: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
        destructive
          ? "text-red-400 hover:bg-red-950/40"
          : "text-zinc-200 hover:bg-zinc-800"
      }`}
    >
      <span className={`inline-block w-3 text-center ${iconClass ?? ""}`}>
        {icon ?? ""}
      </span>
      <span>{label}</span>
    </button>
  );
}
