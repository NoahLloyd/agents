"use client";

import { useEffect, useRef, useState } from "react";
import FileInput from "@/components/FileInput";
import type { Agent } from "@/lib/types";
import { api } from "@/lib/api";

const DEFAULT_WORKING_DIR = "/Users/noah/AI-safety";
const DEFAULT_NOTES_FILE = "/Users/noah/AI-safety/Noah's notes.md";

export default function NewAgentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}) {
  const [name, setName] = useState("");
  const [workingDir, setWorkingDir] = useState(DEFAULT_WORKING_DIR);
  const [mode, setMode] = useState<"file" | "inline">("inline");
  const [filePath, setFilePath] = useState(DEFAULT_NOTES_FILE);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("claude-opus-4-7");
  const [fallbackModel, setFallbackModel] = useState("claude-opus-4-6");
  const [effort, setEffort] = useState<Agent["effort"]>("max");
  const [keepAlive, setKeepAlive] = useState(true);
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("name required");
    if (!workingDir.trim()) return setErr("working dir required");
    if (mode === "inline" && !prompt.trim()) return setErr("prompt required");
    if (mode === "file" && !filePath.trim()) return setErr("file path required");
    setBusy(true);
    try {
      const body: Partial<Agent> = {
        name: name.trim(),
        workingDir: workingDir.trim(),
        direction:
          mode === "inline"
            ? { kind: "inline", prompt: prompt.trim() }
            : { kind: "file", filePath: filePath.trim() },
        model,
        fallbackModel,
        effort,
        keepAlive,
        enabled: startNow,
      };
      const { agent } = await api.create(body);
      onCreated(agent);
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
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-medium text-zinc-200">new agent</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4 text-sm">
          <Field label="name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ai-safety-researcher"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-zinc-500"
            />
          </Field>

          <Field label="working dir">
            <DirInput value={workingDir} onChange={setWorkingDir} />
          </Field>

          <Field label="direction">
            <div className="mb-2 flex gap-2">
              <ModeBtn
                active={mode === "inline"}
                onClick={() => setMode("inline")}
                label="inline prompt"
                hint="write the task here"
              />
              <ModeBtn
                active={mode === "file"}
                onClick={() => setMode("file")}
                label="file-driven"
                hint="re-read a markdown file each turn"
              />
            </div>
            {mode === "inline" ? (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what the agent should do. Be specific."
                rows={6}
                className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
              />
            ) : (
              <FileInput
                value={filePath}
                onChange={setFilePath}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
              />
            )}
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="model">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none"
              />
            </Field>
            <Field label="fallback">
              <input
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none"
              />
            </Field>
            <Field label="effort">
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as Agent["effort"])}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
                <option value="max">max</option>
              </select>
            </Field>
          </div>

          <div className="mt-3 flex flex-col gap-2 text-xs text-zinc-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={keepAlive}
                onChange={(e) => setKeepAlive(e.target.checked)}
              />
              keep alive — auto-restart on crash, auto-resume after usage limit
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={startNow}
                onChange={(e) => setStartNow(e.target.checked)}
              />
              start immediately after creating
            </label>
          </div>

          {err && (
            <div className="mt-3 rounded border border-red-700 bg-red-900/30 px-2 py-1 text-xs text-red-300">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
          >
            cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? "creating…" : "create agent"}
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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          fetchSuggestions(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            pick(suggestions[activeIdx]);
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Tab" && suggestions.length > 0) {
            e.preventDefault();
            pick(suggestions[activeIdx >= 0 ? activeIdx : 0]);
          }
        }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {suggestions.map((dir, i) => (
            <li
              key={dir}
              onMouseDown={(e) => { e.preventDefault(); pick(dir); }}
              className={`cursor-pointer px-2 py-1.5 font-mono text-xs truncate ${
                i === activeIdx
                  ? "bg-emerald-800/50 text-zinc-100"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {dir}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded border px-3 py-2 text-left text-xs transition ${
        active
          ? "border-emerald-600 bg-emerald-900/20 text-zinc-100"
          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600"
      }`}
    >
      <div className="font-medium">{label}</div>
      <div className="mt-0.5 text-[10px] text-zinc-500">{hint}</div>
    </button>
  );
}
