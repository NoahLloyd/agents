"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MessageSquare, ChevronDown, ChevronRight,
  Play, Square, RotateCcw, X, MoreHorizontal, Zap, ZapOff,
} from "lucide-react";
import type { Agent, AgentRuntime, ChatSession, Project } from "@/lib/types";
import { api } from "@/lib/api";

function collapsedKey(projectId: string): string {
  return `sidebar.collapsed.${projectId}`;
}

export default function AgentSidebar({
  projects,
  agents,
  chats,
  selectedId,
  connected,
  metaOpen,
  activeChatIds,
  streamingChatIds,
  onSelect,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onNewProject,
  onAddAgentToProject,
  onDeleteProject,
  onToggleMeta,
}: {
  projects: Project[];
  agents: { agent: Agent; runtime: AgentRuntime }[];
  chats: ChatSession[];
  selectedId: string | null;
  connected: boolean;
  metaOpen: boolean;
  activeChatIds: Set<string>;
  streamingChatIds: Set<string>;
  onSelect: (id: string) => void;
  onNewChat: (workingDir: string, projectName: string) => void;
  onOpenChat: (chatId: string, name: string, workingDir: string) => void;
  onDeleteChat: (chatId: string) => void;
  onNewProject: () => void;
  onAddAgentToProject: (workingDir: string) => void;
  onDeleteProject: (projectId: string) => void;
  onToggleMeta: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("sidebar.collapsed.")) {
          const id = k.slice("sidebar.collapsed.".length);
          init[id] = localStorage.getItem(k) === "1";
        }
      }
    } catch {}
    return init;
  });

  const toggleCollapse = (projectId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [projectId]: !prev[projectId] };
      try { localStorage.setItem(collapsedKey(projectId), next[projectId] ? "1" : "0"); } catch {}
      return next;
    });
  };

  const orphanAgents = agents.filter(
    ({ agent }) => !projects.some((p) => p.workingDir === agent.workingDir),
  );

  return (
    <aside className="flex h-full flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
        <span
          className={`flex-1 truncate text-xs uppercase tracking-wider ${connected ? "text-zinc-500" : "text-red-400"}`}
          title={connected ? "connected" : "ws disconnected"}
        >
          {connected ? "projects" : "projects · offline"}
        </span>
        <button
          onClick={onToggleMeta}
          title="Ask Meta (⌘K)"
          className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition ${
            metaOpen
              ? "bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          <MessageSquare size={13} strokeWidth={2.25} />
          Meta
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {projects.length === 0 && orphanAgents.length === 0 && (
          <div className="px-4 py-5 text-sm italic text-zinc-600">
            no projects yet — click &ldquo;+ new project&rdquo; below
          </div>
        )}

        {projects.map((project) => {
          const projectAgents = agents.filter((a) => a.agent.workingDir === project.workingDir);
          const projectChats = chats.filter((c) => c.workingDir === project.workingDir);
          const isOpen = !collapsed[project.id];

          return (
            <div key={project.id} className="border-b border-zinc-900">
              <div className="flex items-center gap-1 px-2 pt-2 pb-1">
                <button
                  onClick={() => toggleCollapse(project.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/60 text-left"
                >
                  {isOpen
                    ? <ChevronDown size={14} className="shrink-0 text-zinc-500" />
                    : <ChevronRight size={14} className="shrink-0 text-zinc-500" />
                  }
                  <span className="truncate text-sm font-semibold text-zinc-200">{project.name}</span>
                </button>
                <ProjectMenu project={project} onDelete={() => onDeleteProject(project.id)} />
              </div>

              {isOpen && (
                <div className="px-4 pb-1 font-mono text-[10px] text-zinc-600 truncate" title={project.workingDir}>
                  {project.workingDir}
                </div>
              )}

              {isOpen && (
                <div className="flex gap-2 px-4 pb-2">
                  <button
                    onClick={() => onAddAgentToProject(project.workingDir)}
                    className="flex flex-1 items-center justify-center rounded-md border border-zinc-700 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                  >
                    + agent
                  </button>
                  <button
                    onClick={() => onNewChat(project.workingDir, project.name)}
                    className="flex flex-1 items-center justify-center rounded-md border border-zinc-700 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                  >
                    + chat
                  </button>
                </div>
              )}

              {isOpen && (
                <div className="pb-2">
                  {projectAgents.map(({ agent, runtime }) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      runtime={runtime}
                      selected={agent.id === selectedId}
                      onSelect={() => onSelect(agent.id)}
                    />
                  ))}
                  {projectChats.map((chat) => (
                    <ChatRow
                      key={chat.id}
                      chat={chat}
                      active={activeChatIds.has(chat.id)}
                      streaming={streamingChatIds.has(chat.id)}
                      onClick={() => onOpenChat(chat.id, chat.name, chat.workingDir)}
                      onDelete={() => onDeleteChat(chat.id)}
                    />
                  ))}
                  {projectAgents.length === 0 && projectChats.length === 0 && (
                    <div className="px-6 pb-2 text-xs italic text-zinc-700">empty project</div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {orphanAgents.length > 0 && (
          <div className="border-b border-zinc-900">
            <div className="px-4 py-2 text-xs uppercase tracking-wider text-zinc-600">ungrouped</div>
            {orphanAgents.map(({ agent, runtime }) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                runtime={runtime}
                selected={agent.id === selectedId}
                onSelect={() => onSelect(agent.id)}
              />
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onNewProject}
        className="flex h-11 shrink-0 items-center gap-2 border-t border-zinc-800 px-4 text-left text-sm font-medium text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200 transition"
      >
        + new project
      </button>
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
    ? agent.keepAlive ? "bg-emerald-400" : "bg-sky-400"
    : runtime.scheduledRestartAt
      ? "bg-amber-400 animate-pulse"
      : agent.enabled ? "bg-red-500" : "bg-zinc-600";

  const isRunning = runtime.alive;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-2.5 px-4 py-2.5 ${selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/60"}`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">{agent.name}</span>

      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {/* Start / Stop */}
        <IconButton
          disabled={busy}
          onClick={() => act(isRunning ? () => api.stop(agent.id) : () => api.start(agent.id))}
          title={isRunning ? "stop" : "start"}
          className={isRunning ? "hover:text-red-400" : "text-emerald-500 hover:text-emerald-300"}
        >
          {isRunning ? <Square size={15} strokeWidth={2.5} /> : <Play size={15} strokeWidth={2.5} />}
        </IconButton>

        {/* Restart */}
        {isRunning && (
          <IconButton
            disabled={busy}
            onClick={() => act(() => api.restart(agent.id))}
            title="restart"
          >
            <RotateCcw size={15} strokeWidth={2.5} />
          </IconButton>
        )}

        {/* Keep-alive */}
        <IconButton
          disabled={busy}
          onClick={() => act(() => api.update(agent.id, { keepAlive: !agent.keepAlive }))}
          title={agent.keepAlive ? "keep-alive on (click to disable)" : "keep-alive off (click to enable)"}
          className={agent.keepAlive ? "text-emerald-400 hover:text-emerald-300" : "hover:text-zinc-300"}
        >
          {agent.keepAlive ? <Zap size={15} strokeWidth={2.5} /> : <ZapOff size={15} strokeWidth={2.5} />}
        </IconButton>

        {/* Delete */}
        <InlineConfirmButton onConfirm={() => { void api.remove(agent.id); }} title="delete agent">
          <X size={15} strokeWidth={2.5} />
        </InlineConfirmButton>
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  title,
  className = "",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded p-1.5 text-zinc-500 transition hover:bg-zinc-700 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function ChatRow({
  chat,
  active,
  streaming,
  onClick,
  onDelete,
}: {
  chat: ChatSession;
  active: boolean;
  streaming: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition ${
        active ? "bg-zinc-800/70" : "hover:bg-zinc-900/60"
      }`}
    >
      <MessageSquare
        size={14}
        strokeWidth={2}
        className={`shrink-0 ${active ? "text-sky-400" : "text-zinc-600"}`}
      />
      <span className={`min-w-0 flex-1 truncate text-sm ${active ? "text-zinc-200 font-medium" : "text-zinc-400"}`}>
        {chat.name}
      </span>
      {streaming && (
        <span className="flex shrink-0 gap-0.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
      )}
      <InlineConfirmButton
        onConfirm={(e) => { e.stopPropagation(); onDelete(); }}
        title="delete chat"
        className="opacity-0 group-hover:opacity-100"
      >
        <X size={13} strokeWidth={2.5} />
      </InlineConfirmButton>
    </div>
  );
}

function InlineConfirmButton({
  onConfirm,
  title,
  children,
  className = "",
}: {
  onConfirm: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 2000);
    } else {
      if (timer.current) clearTimeout(timer.current);
      setArmed(false);
      onConfirm(e);
    }
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      onClick={handleClick}
      title={armed ? "click again to confirm" : title}
      className={`rounded p-1.5 transition ${armed ? "bg-red-950/50 text-red-400" : "text-zinc-600 hover:bg-zinc-700 hover:text-red-400"} ${className}`}
    >
      {children}
    </button>
  );
}

function ProjectMenu({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 180;
    setPos({ top: rect.bottom + 2, left: Math.min(rect.left, window.innerWidth - menuWidth - 8) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="project options"
        className="rounded p-1.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-[180px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-xl"
        >
          <ConfirmMenuItem
            label="Delete project"
            confirmLabel="Really delete?"
            icon={<X size={14} strokeWidth={2} />}
            onClick={() => { setOpen(false); onDelete(); }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

function ConfirmMenuItem({ onClick, label, confirmLabel, icon }: {
  onClick: () => void;
  label: string;
  confirmLabel: string;
  icon?: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = () => {
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 2500);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      onClick();
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
        armed ? "bg-red-950/60 text-red-300" : "text-red-400 hover:bg-red-950/40"
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">{icon}</span>
      <span>{armed ? confirmLabel : label}</span>
    </button>
  );
}
