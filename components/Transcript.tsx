"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Agent, TranscriptEvent } from "@/lib/types";

type Turn =
  | { kind: "direction"; text: string; fileMode: boolean }
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

function summarize(name: string, input: Record<string, unknown>): string {
  if (name === "Bash" && typeof input.command === "string") {
    return input.command.split("\n")[0].slice(0, 120);
  }
  if ((name === "Read" || name === "Write" || name === "Edit" || name === "NotebookEdit") && typeof input.file_path === "string") {
    return shortPath(input.file_path);
  }
  if (name === "Grep" && typeof input.pattern === "string") {
    const extra = typeof input.path === "string" ? ` in ${shortPath(input.path)}` : "";
    return input.pattern + extra;
  }
  if (name === "Glob" && typeof input.pattern === "string") return input.pattern;
  if (name === "WebFetch" && typeof input.url === "string") return input.url;
  if (name === "WebSearch" && typeof input.query === "string") return input.query;
  if (name === "Task" && typeof input.description === "string") return input.description;
  if (name === "TodoWrite") return "update todo list";
  if (typeof input.description === "string") return input.description;
  if (typeof input.prompt === "string") return input.prompt.slice(0, 120);
  return "";
}

function shortPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return "…/" + parts.slice(-2).join("/");
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

function buildTurns(events: TranscriptEvent[], direction: Agent["direction"] | null): Turn[] {
  const turns: Turn[] = [];
  if (direction) {
    if (direction.kind === "inline") {
      turns.push({ kind: "direction", text: direction.prompt, fileMode: false });
    } else {
      turns.push({ kind: "direction", text: direction.filePath, fileMode: true });
    }
  }

  // Pass 1: collect tool_results by toolUseId so we can attach.
  const resultByToolId = new Map<string, { content: string; isError: boolean }>();
  for (const ev of events) {
    if (ev.kind === "tool_result") {
      resultByToolId.set(ev.toolUseId, { content: ev.content, isError: ev.isError });
    }
  }

  // Pass 2: emit turns in order, skipping tool_result/system/result.
  let i = 0;
  for (const ev of events) {
    const key = `${ev.ts}-${i++}`;
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
    // system/result/tool_result: hidden from the chat view.
  }
  return turns;
}

export default function Transcript({
  events,
  agent,
  running,
  uptimeSec,
  sessionPath,
}: {
  events: TranscriptEvent[];
  agent: Agent | null;
  running: boolean;
  uptimeSec: number | null;
  sessionPath: string | null;
}) {
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

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="min-w-0 text-sm font-medium text-zinc-200 truncate">
          {agent?.name ?? "no agent selected"}
        </div>
        <div
          className="ml-4 shrink-0 truncate max-w-[55%] text-[11px] font-mono text-zinc-600"
          title={sessionPath ?? undefined}
        >
          {sessionPath?.split("/").pop() ?? ""}
        </div>
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
            <div className="text-sm italic text-zinc-600">waiting for events…</div>
          )}
          {turns.map((t, idx) => (
            <TurnView key={"key" in t ? t.key : `dir-${idx}`} turn={t} />
          ))}
        </div>
      </div>

      {!stuckUI && (
        <button
          onClick={jumpToLive}
          className="absolute bottom-16 right-4 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200 shadow-lg hover:bg-zinc-700"
        >
          ↓ jump to live
        </button>
      )}

      <div className="flex items-center gap-3 h-7 px-4 border-t border-zinc-800 text-[11px] font-mono text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              running ? "bg-emerald-500 animate-pulse" : "bg-zinc-700"
            }`}
          />
          {running ? "running" : "idle"}
        </span>
        <span>{fmtUptime(uptimeSec)}</span>
        <span>{events.length} evt</span>
        <span>
          {counts.tools} tool{counts.tools === 1 ? "" : "s"}
        </span>
        <span>{counts.chars.toLocaleString()} chars</span>
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === "direction") return <DirectionBubble text={turn.text} fileMode={turn.fileMode} />;
  if (turn.kind === "text") return <AssistantText text={turn.text} />;
  if (turn.kind === "thinking") return <ThinkingBlock text={turn.text} />;
  return <ToolRow turn={turn} />;
}

function DirectionBubble({ text, fileMode }: { text: string; fileMode: boolean }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-zinc-800 text-zinc-100 px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
        {fileMode && (
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            reading file each turn
          </div>
        )}
        {fileMode ? <code className="font-mono">{text}</code> : text}
      </div>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.split("\n")[0].slice(0, 200);
  return (
    <div className="text-[12px] italic text-zinc-500">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-baseline gap-1.5 w-full text-left hover:text-zinc-300"
      >
        <span
          className={`inline-block w-3 text-center transition-transform shrink-0 not-italic text-zinc-600 ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="text-[10px] uppercase tracking-wider not-italic text-zinc-600 shrink-0">
          thinking
        </span>
        {!open && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </button>
      {open && (
        <div className="mt-1 ml-5 border-l border-zinc-800 pl-3 whitespace-pre-wrap text-zinc-400">
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-zinc-200">
      <ReactMarkdown
        components={{
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          strong: (props) => <strong className="font-semibold text-white" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          h1: (props) => <h1 className="text-[15px] font-semibold text-white mt-3 mb-2" {...props} />,
          h2: (props) => <h2 className="text-[14px] font-semibold text-white mt-3 mb-1.5" {...props} />,
          h3: (props) => <h3 className="text-[13px] font-semibold text-white mt-2 mb-1" {...props} />,
          ul: (props) => <ul className="list-disc pl-5 my-2 space-y-0.5 marker:text-zinc-600" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5 my-2 space-y-0.5 marker:text-zinc-600" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => (
            <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400" {...props} />
          ),
          a: (props) => (
            <a
              className="text-emerald-400 underline hover:text-emerald-300"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  className="px-1 py-0.5 rounded bg-zinc-800 text-[12px] text-zinc-200 font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="block px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-[12px] font-mono text-zinc-200 overflow-x-auto"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => (
            <pre className="my-2" {...props}>
              {children}
            </pre>
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="border-collapse text-[12px] w-full" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-zinc-700 px-2 py-1 text-left bg-zinc-900 font-semibold" {...props} />
          ),
          td: (props) => <td className="border border-zinc-700 px-2 py-1" {...props} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ToolRow({ turn }: { turn: Extract<Turn, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const summary = summarize(turn.name, turn.input);
  const hasResult = turn.result !== null;
  const isError = turn.result?.isError ?? false;
  const inputJson = useMemo(
    () => JSON.stringify(turn.input, null, 2),
    [turn.input],
  );

  return (
    <div className="text-[11px] font-mono text-zinc-500">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-start gap-1.5 w-full text-left hover:text-zinc-300"
      >
        <span
          className={`inline-block w-3 text-center transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className={`shrink-0 ${isError ? "text-red-400" : "text-emerald-400"}`}>
          {turn.name}
        </span>
        <span className="truncate opacity-70">{summary}</span>
        {hasResult && isError && (
          <span className="ml-auto shrink-0 text-red-400">error</span>
        )}
      </button>
      {open && (
        <div className="mt-1 ml-4 space-y-1">
          <pre className="px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 whitespace-pre-wrap break-all text-[11px] text-zinc-300 max-h-64 overflow-auto">
            {inputJson}
          </pre>
          {turn.result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-0.5">
                result{isError ? " (error)" : ""}
              </div>
              <pre
                className={`px-2 py-1.5 rounded bg-zinc-900 border whitespace-pre-wrap break-all text-[11px] max-h-64 overflow-auto ${
                  isError ? "border-red-900 text-red-300" : "border-zinc-800 text-zinc-400"
                }`}
              >
                {turn.result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
