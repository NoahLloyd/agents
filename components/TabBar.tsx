"use client";

import { FileText } from "lucide-react";

export type Tab =
  | { id: string; kind: "agent"; agentId: string; label: string }
  | {
      id: string;
      kind: "file";
      workingDir: string;
      hash: string;
      filePath: string | null;
      label: string;
    };

export default function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
}: {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
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
            <TabIcon kind={t.kind} />
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
              ✕
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

function TabIcon({ kind }: { kind: Tab["kind"] }) {
  if (kind === "file") {
    return <FileText size={11} className="shrink-0 text-zinc-500" />;
  }
  return null;
}
