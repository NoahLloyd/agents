"use client";

import { useEffect, useState } from "react";
import type { Agent, AgentRuntime } from "@/lib/types";
import { api } from "@/lib/api";

export default function SettingsPanel({
  agent,
  runtime,
}: {
  agent: Agent | null;
  runtime: AgentRuntime | null;
}) {
  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center text-sm italic text-zinc-600">
        agent not found
      </div>
    );
  }
  return <SettingsForm agent={agent} runtime={runtime} />;
}

function SettingsForm({
  agent,
  runtime,
}: {
  agent: Agent;
  runtime: AgentRuntime | null;
}) {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            agent settings
          </div>
          <h2 className="mt-0.5 text-lg font-medium text-zinc-100">
            {agent.name}
          </h2>
        </div>

        <div className="space-y-4">
          <TextField
            label="name"
            value={agent.name}
            onSubmit={(v) => api.update(agent.id, { name: v.trim() })}
          />

          <TextField
            label="working dir"
            mono
            value={agent.workingDir}
            onSubmit={(v) => api.update(agent.id, { workingDir: v.trim() })}
          />

          <DirectionField agent={agent} />

          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="model"
              mono
              value={agent.model}
              onSubmit={(v) => api.update(agent.id, { model: v.trim() })}
            />
            <TextField
              label="fallback model"
              mono
              value={agent.fallbackModel}
              onSubmit={(v) => api.update(agent.id, { fallbackModel: v.trim() })}
            />
            <EffortField agent={agent} />
          </div>

          <ToggleField
            label="keep alive"
            hint="auto-restart on crash, auto-resume after usage limit"
            value={agent.keepAlive}
            onChange={(v) => api.update(agent.id, { keepAlive: v })}
          />
        </div>

        <div className="mt-8 border-t border-zinc-800 pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-600">
            runtime
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
            <InfoRow label="id" value={agent.id} />
            <InfoRow
              label="created"
              value={new Date(agent.createdAt).toLocaleString(undefined, {
                hour12: false,
              })}
            />
            <InfoRow label="pid" value={runtime?.pid?.toString() ?? "—"} />
            <InfoRow
              label="started"
              value={
                runtime?.startedAt
                  ? new Date(runtime.startedAt).toLocaleString(undefined, {
                      hour12: false,
                    })
                  : "—"
              }
            />
            <InfoRow
              label="session"
              value={runtime?.sessionPath ?? "—"}
              mono
            />
            <InfoRow
              label="stdout log"
              value={runtime?.stdoutLogPath ?? "—"}
              mono
            />
            <InfoRow
              label="stderr log"
              value={runtime?.stderrLogPath ?? "—"}
              mono
            />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  mono,
  onSubmit,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onSubmit: (v: string) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const dirty = draft !== value;

  const commit = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(draft);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1200);
    } catch (e) {
      setStatus("error");
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>{label}</Label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(value);
          }
        }}
        disabled={busy}
        className={`w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm outline-none transition ${
          mono ? "font-mono text-xs" : ""
        } ${
          dirty
            ? "border-amber-700 text-amber-100"
            : "text-zinc-100 focus:border-zinc-500"
        }`}
      />
      {status === "saved" && (
        <div className="mt-1 text-[10px] text-emerald-400">saved</div>
      )}
      {status === "error" && err && (
        <div className="mt-1 text-[10px] text-red-400">{err}</div>
      )}
    </div>
  );
}

function EffortField({ agent }: { agent: Agent }) {
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Label>effort</Label>
      <select
        value={agent.effort}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            await api.update(agent.id, {
              effort: e.target.value as Agent["effort"],
            });
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-zinc-500"
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="xhigh">xhigh</option>
        <option value="max">max</option>
      </select>
    </div>
  );
}

function ToggleField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onChange(!value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={value}
        onChange={toggle}
        disabled={busy}
        className="mt-0.5"
      />
      <span>
        <span>{label}</span>
        {hint && <span className="ml-2 text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

function DirectionField({ agent }: { agent: Agent }) {
  const [mode, setMode] = useState<"inline" | "file">(agent.direction.kind);
  const [prompt, setPrompt] = useState(
    agent.direction.kind === "inline" ? agent.direction.prompt : "",
  );
  const [filePath, setFilePath] = useState(
    agent.direction.kind === "file" ? agent.direction.filePath : "",
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    setMode(agent.direction.kind);
    if (agent.direction.kind === "inline") setPrompt(agent.direction.prompt);
    if (agent.direction.kind === "file") setFilePath(agent.direction.filePath);
  }, [agent.direction]);

  const currentValue =
    agent.direction.kind === "inline"
      ? agent.direction.prompt
      : agent.direction.filePath;
  const draftValue = mode === "inline" ? prompt : filePath;
  const dirty =
    mode !== agent.direction.kind || draftValue !== currentValue;

  const commit = async () => {
    if (!dirty || busy) return;
    const direction =
      mode === "inline"
        ? { kind: "inline" as const, prompt: prompt.trim() }
        : { kind: "file" as const, filePath: filePath.trim() };
    setBusy(true);
    try {
      await api.update(agent.id, { direction });
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>direction</Label>
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
          onBlur={() => void commit()}
          rows={6}
          className={`w-full resize-y rounded border bg-zinc-900 px-2 py-1.5 font-mono text-xs outline-none ${
            dirty ? "border-amber-700 text-amber-100" : "border-zinc-700 text-zinc-100 focus:border-zinc-500"
          }`}
        />
      ) : (
        <input
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={`w-full rounded border bg-zinc-900 px-2 py-1.5 font-mono text-xs outline-none ${
            dirty ? "border-amber-700 text-amber-100" : "border-zinc-700 text-zinc-100 focus:border-zinc-500"
          }`}
        />
      )}
      {status === "saved" && (
        <div className="mt-1 text-[10px] text-emerald-400">saved</div>
      )}
      {status === "error" && (
        <div className="mt-1 text-[10px] text-red-400">update failed</div>
      )}
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

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-zinc-600">{label}</dt>
      <dd
        className={`truncate ${mono ? "font-mono text-zinc-400" : "text-zinc-300"}`}
        title={value}
      >
        {value}
      </dd>
    </>
  );
}
