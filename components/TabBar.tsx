"use client";

import { FileText, MessageSquare, X} from "lucide-react";

export type Tab =
  | { id: string; kind: "agent"; agentId: string; label: string }
  | {
      id: string;
      kind: "file";
      workingDir: string;
      hash: string;
      filePath: string | null;
      label: string;
    }
  | { id: string; kind: "chat"; agentId: string; label: string };

export default function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  streamingTabIds,
  completedTabIds,
}: {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  streamingTabIds?: ReadonlySet<string>;
  completedTabIds?: ReadonlySet<string>;
}) {
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-zinc-800 bg-zinc-950">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => onActivate(t.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-zinc-800 pl-3 pr-1 text-xs ${
              active
                ? "bg-zinc-900 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300"
            }`}
          >
            <TabIcon tab={t} />
            {streamingTabIds?.has(t.id) && (
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shrink-0" title="running" />
            )}
            {!streamingTabIds?.has(t.id) && completedTabIds?.has(t.id) && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" title="done" />
            )}
            <span className="max-w-[180px] truncate" title={t.label}>
              {t.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              title="close tab"
              className="ml-1 px-1 text-zinc-600 opacity-0 hover:text-zinc-200 group-hover:opacity-100"
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </div>
        );
      })}
      {tabs.length === 0 && (
        <div className="flex items-center px-3 text-xs italic text-zinc-600">
          no tabs
        </div>
      )}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "file") {
    return <FileText size={11} className="shrink-0 text-zinc-500" />;
  }
  if (tab.kind === "chat") {
    return <MessageSquare size={11} className="shrink-0 text-emerald-600" />;
  }
  return null;
}
