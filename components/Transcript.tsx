"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TranscriptEvent } from "@/lib/types";

const KIND_STYLE: Record<TranscriptEvent["kind"], string> = {
  text: "border-l-2 border-blue-500/60 bg-blue-500/5",
  thinking: "border-l-2 border-purple-500/60 bg-purple-500/5",
  tool_use: "border-l-2 border-amber-500/60 bg-amber-500/5",
  tool_result: "border-l-2 border-zinc-600 bg-zinc-900/40",
  system: "border-l-2 border-zinc-700 bg-zinc-900/20 text-zinc-500",
  result: "border-l-2 border-zinc-700 bg-zinc-900/20 text-zinc-500",
};

const KIND_LABEL: Record<TranscriptEvent["kind"], string> = {
  text: "ASSISTANT",
  thinking: "THINKING",
  tool_use: "TOOL",
  tool_result: "RESULT",
  system: "SYSTEM",
  result: "DONE",
};

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function summarizeToolInput(input: Record<string, unknown>): string {
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return input.command.slice(0, 200);
  if (typeof input.pattern === "string") return input.pattern;
  if (typeof input.url === "string") return input.url;
  if (typeof input.query === "string") return input.query;
  if (typeof input.description === "string") return input.description;
  if (typeof input.prompt === "string") return input.prompt.slice(0, 200);
  return JSON.stringify(input).slice(0, 200);
}

export default function Transcript({
  events,
  agentName,
  sessionPath,
}: {
  events: TranscriptEvent[];
  agentName: string | null;
  sessionPath: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // stuck-to-bottom is the source of truth for autoscroll. Using a ref so the
  // scroll handler can update it synchronously without batched re-renders.
  const stuckRef = useRef(true);
  const [stuckUI, setStuckUI] = useState(true);
  const lastScrollTopRef = useRef(0);

  const setStuck = (v: boolean) => {
    if (stuckRef.current !== v) {
      stuckRef.current = v;
      setStuckUI(v);
    }
  };

  // Detect user scroll intent: if scrollTop decreased from last time, user
  // scrolled up. Resume autoscroll only when they scroll back to within ~40px
  // of the bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollTopRef.current;
    const now = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - now - el.clientHeight;
    if (now < prev - 2) {
      // user scrolled up
      setStuck(false);
    } else if (distanceFromBottom < 40) {
      setStuck(true);
    }
    lastScrollTopRef.current = now;
  };

  // useLayoutEffect: scroll BEFORE the browser paints, so the user never sees
  // a flash of the un-scrolled state when stuck.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuckRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [events]);

  // Watch the inner content for size changes (event expansion etc.) and
  // re-pin to bottom if currently stuck.
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

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="text-xs text-zinc-500">
          {agentName ?? "no agent selected"}
          <span className="ml-2 text-zinc-600">{events.length} events</span>
        </div>
        <div className="text-xs text-zinc-600 truncate max-w-[55%]" title={sessionPath ?? undefined}>
          {sessionPath?.split("/").pop() ?? "no session"}
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto px-4 py-2 font-mono text-xs"
      >
        <div ref={innerRef}>
          {events.length === 0 && (
            <div className="text-zinc-600 italic">waiting for events…</div>
          )}
          {events.map((ev, i) => (
            <Event key={i} ev={ev} />
          ))}
        </div>
      </div>
      {!stuckUI && (
        <button
          onClick={jumpToLive}
          className="absolute bottom-4 right-4 rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 shadow-lg hover:bg-zinc-700"
        >
          ↓ jump to live
        </button>
      )}
    </div>
  );
}

function Event({ ev }: { ev: TranscriptEvent }) {
  const [open, setOpen] = useState(false);
  const cls = KIND_STYLE[ev.kind];
  const label = KIND_LABEL[ev.kind];

  let preview = "";
  let full = "";
  if (ev.kind === "text") {
    preview = ev.text.split("\n")[0].slice(0, 300);
    full = ev.text;
  } else if (ev.kind === "thinking") {
    preview = ev.text.split("\n")[0].slice(0, 300);
    full = ev.text;
  } else if (ev.kind === "tool_use") {
    preview = `${ev.name}(${summarizeToolInput(ev.input)})`;
    full = JSON.stringify(ev.input, null, 2);
  } else if (ev.kind === "tool_result") {
    preview = ev.content.split("\n").slice(0, 2).join(" ").slice(0, 300);
    full = ev.content;
  } else if (ev.kind === "system") {
    preview = `subtype: ${ev.subtype}`;
  } else if (ev.kind === "result") {
    preview = `${ev.subtype} (${ev.durationMs}ms)`;
  }

  const expandable = full.length > preview.length;

  return (
    <div className={`mb-1 rounded-r px-3 py-1.5 ${cls}`}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] font-bold text-zinc-500">{label}</span>
        <span className="shrink-0 text-[10px] text-zinc-600">{fmtTs(ev.ts)}</span>
        <span
          className={`min-w-0 flex-1 break-words text-zinc-200 ${ev.kind === "tool_result" && (ev as { isError?: boolean }).isError ? "text-red-400" : ""}`}
        >
          {preview}
        </span>
        {expandable && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      {open && expandable && (
        <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[11px] text-zinc-300">
          {full}
        </pre>
      )}
    </div>
  );
}
