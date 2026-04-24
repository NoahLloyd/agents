"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";
import type { Agent, AgentRuntime, TranscriptEvent } from "@/lib/types";
import {
  AssistantText,
  LiveDots,
  ThinkingRow,
  ToolRow,
  UserBubble,
} from "./ChatPieces";

type Turn =
  | { kind: "direction"; text: string; fileMode: boolean }
  | {
      kind: "time";
      ts: number;
      gapSec: number | null;
      showDate: boolean;
      key: string;
    }
  | { kind: "text"; text: string; ts: number; key: string }
  | { kind: "thinking"; text: string; ts: number; key: string }
  | {
      kind: "tool";
      name: string;
      input: Record<string, unknown>;
      result: { content: string; isError: boolean } | null;
      ts: number;
      key: string;
    };

// Insert a time marker roughly every this many seconds. If events are
// dense, markers appear at this cadence. If there's a pause longer than
// this, the next event just gets one marker (we don't fill empty minutes).
const TIME_MARKER_INTERVAL_SEC = 300;

function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtUptime(sec: number | null): string {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function fmtCountdown(target: number | null): string | null {
  if (!target) return null;
  const sec = Math.max(0, Math.floor((target - Date.now()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolveStatus({
  running,
  scheduledRestartAt,
  enabled,
  hasAgent,
}: {
  running: boolean;
  scheduledRestartAt: number | null;
  enabled: boolean;
  hasAgent: boolean;
}): { label: string; labelClass: string } {
  if (!hasAgent) return { label: "no agent", labelClass: "text-zinc-500" };
  if (running) return { label: "running", labelClass: "text-emerald-400" };
  if (scheduledRestartAt)
    return { label: "waiting", labelClass: "text-amber-300" };
  if (enabled) return { label: "dead", labelClass: "text-red-400" };
  return { label: "stopped", labelClass: "text-zinc-500" };
}

function buildTurns(
  events: TranscriptEvent[],
  direction: Agent["direction"] | null,
): Turn[] {
  const turns: Turn[] = [];
  if (direction) {
    if (direction.kind === "inline") {
      turns.push({ kind: "direction", text: direction.prompt, fileMode: false });
    } else {
      turns.push({ kind: "direction", text: direction.filePath, fileMode: true });
    }
  }

  const resultByToolId = new Map<
    string,
    { content: string; isError: boolean }
  >();
  for (const ev of events) {
    if (ev.kind === "tool_result") {
      resultByToolId.set(ev.toolUseId, {
        content: ev.content,
        isError: ev.isError,
      });
    }
  }

  let i = 0;
  let lastMarkerTs: number | null = null;
  let prevDateKey: string | null = null;
  const todayKey = dateKey(Date.now());
  for (const ev of events) {
    const key = `${ev.ts}-${i++}`;
    const isRendered =
      ev.kind === "text" || ev.kind === "thinking" || ev.kind === "tool_use";
    if (isRendered) {
      const evDateKey = dateKey(ev.ts);
      const isFirst = lastMarkerTs === null;
      const gapFromMarker = isFirst
        ? null
        : Math.round((ev.ts - (lastMarkerTs as number)) / 1000);
      const intervalCrossed =
        gapFromMarker !== null && gapFromMarker >= TIME_MARKER_INTERVAL_SEC;
      const dateChanged = prevDateKey !== null && evDateKey !== prevDateKey;
      if (isFirst || intervalCrossed || dateChanged) {
        // Show the date on the first marker if it's not today, and any
        // time the date changes (e.g., a gap that crosses midnight).
        const showDate =
          dateChanged || (isFirst && evDateKey !== todayKey);
        turns.push({
          kind: "time",
          ts: ev.ts,
          gapSec: gapFromMarker,
          showDate,
          key: `t-${key}`,
        });
        lastMarkerTs = ev.ts;
        prevDateKey = evDateKey;
      }
    }
    if (ev.kind === "text") {
      turns.push({ kind: "text", text: ev.text, ts: ev.ts, key });
    } else if (ev.kind === "thinking") {
      turns.push({ kind: "thinking", text: ev.text, ts: ev.ts, key });
    } else if (ev.kind === "tool_use") {
      turns.push({
        kind: "tool",
        name: ev.name,
        input: ev.input,
        result: resultByToolId.get(ev.id) ?? null,
        ts: ev.ts,
        key,
      });
    }
  }
  return turns;
}

export default function Transcript({
  events,
  agent,
  runtime,
  onOpenSettings,
}: {
  events: TranscriptEvent[];
  agent: Agent | null;
  runtime: AgentRuntime | null;
  onOpenSettings?: () => void;
}) {
  const running = runtime?.alive ?? false;
  const uptimeSec = runtime?.uptimeSec ?? null;
  const sessionPath = runtime?.sessionPath ?? null;
  const pid = runtime?.pid ?? null;
  const scheduledRestartAt = runtime?.scheduledRestartAt ?? null;
  const enabled = agent?.enabled ?? false;
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const [stuckUI, setStuckUI] = useState(true);
  const lastScrollTopRef = useRef(0);

  const setStuck = (v: boolean) => {
    if (stuckRef.current !== v) {
      stuckRef.current = v;
      setStuckUI(v);
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollTopRef.current;
    const now = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - now - el.clientHeight;
    if (now < prev - 2) setStuck(false);
    else if (distanceFromBottom < 40) setStuck(true);
    lastScrollTopRef.current = now;
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuckRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [events]);

  useEffect(() => {
    const inner = innerRef.current;
    const el = scrollRef.current;
    if (!inner || !el) return;
    const ro = new ResizeObserver(() => {
      if (stuckRef.current) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const jumpToLive = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStuck(true);
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  };

  const turns = useMemo(
    () => buildTurns(events, agent?.direction ?? null),
    [events, agent?.direction],
  );

  const counts = useMemo(() => {
    let tools = 0;
    let chars = 0;
    for (const ev of events) {
      if (ev.kind === "tool_use") tools++;
      else if (ev.kind === "text") chars += ev.text.length;
      else if (ev.kind === "thinking") chars += ev.text.length;
    }
    return { tools, chars };
  }, [events]);

  const countdown = fmtCountdown(scheduledRestartAt);
  const statusInfo = resolveStatus({
    running,
    scheduledRestartAt,
    enabled,
    hasAgent: agent !== null,
  });
  const sessionShort = sessionPath
    ? (sessionPath.split("/").pop()?.split(".")[0]?.slice(0, 8) ?? "")
    : "";

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-zinc-800 px-4 text-[11px]">
        <span
          className={`shrink-0 font-medium ${statusInfo.labelClass} ${
            running ? "animate-pulse" : ""
          }`}
        >
          {statusInfo.label}
        </span>
        {countdown && (
          <span className="shrink-0 text-amber-400">auto-resume {countdown}</span>
        )}
        {running && uptimeSec !== null && (
          <span className="shrink-0 font-mono text-zinc-500">
            {fmtUptime(uptimeSec)}
          </span>
        )}
        {pid !== null && (
          <span className="shrink-0 font-mono text-zinc-600">pid {pid}</span>
        )}
        {sessionShort && (
          <span
            className="ml-auto shrink-0 font-mono text-zinc-600"
            title={sessionPath ?? undefined}
          >
            {sessionShort}
          </span>
        )}
        {agent && onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className={`shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 ${sessionShort ? "" : "ml-auto"}`}
            title="Agent settings"
          >
            <Settings size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto px-6 py-5"
      >
        <div ref={innerRef} className="mx-auto max-w-3xl space-y-4">
          {!agent && (
            <div className="text-sm italic text-zinc-600">
              select an agent on the left
            </div>
          )}
          {agent && turns.length === 0 && (
            <div className="text-sm italic text-zinc-600">
              waiting for events…
            </div>
          )}
          {turns.map((t, idx) => (
            <TurnView key={"key" in t ? t.key : `dir-${idx}`} turn={t} />
          ))}
        </div>
      </div>

      {!stuckUI && (
        <button
          onClick={jumpToLive}
          className="absolute bottom-16 right-4 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 shadow-lg hover:bg-zinc-800"
        >
          ↓ jump to live
        </button>
      )}

      <div className="flex h-6 items-center gap-3 border-t border-zinc-800 px-4 font-mono text-[10px] text-zinc-600">
        <span>{events.length} evt</span>
        <span>
          {counts.tools} tool{counts.tools === 1 ? "" : "s"}
        </span>
        <span>{counts.chars.toLocaleString()} chars</span>
        {running && (
          <span className="ml-auto flex items-center gap-1">
            <LiveDots />
          </span>
        )}
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === "direction")
    return <DirectionBubble text={turn.text} fileMode={turn.fileMode} />;
  if (turn.kind === "time")
    return (
      <TimeMarker
        ts={turn.ts}
        gapSec={turn.gapSec}
        showDate={turn.showDate}
      />
    );
  if (turn.kind === "text") return <AssistantText text={turn.text} />;
  if (turn.kind === "thinking")
    return <ThinkingRow text={turn.text} ts={turn.ts} />;
  return (
    <ToolRow
      name={turn.name}
      input={turn.input}
      result={turn.result}
      ts={turn.ts}
    />
  );
}

function fmtTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtGap(sec: number): string {
  if (sec < 60) return `+${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `+${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `+${h}h${rem}m` : `+${h}h`;
}

function TimeMarker({
  ts,
  gapSec,
  showDate,
}: {
  ts: number;
  gapSec: number | null;
  showDate: boolean;
}) {
  // Only surface the gap label when the pause is clearly longer than the
  // regular cadence — otherwise every routine marker would say "+5m".
  const showGap =
    gapSec !== null && gapSec >= TIME_MARKER_INTERVAL_SEC * 1.5;
  return (
    <div
      className="flex items-center gap-3 py-1 text-[10px] font-mono text-zinc-600 select-none"
      aria-hidden
    >
      <span className="h-px flex-1 bg-zinc-800" />
      <span className="shrink-0">
        {showDate && (
          <span className="mr-1.5 text-zinc-500">{fmtShortDate(ts)}</span>
        )}
        {fmtTimeOfDay(ts)}
        {showGap && (
          <span className="ml-1.5 text-zinc-700">{fmtGap(gapSec!)}</span>
        )}
      </span>
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );
}

function DirectionBubble({ text, fileMode }: { text: string; fileMode: boolean }) {
  return (
    <UserBubble>
      {fileMode && (
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
          reading file each turn
        </div>
      )}
      {fileMode ? <code className="font-mono">{text}</code> : text}
    </UserBubble>
  );
}
