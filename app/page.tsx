"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Transcript from "@/components/Transcript";
import FileActivity from "@/components/FileActivity";
import PinnedNotes from "@/components/PinnedNotes";
import AgentSidebar from "@/components/AgentSidebar";
import NewAgentDialog from "@/components/NewAgentDialog";
import NewProjectDialog from "@/components/NewProjectDialog";
import MetaAgentChat from "@/components/MetaAgentChat";
import TabBar, { type Tab } from "@/components/TabBar";
import FileViewer from "@/components/FileViewer";
import SettingsPage from "@/components/SettingsPage";
import AgentChat from "@/components/AgentChat";
import { useWs } from "@/lib/use-ws";
import { api, WS_URL } from "@/lib/api";
import type {
  Agent,
  AgentRuntime,
  AutoCommitInfo,
  ChatSession,
  TranscriptEvent,
  FileChange,
  Project,
  WsMessage,
} from "@/lib/types";

const FILE_TTL_MS = 60_000;
const SELECTED_KEY = "agents.selectedId.v1";
const META_OPEN_KEY = "meta-agent.open.v1";
const NOTES_COLLAPSED_KEY = "agents.notesCollapsed.v1";
const ACTIVITY_COLLAPSED_KEY = "agents.activityCollapsed.v1";

type AgentEntry = { agent: Agent; runtime: AgentRuntime };

type MainView =
  | { kind: "agent"; agentId: string }
  | { kind: "chat"; chatId: string; workingDir: string; displayName: string };

type FileTab = {
  id: string;
  workingDir: string;
  hash: string;
  filePath: string | null;
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SHORTCUTS = [
  { key: "?",           desc: "Show shortcuts" },
  { key: "⌘K / Ctrl+K", desc: "Toggle Meta agent" },
  { key: "Esc",         desc: "Close panel / dialog" },
  { key: "⌘W / Ctrl+W", desc: "Close active file tab" },
];

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView | null>(null);
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [eventsByAgent, setEventsByAgent] = useState<Record<string, TranscriptEvent[]>>({});
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newAgentWorkingDir, setNewAgentWorkingDir] = useState<string | undefined>(undefined);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [commitByDir, setCommitByDir] = useState<Record<string, AutoCommitInfo>>({});
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [, setTick] = useState(0);
  const [streamingChat, setStreamingChat] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(META_OPEN_KEY) === "1") setMetaOpen(true); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(META_OPEN_KEY, metaOpen ? "1" : "0"); } catch {}
  }, [metaOpen]);

  useEffect(() => {
    try {
      if (localStorage.getItem(NOTES_COLLAPSED_KEY) === "1") setNotesCollapsed(true);
      if (localStorage.getItem(ACTIVITY_COLLAPSED_KEY) === "1") setActivityCollapsed(true);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(NOTES_COLLAPSED_KEY, notesCollapsed ? "1" : "0"); } catch {} }, [notesCollapsed]);
  useEffect(() => { try { localStorage.setItem(ACTIVITY_COLLAPSED_KEY, activityCollapsed ? "1" : "0"); } catch {} }, [activityCollapsed]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMetaOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (metaOpen) { setMetaOpen(false); return; }
        return;
      }
      if (e.key === "?" && !mod && !inInput) {
        setShowShortcuts((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeFileTabId) {
          setFileTabs((prev) => prev.filter((t) => t.id !== activeFileTabId));
          setActiveFileTabId(null);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [metaOpen, showShortcuts, activeFileTabId]);

  // Persist selection
  useEffect(() => {
    const saved = localStorage.getItem(SELECTED_KEY);
    if (saved) setSelectedId(saved);
  }, []);
  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
  }, [selectedId]);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(() => {
      setFileChanges((prev) => prev.filter((c) => Date.now() - c.ts < FILE_TTL_MS));
    }, 5000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    void api.list().then((j) => setAgents(j.agents)).catch(() => {});
    void api.projects.list().then((j) => setProjects(j.projects)).catch(() => {});
    void api.chats.list().then((j) => setChats(j.chats)).catch(() => {});
  }, []);

  const { connected } = useWs(WS_URL, (m: WsMessage) => {
    if (m.type === "agents_snapshot") {
      setAgents(m.agents);
      setSelectedId((cur) => {
        if (cur && m.agents.some((a) => a.agent.id === cur)) return cur;
        return m.agents[0]?.agent.id ?? null;
      });
    } else if (m.type === "agent") {
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.agent.id === m.agent.id);
        if (idx === -1) return [...prev, { agent: m.agent, runtime: m.runtime }];
        const next = prev.slice();
        next[idx] = { agent: m.agent, runtime: m.runtime };
        return next;
      });
    } else if (m.type === "agent_removed") {
      setAgents((prev) => prev.filter((a) => a.agent.id !== m.agentId));
      setEventsByAgent((prev) => { const next = { ...prev }; delete next[m.agentId]; return next; });
      setSelectedId((cur) => (cur === m.agentId ? null : cur));
      setMainView((cur) => (cur?.kind === "agent" && cur.agentId === m.agentId ? null : cur));
    } else if (m.type === "transcript") {
      setEventsByAgent((prev) => {
        const cur = prev[m.agentId] ?? [];
        return { ...prev, [m.agentId]: [...cur, m.event] };
      });
    } else if (m.type === "file") {
      setFileChanges((prev) => [...prev, m.change]);
    } else if (m.type === "auto_commit") {
      setCommitByDir((prev) => ({ ...prev, [m.info.workingDir]: m.info }));
    } else if (m.type === "session_reset") {
      setEventsByAgent((prev) => {
        if (!prev[m.agentId]) return prev;
        const next = { ...prev };
        next[m.agentId] = [];
        return next;
      });
    } else if (m.type === "projects_snapshot") {
      setProjects(m.projects);
    } else if (m.type === "project_removed") {
      setProjects((prev) => prev.filter((p) => p.id !== m.projectId));
    } else if (m.type === "chats_snapshot") {
      setChats(m.chats);
    } else if (m.type === "chat_removed") {
      setChats((prev) => prev.filter((c) => c.id !== m.chatId));
      setMainView((cur) => (cur?.kind === "chat" && cur.chatId === m.chatId ? null : cur));
    }
  });

  // Auto-select first agent
  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].agent.id);
  }, [agents, selectedId]);

  // Seed initial main view from selected agent
  useEffect(() => {
    if (mainView) return;
    if (!selectedId) return;
    setMainView({ kind: "agent", agentId: selectedId });
  }, [selectedId, mainView]);

  // Lazy-load transcript for selected agent
  useEffect(() => {
    if (!selectedId) return;
    if ((eventsByAgent[selectedId]?.length ?? 0) > 0) return;
    void api.events(selectedId)
      .then((r) => setEventsByAgent((prev) => ({ ...prev, [selectedId]: r.events })))
      .catch(() => {});
  }, [selectedId]);

  const selected = useMemo(
    () => agents.find((a) => a.agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  const activeAgentId = mainView?.kind === "agent" ? mainView.agentId : selectedId;
  const activeAgentEntry = useMemo(
    () => agents.find((a) => a.agent.id === activeAgentId) ?? null,
    [agents, activeAgentId],
  );
  const activeAgentEvents = activeAgentId ? (eventsByAgent[activeAgentId] ?? []) : [];

  const onSidebarSelect = (agentId: string) => {
    setSelectedId(agentId);
    setMainView({ kind: "agent", agentId });
    setActiveFileTabId(null);
  };

  const onNewChat = useCallback(async (workingDir: string, projectName: string) => {
    try {
      const { chat } = await api.chats.create({ name: projectName, workingDir });
      setChats((prev) => [...prev.filter((c) => c.id !== chat.id), chat]);
      setMainView({ kind: "chat", chatId: chat.id, workingDir, displayName: chat.name });
      setActiveFileTabId(null);
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  }, []);

  const onOpenChat = useCallback((chatId: string, name: string, workingDir: string) => {
    setMainView({ kind: "chat", chatId, workingDir, displayName: name });
    setActiveFileTabId(null);
  }, []);

  const onDeleteChat = useCallback((chatId: string) => {
    void api.chats.remove(chatId).catch(() => {});
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    setMainView((cur) => (cur?.kind === "chat" && cur.chatId === chatId ? null : cur));
  }, []);

  const onAddAgentToProject = (workingDir: string) => {
    setNewAgentWorkingDir(workingDir);
    setShowNewAgent(true);
  };

  const onDeleteProject = (projectId: string) => {
    void api.projects.remove(projectId).catch(() => {});
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
  };

  const onOpenFile = (f: { workingDir: string; hash: string; filePath: string | null }) => {
    const existing = fileTabs.find(
      (t) => t.workingDir === f.workingDir && t.hash === f.hash && t.filePath === f.filePath,
    );
    if (existing) { setActiveFileTabId(existing.id); return; }
    const t: FileTab = { id: uid(), ...f };
    setFileTabs((prev) => [...prev, t]);
    setActiveFileTabId(t.id);
  };

  const onCloseFileTab = (id: string) => {
    setFileTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeFileTabId === id) setActiveFileTabId(null);
  };

  // Sidebar indicators
  const activeChatIds = useMemo(() => {
    if (mainView?.kind === "chat") return new Set([mainView.chatId]);
    return new Set<string>();
  }, [mainView]);

  const streamingChatIds = useMemo(() => {
    if (mainView?.kind === "chat" && streamingChat) return new Set([mainView.chatId]);
    return new Set<string>();
  }, [mainView, streamingChat]);

  const liveChangesForSidebar = selected
    ? fileChanges.filter((c) => c.path.startsWith(selected.agent.workingDir + "/"))
    : [];

  const fileTabsForBar: Tab[] = fileTabs.map((t) => {
    const name = t.filePath?.split("/").pop() ?? (t.hash === "WORKING" ? "working tree" : t.hash.slice(0, 7));
    return { id: t.id, kind: "file", workingDir: t.workingDir, hash: t.hash, filePath: t.filePath, label: name };
  });

  // Panel widths
  const [sidebarPct, setSidebarPct] = useState(16);
  const [mainPct, setMainPct] = useState(50);
  const [metaPct, setMetaPct] = useState(25);
  const [notesPct, setNotesPct] = useState(60);
  const containerRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const prevMetaOpenRef = useRef(metaOpen);
  useEffect(() => {
    if (metaOpen === prevMetaOpenRef.current) return;
    prevMetaOpenRef.current = metaOpen;
    if (metaOpen) {
      setMainPct((p) => p - Math.min(metaPct, p - 15));
    } else {
      setMainPct((p) => p + metaPct);
    }
  }, [metaOpen]);

  const makeDragH = useCallback(
    (onDelta: (dpct: number) => void) => (e: React.MouseEvent) => {
      e.preventDefault();
      let last = e.clientX;
      const onMove = (ev: MouseEvent) => {
        const total = containerRef.current?.offsetWidth ?? window.innerWidth;
        const dpct = ((ev.clientX - last) / total) * 100;
        last = ev.clientX;
        onDelta(dpct);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const makeDragV = useCallback(
    (onDelta: (dpct: number) => void) => (e: React.MouseEvent) => {
      e.preventDefault();
      let last = e.clientY;
      const onMove = (ev: MouseEvent) => {
        const total = rightPanelRef.current?.offsetHeight ?? window.innerHeight;
        const dpct = ((ev.clientY - last) / total) * 100;
        last = ev.clientY;
        onDelta(dpct);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const onDragSidebarMain = useMemo(
    () => makeDragH((d) => { setSidebarPct((p) => Math.max(8, Math.min(30, p + d))); setMainPct((p) => Math.max(15, p - d)); }),
    [makeDragH],
  );
  const onDragMainMeta = useMemo(
    () => makeDragH((d) => { setMainPct((p) => Math.max(15, p + d)); setMetaPct((p) => Math.max(15, p - d)); }),
    [makeDragH],
  );
  const onDragMetaRight = useMemo(
    () => makeDragH((d) => { setMetaPct((p) => Math.max(15, p + d)); }),
    [makeDragH],
  );
  const onDragMainRight = useMemo(
    () => makeDragH((d) => { setMainPct((p) => Math.max(15, p + d)); }),
    [makeDragH],
  );
  const onDragNotesActivity = useMemo(
    () => makeDragV((d) => { setNotesPct((p) => Math.max(15, Math.min(85, p + d))); }),
    [makeDragV],
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: sidebarPct + "%" }} className="shrink-0 overflow-hidden">
          <AgentSidebar
            projects={projects}
            agents={agents}
            chats={chats}
            selectedId={selectedId}
            connected={connected}
            metaOpen={metaOpen}
            activeChatIds={activeChatIds}
            streamingChatIds={streamingChatIds}
            onSelect={onSidebarSelect}
            onNewChat={onNewChat}
            onOpenChat={onOpenChat}
            onDeleteChat={onDeleteChat}
            onNewProject={() => setShowNewProject(true)}
            onAddAgentToProject={onAddAgentToProject}
            onDeleteProject={onDeleteProject}
            onToggleMeta={() => setMetaOpen((v) => !v)}
          />
        </div>

        <div onMouseDown={onDragSidebarMain} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700/60 transition-colors" />

        {/* Main panel */}
        <div style={{ width: mainPct + "%" }} className="flex shrink-0 flex-col overflow-hidden">
          {/* File tab bar — only shown when file tabs exist */}
          {fileTabs.length > 0 && (
            <TabBar
              tabs={fileTabsForBar}
              activeId={activeFileTabId}
              onActivate={(id) => setActiveFileTabId(id)}
              onClose={onCloseFileTab}
            />
          )}

          <div className="relative min-h-0 flex-1">
            {/* File viewers — keep mounted, display:none when not active */}
            {fileTabs.map((t) => (
              <div
                key={t.id}
                className="absolute inset-0"
                style={{ display: activeFileTabId === t.id ? "block" : "none" }}
              >
                <FileViewer workingDir={t.workingDir} hash={t.hash} filePath={t.filePath} />
              </div>
            ))}

            {/* Chat view — mounted only when active and no file tab covering */}
            {mainView?.kind === "chat" && !activeFileTabId && (
              <AgentChat
                chatKey={mainView.chatId}
                displayName={mainView.displayName}
                workingDir={mainView.workingDir}
                onStreamingChange={setStreamingChat}
              />
            )}

            {/* Agent transcript — shown when no file tab and no chat */}
            {mainView?.kind === "agent" && !activeFileTabId && (
              <Transcript
                events={activeAgentEvents}
                agent={activeAgentEntry?.agent ?? null}
                runtime={activeAgentEntry?.runtime ?? null}
                onOpenSettings={() => {}}
                onOpenChat={() => {
                  if (!activeAgentEntry) return;
                  const project = projects.find((p) => p.workingDir === activeAgentEntry.agent.workingDir);
                  const name = project?.name ?? activeAgentEntry.agent.name;
                  void onNewChat(activeAgentEntry.agent.workingDir, name);
                }}
              />
            )}

            {/* Nothing open */}
            {!mainView && !activeFileTabId && (
              <div className="flex h-full items-center justify-center text-sm italic text-zinc-600">
                select an agent or open a chat
              </div>
            )}
          </div>
        </div>

        {/* Meta agent panel */}
        {metaOpen && (
          <>
            <div onMouseDown={onDragMainMeta} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700/60 transition-colors" />
            <div style={{ width: metaPct + "%" }} className="shrink-0 overflow-hidden">
              <MetaAgentChat onClose={() => setMetaOpen(false)} />
            </div>
            <div onMouseDown={onDragMetaRight} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700/60 transition-colors" />
          </>
        )}

        {!metaOpen && (
          <div onMouseDown={onDragMainRight} className="w-1 shrink-0 cursor-col-resize bg-zinc-800 hover:bg-emerald-700/60 transition-colors" />
        )}

        {/* Right panel */}
        <div ref={rightPanelRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={notesCollapsed ? "shrink-0" : activityCollapsed ? "min-h-0 flex-1 overflow-hidden" : "overflow-hidden"}
            style={!notesCollapsed && !activityCollapsed ? { height: notesPct + "%" } : undefined}
          >
            <PinnedNotes collapsed={notesCollapsed} onToggle={() => setNotesCollapsed((v) => !v)} />
          </div>
          {!notesCollapsed && !activityCollapsed && (
            <div onMouseDown={onDragNotesActivity} className="h-1 shrink-0 cursor-row-resize bg-zinc-800 hover:bg-emerald-700/60 transition-colors" />
          )}
          <div className={activityCollapsed ? "shrink-0" : "min-h-0 flex-1 overflow-hidden"}>
            <FileActivity
              liveChanges={liveChangesForSidebar}
              workingDir={selected?.agent.workingDir ?? null}
              lastCommit={selected?.agent.workingDir ? (commitByDir[selected.agent.workingDir] ?? null) : null}
              onOpenFile={onOpenFile}
              collapsed={activityCollapsed}
              onToggle={() => setActivityCollapsed((v) => !v)}
            />
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showNewAgent && (
        <NewAgentDialog
          lockedWorkingDir={newAgentWorkingDir}
          onClose={() => { setShowNewAgent(false); setNewAgentWorkingDir(undefined); }}
          onCreated={(a) => {
            setShowNewAgent(false);
            setNewAgentWorkingDir(undefined);
            onSidebarSelect(a.id);
          }}
        />
      )}
      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onCreated={(p) => { setShowNewProject(false); setProjects((prev) => [...prev, p]); }}
        />
      )}
      {showGlobalSettings && <SettingsPage onClose={() => setShowGlobalSettings(false)} />}

      {/* Shortcut modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 text-sm font-semibold text-zinc-100">Keyboard shortcuts</div>
            <div className="space-y-3">
              {SHORTCUTS.map(({ key, desc }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-zinc-400">{desc}</span>
                  <kbd className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300 border border-zinc-700">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            <div className="mt-5 text-[11px] text-zinc-600">Press ? or Esc to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
