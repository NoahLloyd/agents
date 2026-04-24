"use client";

import type { Agent, AgentRuntime } from "@/lib/types";
import ClaudeInstances from "./ClaudeInstances";

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtCountdown(target: number | null): string | null {
  if (!target) return null;
  const sec = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function StatusHeader({
  agent,
  runtime,
  connected,
  agentCount,
}: {
  agent: Agent | null;
  runtime: AgentRuntime | null;
  connected: boolean;
  agentCount: number;
}) {
  const dotClass = !connected
    ? "bg-zinc-500"
    : runtime?.alive
      ? "bg-emerald-400"
      : runtime?.scheduledRestartAt
        ? "bg-amber-400"
        : agent?.enabled
          ? "bg-red-500"
          : "bg-zinc-600";

  let label = "ws disconnected";
  if (connected) {
    if (!agent) label = `${agentCount} agent${agentCount === 1 ? "" : "s"}`;
    else if (runtime?.alive) label = `${agent.name} · running`;
    else if (runtime?.scheduledRestartAt) label = `${agent.name} · waiting`;
    else if (agent.enabled) label = `${agent.name} · dead`;
    else label = `${agent.name} · stopped`;
  }

  const countdown = fmtCountdown(runtime?.scheduledRestartAt ?? null);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 px-4 py-2">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <span className="text-sm font-medium text-zinc-100">{label}</span>
        </div>
        {agent && (
          <>
            <Field label="pid" value={runtime?.pid?.toString() ?? "—"} />
            <Field label="uptime" value={fmtUptime(runtime?.uptimeSec ?? null)} />
            <Field label="model" value={agent.model} mono />
            <Field
              label="dir"
              value={agent.workingDir.split("/").slice(-2).join("/")}
              mono
            />
            {countdown && (
              <Field
                label="auto-resume"
                value={`in ${countdown}`}
                className="text-amber-400"
              />
            )}
          </>
        )}
        <div className="ml-auto">
          <ClaudeInstances />
        </div>
      </div>
    </header>
  );
}

function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="text-sm">
      <span className="text-zinc-500">{label} </span>
      <span
        className={`${mono ? "font-mono text-zinc-200" : "text-zinc-200"} ${className ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}
