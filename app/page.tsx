"use client";

import { useEffect, useMemo, useState } from "react";
import Transcript from "@/components/Transcript";
import FileActivity from "@/components/FileActivity";
import PinnedNotes from "@/components/PinnedNotes";
import AgentSidebar from "@/components/AgentSidebar";
import NewAgentDialog from "@/components/NewAgentDialog";
import MetaAgentChat from "@/components/MetaAgentChat";
import TabBar, { type Tab } from "@/components/TabBar";
import FileViewer from "@/components/FileViewer";
import SettingsPage from "@/components/SettingsPage";
import AgentSettingsModal from "@/components/AgentSettingsModal";
import { useWs } from "@/lib/use-ws";
import { api, WS_URL } from "@/lib/api";
import type {
  Agent,
  AgentRuntime,
  AutoCommitInfo,
  TranscriptEvent,
  FileChange,
  WsMessage,
} from "@/lib/types";

const FILE_TTL_MS = 60_000;
const SELECTED_KEY = "agents.selectedId.v1";
const META_OPEN_KEY = "meta-agent.open.v1";

type AgentEntry = { agent: Agent; runtime: AgentRuntime };

type TabState =
  | { id: string; kind: "agent"; agentId: string }
  | {
      id: string;
      kind: "file";
      workingDir: string;
      hash: string;
      filePath: string | null;
    };

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventsByAgent, setEventsByAgent] = useState<Record<string, TranscriptEvent[]>>({});
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [commitByDir, setCommitByDir] = useState<Record<string, AutoCommitInfo>>({});
  const [showGlobalSettings, setShowGlobalSettings] = useState(false);
  const [agentSettingsId, setAgentSettingsId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Load + persist meta-agent open state.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(META_OPEN_KEY);
      if (saved === "1") setMetaOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(META_OPEN_KEY, metaOpen ? "1" : "0");
    } catch {}
  }, [metaOpen]);

  // Keyboard shortcut: Cmd/Ctrl+K toggles the meta-agent; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMetaOpen((v) => !v);
      } else if (e.key === "Escape" && metaOpen) {
        setMetaOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [metaOpen]);

  // Persist selection across reloads.
  useEffect(() => {
    const saved = localStorage.getItem(SELECTED_KEY);
    if (saved) setSelectedId(saved);
  }, []);
  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
  }, [selectedId]);

  // Re-render every second so countdowns/uptime tick.
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  // Drop expired live file changes.
  useEffect(() => {
    const i = setInterval(() => {
      setFileChanges((prev) => prev.filter((c) => Date.now() - c.ts < FILE_TTL_MS));
    }, 5000);
    return () => clearInterval(i);
  }, []);

  // Initial fetch (handles the case where WS is slow).
  useEffect(() => {
    void api
      .list()
      .then((j) => setAgents(j.agents))
      .catch(() => {});
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
      setEventsByAgent((prev) => {
        const next = { ...prev };
        delete next[m.agentId];
        return next;
      });
      setSelectedId((cur) => (cur === m.agentId ? null : cur));
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
    }
  });

  // Auto-select first agent if none.
  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].agent.id);
  }, [agents, selectedId]);

  useEffect(() => {
    setTabs((prev) => {
      const filtered = prev.filter(
        (t) => t.kind !== "agent" || agents.some((a) => a.agent.id === t.agentId),
      );
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [agents]);

  // Seed an initial agent tab once agents have loaded.
  useEffect(() => {
    if (tabs.length > 0) return;
    if (agents.length === 0) return;
    const initialId =
      selectedId && agents.some((a) => a.agent.id === selectedId)
        ? selectedId
        : agents[0].agent.id;
    const t: TabState = { id: uid(), kind: "agent", agentId: initialId };
    setTabs([t]);
    setActiveTabId(t.id);
  }, [agents, tabs.length, selectedId]);

  useEffect(() => {
    if (activeTabId && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? null);
    }
  }, [tabs, activeTabId]);

  // Lazy-load transcript history for newly selected agent if we have none.
  useEffect(() => {
    if (!selectedId) return;
    if ((eventsByAgent[selectedId]?.length ?? 0) > 0) return;
    void api
      .events(selectedId)
      .then((r) =>
        setEventsByAgent((prev) => ({
          ...prev,
          [selectedId]: r.events,
        })),
      )
      .catch(() => {});
  }, [selectedId]);

  const selected = useMemo(
    () => agents.find((a) => a.agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const activeAgentEntry = useMemo(() => {
    if (activeTab?.kind !== "agent") return null;
    return agents.find((a) => a.agent.id === activeTab.agentId) ?? null;
  }, [activeTab, agents]);

  const tabsForBar: Tab[] = useMemo(
    () =>
      tabs.map((t): Tab => {
        if (t.kind === "agent") {
          const a = agents.find((x) => x.agent.id === t.agentId)?.agent;
          return {
            id: t.id,
            kind: "agent",
            agentId: t.agentId,
            label: a?.name ?? "(removed)",
          };
        }
        const name =
          t.filePath?.split("/").pop() ??
          (t.hash === "WORKING" ? "working tree" : t.hash.slice(0, 7));
        return {
          id: t.id,
          kind: "file",
          workingDir: t.workingDir,
          hash: t.hash,
          filePath: t.filePath,
          label: name,
        };
      }),
    [tabs, agents],
  );

  const activeAgentEvents =
    activeTab?.kind === "agent"
      ? (eventsByAgent[activeTab.agentId] ?? [])
      : [];

  const liveChangesForSidebar = selected
    ? fileChanges.filter((c) =>
        c.path.startsWith(selected.agent.workingDir + "/"),
      )
    : [];

  const onSidebarSelect = (agentId: string) => {
    setSelectedId(agentId);
    const existing = tabs.find(
      (t) => t.kind === "agent" && t.agentId === agentId,
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const active = tabs.find((t) => t.id === activeTabId);
    if (active && active.kind === "agent") {
      setTabs((prev) =>
        prev.map((t) => (t.id === active.id ? { ...t, agentId } : t)),
      );
      return;
    }
    const lastAgentTab = [...tabs].reverse().find((t) => t.kind === "agent");
    if (lastAgentTab) {
      setTabs((prev) =>
        prev.map((t) => (t.id === lastAgentTab.id ? { ...t, agentId } : t)),
      );
      setActiveTabId(lastAgentTab.id);
      return;
    }
    const t: TabState = { id: uid(), kind: "agent", agentId };
    setTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
  };

  const onSidebarOpenInNewTab = (agentId: string) => {
    setSelectedId(agentId);
    const t: TabState = { id: uid(), kind: "agent", agentId };
    setTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
  };

  const onOpenFile = (f: {
    workingDir: string;
    hash: string;
    filePath: string | null;
  }) => {
    const existing = tabs.find(
      (t) =>
        t.kind === "file" &&
        t.workingDir === f.workingDir &&
        t.hash === f.hash &&
        t.filePath === f.filePath,
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const t: TabState = { id: uid(), kind: "file", ...f };
    setTabs((prev) => [...prev, t]);
    setActiveTabId(t.id);
  };

  const onActivateTab = (id: string) => {
    setActiveTabId(id);
    const t = tabs.find((x) => x.id === id);
    if (t?.kind === "agent") setSelectedId(t.agentId);
  };

  const onCloseTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabId === id) {
      const newActive = next[idx] ?? next[idx - 1] ?? null;
      setActiveTabId(newActive?.id ?? null);
      if (newActive?.kind === "agent") setSelectedId(newActive.agentId);
    }
  };

  // Close the active tab on Cmd/Ctrl+W. The browser reserves Cmd+W to close
  // its own tab, so preventDefault may or may not work depending on how the
  // page is hosted (webview wrappers often let it through). We also bind
  // Cmd/Ctrl+Shift+W as a guaranteed-available alternative.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() !== "w") return;
      if (!activeTabId) return;
      e.preventDefault();
      onCloseTab(activeTabId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTabId, tabs]);

  const agentSettingsEntry = useMemo(() => {
    if (!agentSettingsId) return null;
    return agents.find((a) => a.agent.id === agentSettingsId) ?? null;
  }, [agentSettingsId, agents]);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <div className="grid flex-1 grid-cols-12 overflow-hidden">
        <div className="col-span-2 overflow-hidden">
          <AgentSidebar
            agents={agents}
            selectedId={selectedId}
            connected={connected}
            metaOpen={metaOpen}
            onSelect={onSidebarSelect}
            onOpenInNewTab={onSidebarOpenInNewTab}
            onNew={() => setShowNew(true)}
            onToggleMeta={() => setMetaOpen((v) => !v)}
            onOpenSettings={() => setShowGlobalSettings(true)}
            onOpenAgentSettings={(id) => setAgentSettingsId(id)}
          />
        </div>
        <div
          className={
            metaOpen
              ? "col-span-4 flex flex-col overflow-hidden border-r border-zinc-800"
              : "col-span-6 flex flex-col overflow-hidden border-r border-zinc-800"
          }
        >
          <TabBar
            tabs={tabsForBar}
            activeId={activeTabId}
            onActivate={onActivateTab}
            onClose={onCloseTab}
          />
          <div className="min-h-0 flex-1">
            {activeTab?.kind === "agent" ? (
              <Transcript
                events={activeAgentEvents}
                agent={activeAgentEntry?.agent ?? null}
                runtime={activeAgentEntry?.runtime ?? null}
                onOpenSettings={() =>
                  activeTab.kind === "agent" &&
                  setAgentSettingsId(activeTab.agentId)
                }
              />
            ) : activeTab?.kind === "file" ? (
              <FileViewer
                workingDir={activeTab.workingDir}
                hash={activeTab.hash}
                filePath={activeTab.filePath}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm italic text-zinc-600">
                no tab open — select an agent on the left
              </div>
            )}
          </div>
        </div>
        {metaOpen && (
          <div className="col-span-3 overflow-hidden border-r border-zinc-800">
            <MetaAgentChat onClose={() => setMetaOpen(false)} />
          </div>
        )}
        <div
          className={
            metaOpen
              ? "col-span-3 grid grid-rows-[1fr_minmax(180px,40%)] overflow-hidden"
              : "col-span-4 grid grid-rows-[1fr_minmax(180px,40%)] overflow-hidden"
          }
        >
          <div className="overflow-hidden border-b border-zinc-800">
            <PinnedNotes />
          </div>
          <div className="overflow-hidden">
            <FileActivity
              liveChanges={liveChangesForSidebar}
              workingDir={selected?.agent.workingDir ?? null}
              lastCommit={
                selected?.agent.workingDir
                  ? (commitByDir[selected.agent.workingDir] ?? null)
                  : null
              }
              onOpenFile={onOpenFile}
            />
          </div>
        </div>
      </div>
      {showNew && (
        <NewAgentDialog
          onClose={() => setShowNew(false)}
          onCreated={(a) => {
            setShowNew(false);
            onSidebarSelect(a.id);
          }}
        />
      )}
      {agentSettingsId && (
        <AgentSettingsModal
          agent={agentSettingsEntry?.agent ?? null}
          runtime={agentSettingsEntry?.runtime ?? null}
          onClose={() => setAgentSettingsId(null)}
        />
      )}
      {showGlobalSettings && (
        <SettingsPage onClose={() => setShowGlobalSettings(false)} />
      )}
    </div>
  );
}
