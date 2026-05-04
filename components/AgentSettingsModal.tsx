"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import type { Agent, AgentRuntime } from "@/lib/types";
import SettingsPanel from "./SettingsPanel";

export default function AgentSettingsModal({
  agent,
  runtime,
  onClose,
}: {
  agent: Agent | null;
  runtime: AgentRuntime | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <span className="text-xs uppercase tracking-wider text-zinc-500">
            agent settings
          </span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title="Close (Esc)"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <SettingsPanel agent={agent} runtime={runtime} />
        </div>
      </div>
    </div>
  );
}
