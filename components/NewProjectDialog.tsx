"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEscapeToClose } from "@/lib/use-escape";
import type { Project } from "@/lib/types";
import { api } from "@/lib/api";

export default function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [workingDir, setWorkingDir] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEscapeToClose(onClose);

  // Auto-fill name from last path segment
  useEffect(() => {
    if (!workingDir) { setName(""); return; }
    const segment = workingDir.split("/").filter(Boolean).pop() ?? "";
    setName(segment);
  }, [workingDir]);

  const submit = async () => {
    setErr(null);
    if (!workingDir.trim()) return setErr("working dir required");
    if (!name.trim()) return setErr("name required");
    setBusy(true);
    try {
      const { project } = await api.projects.create({ name: name.trim(), workingDir: workingDir.trim() });
      onCreated(project);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-200">new project</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={14} strokeWidth={2} /></button>
        </div>

        <div className="px-4 py-4 text-sm">
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">working dir</div>
            <DirInput value={workingDir} onChange={setWorkingDir} />
          </div>
          <div className="mb-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">display name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-project"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>
          {err && (
            <div className="mt-2 rounded border border-red-700 bg-red-900/30 px-2 py-1 text-xs text-red-300">{err}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button onClick={onClose} className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200">cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? "creating…" : "create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DirInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dirs?q=${encodeURIComponent(q)}`);
        const data = await res.json() as { dirs: string[] };
        setSuggestions(data.dirs);
        setOpen(data.dirs.length > 0);
        setActiveIdx(-1);
      } catch {}
    }, 120);
  };

  const pick = (dir: string) => {
    onChange(dir);
    setSuggestions([]);
    setOpen(false);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); fetchSuggestions(e.target.value); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
          else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); pick(suggestions[activeIdx]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          else if (e.key === "Tab" && suggestions.length > 0) { e.preventDefault(); pick(suggestions[activeIdx >= 0 ? activeIdx : 0]); }
        }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder="/srv/agents/repos/my-project"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {suggestions.map((dir, i) => (
            <li
              key={dir}
              onMouseDown={(e) => { e.preventDefault(); pick(dir); }}
              className={`cursor-pointer px-2 py-1.5 font-mono text-xs truncate ${i === activeIdx ? "bg-emerald-800/50 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
            >
              {dir}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
