"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Proc = {
  pid: number;
  ppid: number;
  cpu: number;
  rssMb: number;
  cmd: string;
  agentName: string | null;
};

export default function ClaudeInstances() {
  const [procs, setProcs] = useState<Proc[] | null>(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!procs) return null;

  const total = procs.length;
  const external = procs.filter((p) => !p.agentName).length;
  const totalCpu = procs.reduce((s, p) => s + p.cpu, 0);
  const heavy = totalCpu > 150 || external > 2;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={`rounded border px-2 py-0.5 text-xs ${
          heavy
            ? "border-amber-700 bg-amber-900/20 text-amber-300 hover:bg-amber-900/40"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
        }`}
        title="claude processes on this machine"
      >
        {total} claude {total === 1 ? "proc" : "procs"}
        {external > 0 && (
          <span className="ml-1 text-zinc-500">· {external} external</span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-30 mt-1 max-h-[60vh] w-[540px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl"
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
            <span>
              total CPU <span className="text-zinc-300">{totalCpu.toFixed(1)}%</span>
              {" · "}
              {total} proc{total === 1 ? "" : "s"}
              {external > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-300">{external} external</span>
                </>
              )}
            </span>
            <span className="text-zinc-600">refreshes every 5s</span>
          </div>
          {procs.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs italic text-zinc-600">
              no claude processes
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 border-b border-zinc-900 px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-600">
                <span className="w-14 shrink-0">pid</span>
                <span className="w-14 shrink-0">cpu</span>
                <span className="w-16 shrink-0">mem</span>
                <span className="w-24 shrink-0">owner</span>
                <span className="flex-1 truncate">command</span>
              </div>
              {[...procs]
                .sort((a, b) => b.cpu - a.cpu)
                .map((p) => (
                  <div
                    key={p.pid}
                    className="flex items-baseline gap-3 border-b border-zinc-900 px-3 py-1.5 font-mono text-[11px]"
                  >
                    <span className="w-14 shrink-0 text-zinc-500">{p.pid}</span>
                    <span
                      className={`w-14 shrink-0 ${
                        p.cpu > 50 ? "text-amber-400" : "text-zinc-400"
                      }`}
                    >
                      {p.cpu.toFixed(1)}%
                    </span>
                    <span className="w-16 shrink-0 text-zinc-500">
                      {p.rssMb}MB
                    </span>
                    <span
                      className={`w-24 shrink-0 truncate ${
                        p.agentName ? "text-emerald-400" : "text-zinc-500"
                      }`}
                      title={p.agentName ?? "not managed by this dashboard"}
                    >
                      {p.agentName ?? "external"}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-zinc-600"
                      title={p.cmd}
                    >
                      {p.cmd}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
