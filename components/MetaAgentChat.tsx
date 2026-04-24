"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; text: string };
type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  partialJson: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
};

type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock;

type UsageInfo = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read?: number | null;
  cache_write?: number | null;
};

type Entry =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      blocks: AssistantBlock[];
      blockOrder: string[]; // keys in order of arrival
      blocksByKey: Record<string, number>; // key → index into blocks
      usage?: UsageInfo;
      error?: string;
      costUsd?: number;
      durationMs?: number;
    };

const HISTORY_KEY = "meta-agent.history.v2";
const SESSION_KEY = "meta-agent.session.v1";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function ToolUseView({ block }: { block: ToolUseBlock }) {
  const [open, setOpen] = useState(block.isError === true);
  const inputObj = block.input ?? tryParseJson(block.partialJson);
  const inputStr = inputObj
    ? JSON.stringify(inputObj, null, 2)
    : block.partialJson || "...";
  const shortInput =
    inputObj && typeof inputObj === "object"
      ? Object.entries(inputObj as Record<string, unknown>)
          .map(([k, v]) => {
            const val =
              typeof v === "string"
                ? v.length > 40
                  ? v.slice(0, 40) + "…"
                  : v
                : JSON.stringify(v);
            return `${k}=${val}`;
          })
          .join(" ")
      : "";
  const running = block.result === undefined;
  const statusIcon = running
    ? "⏳"
    : block.isError
      ? "⚠️"
      : "✓";
  const displayName = block.name.startsWith("mcp__houston__")
    ? block.name.slice("mcp__houston__".length)
    : block.name;
  return (
    <div className="my-1 rounded border border-zinc-800 bg-zinc-900/60 text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-2 px-2 py-1 text-left hover:bg-zinc-800/60"
      >
        <span className="font-mono text-zinc-500">{statusIcon}</span>
        <span className="font-mono text-amber-400">{displayName}</span>
        {shortInput && (
          <span className="truncate text-zinc-400">{shortInput}</span>
        )}
        <span className="ml-auto text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-2 py-1 font-mono text-[11px] leading-relaxed text-zinc-300">
          <div className="text-zinc-500">input</div>
          <pre className="whitespace-pre-wrap break-all">{inputStr}</pre>
          {block.result !== undefined && (
            <>
              <div className="mt-1 text-zinc-500">
                result{block.isError ? " (error)" : ""}
              </div>
              <pre
                className={`max-h-64 overflow-auto whitespace-pre-wrap break-all ${
                  block.isError ? "text-rose-300" : "text-emerald-300"
                }`}
              >
                {block.result}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingView({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false);
  if (!block.text) return null;
  return (
    <div className="my-1 text-xs italic text-zinc-500">
      <button onClick={() => setOpen(!open)} className="hover:text-zinc-300">
        {open ? "▾" : "▸"} thinking
      </button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border-l-2 border-zinc-700 pl-2 text-zinc-500">
          {block.text}
        </pre>
      )}
    </div>
  );
}

type Props = {
  onClose: () => void;
};

export default function MetaAgentChat({ onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Load history + session id.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setEntries(JSON.parse(saved));
    } catch {}
    try {
      const sid = localStorage.getItem(SESSION_KEY);
      if (sid) setSessionId(sid);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {}
  }, [entries]);
  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [sessionId]);

  // Autoscroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const patchAssistant = useCallback(
    (entryId: string, fn: (e: Entry & { role: "assistant" }) => Entry) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId && e.role === "assistant" ? fn(e) : e,
        ),
      );
    },
    [],
  );

  const newChat = useCallback(() => {
    if (streaming) return;
    setEntries([]);
    setSessionId(null);
    setError(null);
  }, [streaming]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      setError(null);
      const userEntry: Entry = { id: uid(), role: "user", text };
      const assistantEntry: Entry = {
        id: uid(),
        role: "assistant",
        blocks: [],
        blockOrder: [],
        blocksByKey: {},
      };
      setEntries((prev) => [...prev, userEntry, assistantEntry]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const resp = await fetch("/api/meta/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, message: text }),
          signal: ctrl.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`${resp.status} ${await resp.text()}`);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split("\n\n");
          buf = chunks.pop() ?? "";
          for (const raw of chunks) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }
            handleEvent(ev, assistantEntry.id, patchAssistant, setSessionId);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchAssistant(assistantEntry.id, (a) => ({
            ...a,
            error: "cancelled",
          }));
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          patchAssistant(assistantEntry.id, (a) => ({ ...a, error: msg }));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, streaming, patchAssistant],
  );

  const onSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      if (trimmed === "/clear" || trimmed === "/reset" || trimmed === "/new") {
        newChat();
        setInput("");
        return;
      }
      setInput("");
      void sendMessage(trimmed);
    },
    [input, sendMessage, newChat],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-zinc-200">meta-agent</span>
          <span className="text-zinc-500">claude-sonnet-4-6</span>
          {sessionId && (
            <span
              className="font-mono text-[10px] text-zinc-600"
              title={sessionId}
            >
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={newChat}
            disabled={streaming}
            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
            title="New chat"
          >
            new
          </button>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 text-sm">
        {entries.length === 0 && (
          <div className="space-y-2 text-xs text-zinc-500">
            <div className="font-medium text-zinc-400">
              I run as a local claude code instance — your OAuth, not an API key.
              Ask me anything about your agents.
            </div>
            <div className="text-zinc-600">Try:</div>
            <ul className="space-y-1 pl-2">
              <li className="hover:text-zinc-400">
                <button
                  onClick={() =>
                    setInput("What agents are running and how are they doing?")
                  }
                  className="text-left"
                >
                  • What agents are running and how are they doing?
                </button>
              </li>
              <li className="hover:text-zinc-400">
                <button
                  onClick={() =>
                    setInput(
                      "Summarize what each agent has been working on recently.",
                    )
                  }
                  className="text-left"
                >
                  • Summarize what each agent has been up to.
                </button>
              </li>
              <li className="hover:text-zinc-400">
                <button
                  onClick={() =>
                    setInput(
                      "Create a new agent in ~/scratch/cleanup that tidies stale markdown files in my vault.",
                    )
                  }
                  className="text-left"
                >
                  • Create a new agent that…
                </button>
              </li>
            </ul>
            <div className="pt-3 text-zinc-600">
              Slash commands: <code>/new</code> (reset session)
            </div>
          </div>
        )}
        {entries.map((e) => (
          <MessageView key={e.id} entry={e} />
        ))}
        {streaming && (
          <div className="mt-2 text-xs text-zinc-500">…</div>
        )}
        {error && !streaming && (
          <div className="mt-2 rounded border border-rose-900 bg-rose-950/50 px-2 py-1 text-xs text-rose-300">
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-zinc-800 p-2">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder={
              sessionId
                ? "Continue the conversation…"
                : "Ask about your agents…"
            }
            rows={2}
            className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
            disabled={streaming}
          />
          <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-600">
            <span>Enter to send · Shift+Enter for newline</span>
            {streaming ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded border border-zinc-700 px-1.5 py-0.5 hover:bg-zinc-800"
              >
                cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded border border-zinc-700 px-1.5 py-0.5 hover:bg-zinc-800 disabled:opacity-40"
              >
                send
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function MessageView({ entry }: { entry: Entry }) {
  if (entry.role === "user") {
    return (
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-wide text-zinc-600">
          you
        </div>
        <div className="whitespace-pre-wrap text-zinc-200">{entry.text}</div>
      </div>
    );
  }
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">
        meta-agent
      </div>
      {entry.blocks.map((b, i) => {
        if (b.type === "text") {
          return (
            <div key={i} className="whitespace-pre-wrap text-zinc-100">
              {b.text}
            </div>
          );
        }
        if (b.type === "thinking") {
          return <ThinkingView key={i} block={b} />;
        }
        return <ToolUseView key={i} block={b} />;
      })}
      {entry.error && (
        <div className="mt-1 text-xs text-rose-400">error: {entry.error}</div>
      )}
      {(entry.usage || entry.costUsd !== undefined) && (
        <div className="mt-1 text-[10px] text-zinc-600">
          {entry.usage?.input_tokens !== undefined && (
            <>in {entry.usage.input_tokens} · </>
          )}
          {entry.usage?.output_tokens !== undefined && (
            <>out {entry.usage.output_tokens}</>
          )}
          {entry.usage?.cache_read ? ` · cache ${entry.usage.cache_read}` : ""}
          {entry.costUsd !== undefined && (
            <> · ${entry.costUsd.toFixed(4)}</>
          )}
          {entry.durationMs !== undefined && (
            <> · {(entry.durationMs / 1000).toFixed(1)}s</>
          )}
        </div>
      )}
    </div>
  );
}

type PatchFn = (
  entryId: string,
  fn: (e: Entry & { role: "assistant" }) => Entry,
) => void;

function upsertBlock(
  entry: Entry & { role: "assistant" },
  key: string,
  block: AssistantBlock,
): Entry {
  if (entry.blocksByKey[key] !== undefined) {
    return entry;
  }
  const blocks = [...entry.blocks, block];
  return {
    ...entry,
    blocks,
    blockOrder: [...entry.blockOrder, key],
    blocksByKey: { ...entry.blocksByKey, [key]: blocks.length - 1 },
  };
}

function mutateBlock(
  entry: Entry & { role: "assistant" },
  key: string,
  fn: (b: AssistantBlock) => AssistantBlock,
): Entry {
  const idx = entry.blocksByKey[key];
  if (idx === undefined) return entry;
  const blocks = entry.blocks.slice();
  blocks[idx] = fn(blocks[idx]);
  return { ...entry, blocks };
}

function mutateToolByUseId(
  entry: Entry & { role: "assistant" },
  tool_use_id: string,
  fn: (b: ToolUseBlock) => ToolUseBlock,
): Entry {
  const blocks = entry.blocks.map((b) =>
    b.type === "tool_use" && b.id === tool_use_id ? fn(b) : b,
  );
  return { ...entry, blocks };
}

function handleEvent(
  ev: Record<string, unknown>,
  entryId: string,
  patch: PatchFn,
  setSessionId: (s: string) => void,
) {
  const type = ev.type as string;
  const key = ev.key as string | undefined;

  switch (type) {
    case "session":
      setSessionId(String(ev.sessionId));
      break;
    case "text_start":
      if (key)
        patch(entryId, (a) => upsertBlock(a, key, { type: "text", text: "" }));
      break;
    case "thinking_start":
      if (key)
        patch(entryId, (a) =>
          upsertBlock(a, key, { type: "thinking", text: "" }),
        );
      break;
    case "tool_start":
      if (key)
        patch(entryId, (a) =>
          upsertBlock(a, key, {
            type: "tool_use",
            id: String(ev.tool_use_id),
            name: String(ev.name),
            partialJson: "",
          }),
        );
      break;
    case "text_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "text"
              ? { ...b, text: b.text + String(ev.text ?? "") }
              : b,
          ),
        );
      break;
    case "thinking_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "thinking"
              ? { ...b, text: b.text + String(ev.text ?? "") }
              : b,
          ),
        );
      break;
    case "tool_input_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "tool_use"
              ? {
                  ...b,
                  partialJson: b.partialJson + String(ev.partial_json ?? ""),
                }
              : b,
          ),
        );
      break;
    case "tool_result": {
      const tuid = String(ev.tool_use_id);
      patch(entryId, (a) =>
        mutateToolByUseId(a, tuid, (b) => {
          const raw = String(ev.content ?? "");
          const parsedInput =
            b.input !== undefined ? b.input : tryParseJson(b.partialJson);
          return {
            ...b,
            result: raw,
            isError: Boolean(ev.is_error),
            input: parsedInput,
          };
        }),
      );
      break;
    }
    case "block_stop":
      // Finalize tool input JSON parse.
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "tool_use" && b.input === undefined
              ? { ...b, input: tryParseJson(b.partialJson) }
              : b,
          ),
        );
      break;
    case "usage":
      patch(entryId, (a) => ({
        ...a,
        usage: {
          input_tokens: ev.input_tokens as number | undefined,
          output_tokens: ev.output_tokens as number | undefined,
          cache_read: ev.cache_read as number | null,
          cache_write: ev.cache_write as number | null,
        },
      }));
      break;
    case "result":
      patch(entryId, (a) => ({
        ...a,
        costUsd:
          typeof ev.total_cost_usd === "number"
            ? (ev.total_cost_usd as number)
            : a.costUsd,
        durationMs:
          typeof ev.duration_ms === "number"
            ? (ev.duration_ms as number)
            : a.durationMs,
      }));
      break;
    case "error":
      patch(entryId, (a) => ({ ...a, error: String(ev.message) }));
      break;
  }
}
