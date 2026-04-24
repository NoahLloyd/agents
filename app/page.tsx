"use client";

import { useEffect, useMemo, useState } from "react";
import StatusHeader from "@/components/StatusHeader";
import Transcript from "@/components/Transcript";
import FileActivity from "@/components/FileActivity";
import PinnedNotes from "@/components/PinnedNotes";
import AgentSidebar from "@/components/AgentSidebar";
import NewAgentDialog from "@/components/NewAgentDialog";
import MetaAgentChat from "@/components/MetaAgentChat";
import { useWs } from "@/lib/use-ws";
import { api, WS_URL } from "@/lib/api";
import type {
  Agent,
  AgentRuntime,
  TranscriptEvent,
  FileChange,
  WsMessage,
} from "@/lib/types";

const FILE_TTL_MS = 60_000;
const SELECTED_KEY = "agents.selectedId.v1";
const META_OPEN_KEY = "meta-agent.open.v1";

type AgentEntry = { agent: Agent; runtime: AgentRuntime };

export default function Home() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eventsByAgent, setEventsByAgent] = useState<Record<string, TranscriptEvent[]>>({});
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
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
    }
  });

  // Auto-select first agent if none.
  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].agent.id);
  }, [agents, selectedId]);

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

  const selectedEvents = selectedId ? (eventsByAgent[selectedId] ?? []) : [];

  const liveChangesForAgent = selected
    ? fileChanges.filter((c) =>
        c.path.startsWith(selected.agent.workingDir + "/"),
      )
    : [];

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <StatusHeader
        agent={selected?.agent ?? null}
        runtime={selected?.runtime ?? null}
        connected={connected}
        agentCount={agents.length}
      />
      <div className="grid flex-1 grid-cols-12 overflow-hidden">
        <div className="col-span-2 overflow-hidden">
          <AgentSidebar
            agents={agents}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setShowNew(true)}
          />
        </div>
        <div
          className={
            metaOpen
              ? "col-span-4 overflow-hidden border-r border-zinc-800"
              : "col-span-6 overflow-hidden border-r border-zinc-800"
          }
        >
          <Transcript
            events={selectedEvents}
            agentName={selected?.agent.name ?? null}
            sessionPath={selected?.runtime.sessionPath ?? null}
          />
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
              liveChanges={liveChangesForAgent}
              workingDir={selected?.agent.workingDir ?? null}
            />
          </div>
        </div>
      </div>
      {!metaOpen && (
        <button
          onClick={() => setMetaOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 shadow-lg hover:bg-zinc-800"
          title="Open meta-agent (⌘K)"
        >
          <span className="size-2 rounded-full bg-emerald-500" />
          ask meta-agent
          <span className="ml-1 rounded border border-zinc-700 px-1 text-[10px] text-zinc-500">
            ⌘K
          </span>
        </button>
      )}
      {showNew && (
        <NewAgentDialog
          onClose={() => setShowNew(false)}
          onCreated={(a) => {
            setShowNew(false);
            setSelectedId(a.id);
          }}
        />
      )}
    </div>
  );
}
