"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Proc = {
  pid: number;
  ppid: number;
  cpu: number;
  rssMb: number;
  cmd: string;
  source: string;
  agentName: string | null;
};

const SOURCE_COLOR: Record<string, string> = {
  conductor: "text-sky-400",
  desktop: "text-violet-400",
  "agent-dashboard": "text-emerald-400",
  "cli (headless)": "text-zinc-400",
  "cli (resumed)": "text-zinc-400",
  cli: "text-zinc-400",
};

export default function ClaudeInstances() {
  const [procs, setProcs] = useState<Proc[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .claudeProcs()
        .then((r) => {
          if (!cancelled) setProcs(r.procs);
        })
        .catch(() => {});
    };
    load();
    const i = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  if (!procs) return null;

  // Only show claude processes NOT owned by this dashboard — the managed
  // ones already have rows in the agents list above.
  const external = procs.filter((p) => !p.agentName);
  if (external.length === 0) return null;

  const heavy = external.length > 3;

  return (
    <div className="border-t border-zinc-800 bg-zinc-950">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
          heavy
            ? "text-amber-300 hover:bg-amber-900/20"
            : "text-zinc-400 hover:bg-zinc-900"
        }`}
        title="other claude processes on this machine"
      >
        <span
          className={`inline-block transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          <ChevronRight size={13} strokeWidth={2} />
        </span>
        <span className="flex-1">
          other claude procs
          <span className="ml-1 text-zinc-500">({external.length})</span>
        </span>
      </button>
      {open && (
        <div className="max-h-[40vh] overflow-auto border-t border-zinc-900">
          {[...external]
            .sort((a, b) => b.cpu - a.cpu)
            .map((p) => (
              <div
                key={p.pid}
                className="border-b border-zinc-900 px-3 py-1.5"
                title={p.cmd}
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`shrink-0 ${SOURCE_COLOR[p.source] ?? "text-zinc-400"}`}
                  >
                    {p.source}
                  </span>
                  <span
                    className={`ml-auto shrink-0 font-mono text-[10px] ${
                      p.cpu > 50 ? "text-amber-400" : "text-zinc-500"
                    }`}
                  >
                    {p.cpu.toFixed(0)}% · {p.rssMb}MB
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                  <span className="font-mono">pid {p.pid}</span>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
