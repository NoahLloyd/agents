"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AssistantText,
  LiveDots,
  ThinkingRow,
  ToolRow,
  UserBubble,
} from "./ChatPieces";

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
      blockOrder: string[];
      blocksByKey: Record<string, number>;
      usage?: UsageInfo;
      error?: string;
      costUsd?: number;
      durationMs?: number;
    };

type SavedConversation = {
  sessionId: string;
  title: string;
  timestamp: number;
  entries: Entry[];
};

const HISTORY_KEY = "meta-agent.history.v2";
const SESSION_KEY = "meta-agent.session.v1";
const CONVERSATIONS_KEY = "meta-agent.conversations.v1";
const MODEL_LABEL = "claude-sonnet-4-6";
const MAX_SAVED = 30;

const SUGGESTIONS = [
  "What agents are running and how are they doing?",
  "Summarize what each agent has been working on recently.",
  "Create a new agent in ~/scratch/cleanup that tidies stale markdown files in my vault.",
];

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

function conversationTitle(entries: Entry[]): string {
  const first = entries.find((e) => e.role === "user");
  if (!first || first.role !== "user") return "Untitled";
  return first.text.slice(0, 60) + (first.text.length > 60 ? "…" : "");
}

function loadConversations(): SavedConversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: SavedConversation[]): void {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs));
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stuckRef = useRef(true);
  const [stuckUI, setStuckUI] = useState(true);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setEntries(JSON.parse(saved));
    } catch {}
    try {
      const sid = localStorage.getItem(SESSION_KEY);
      if (sid) setSessionId(sid);
    } catch {}
    setConversations(loadConversations());
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
  }, [entries]);

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

  useEffect(() => {
    if (!historyOpen) inputRef.current?.focus();
  }, [historyOpen]);

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

  const saveCurrentToHistory = useCallback(
    (currentEntries: Entry[], currentSessionId: string | null) => {
      if (currentEntries.length === 0 || !currentSessionId) return;
      const conv: SavedConversation = {
        sessionId: currentSessionId,
        title: conversationTitle(currentEntries),
        timestamp: Date.now(),
        entries: currentEntries,
      };
      setConversations((prev) => {
        // Replace if same sessionId, otherwise prepend (cap at MAX_SAVED)
        const filtered = prev.filter((c) => c.sessionId !== currentSessionId);
        const next = [conv, ...filtered].slice(0, MAX_SAVED);
        saveConversations(next);
        return next;
      });
    },
    [],
  );

  const newChat = useCallback(() => {
    if (streaming) return;
    // Save current before clearing
    saveCurrentToHistory(entries, sessionId);
    setEntries([]);
    setSessionId(null);
    setError(null);
    setHistoryOpen(false);
  }, [streaming, entries, sessionId, saveCurrentToHistory]);

  const restoreConversation = useCallback(
    (conv: SavedConversation) => {
      if (streaming) return;
      // Save current first if it's different
      saveCurrentToHistory(entries, sessionId);
      setEntries(conv.entries);
      setSessionId(conv.sessionId);
      setError(null);
      setHistoryOpen(false);
      // Scroll to bottom
      stuckRef.current = true;
      setStuckUI(true);
    },
    [streaming, entries, sessionId, saveCurrentToHistory],
  );

  const deleteConversation = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversations((prev) => {
        const next = prev.filter((c) => c.sessionId !== sessionId);
        saveConversations(next);
        return next;
      });
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      if (abortRef.current) abortRef.current.abort();
      setError(null);
      stuckRef.current = true;
      setStuckUI(true);
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
    [sessionId, patchAssistant],
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

  if (historyOpen) {
    return (
      <div className="relative flex h-full flex-col bg-zinc-950">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3">
          <span className="text-sm font-medium text-zinc-200">History</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setHistoryOpen(false)}
              className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              ← back
            </button>
            <button
              onClick={onClose}
              className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-600">
              no saved conversations yet
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {conversations.map((conv) => (
                <button
                  key={conv.sessionId}
                  onClick={() => restoreConversation(conv)}
                  className="group flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-200">{conv.title}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">
                      {new Date(conv.timestamp).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                      {" · "}
                      <span className="font-mono">{conv.sessionId.slice(0, 8)}</span>
                    </div>
                  </div>
                  <span
                    onClick={(e) => deleteConversation(conv.sessionId, e)}
                    className="mt-0.5 shrink-0 text-[10px] text-zinc-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                    title="delete"
                  >
                    ✕
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-200">
            Meta
          </span>
          <span className="shrink-0 text-[10px] text-zinc-500">
            {MODEL_LABEL}
          </span>
          {sessionId && (
            <span
              className="shrink-0 rounded border border-zinc-800 px-1 font-mono text-[10px] text-zinc-600"
              title={sessionId}
            >
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title="Past conversations"
          >
            history{conversations.length > 0 ? ` (${conversations.length})` : ""}
          </button>
          <button
            onClick={newChat}
            disabled={streaming || entries.length === 0}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent"
            title="Save and start new session"
          >
            new
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-5"
      >
        <div ref={innerRef} className="mx-auto max-w-2xl space-y-4">
          {entries.length === 0 && (
            <EmptyState onPick={(s) => setInput(s)} />
          )}
          {entries.map((e) => (
            <MessageView key={e.id} entry={e} streaming={streaming} />
          ))}
          {streaming &&
            entries[entries.length - 1]?.role === "assistant" &&
            (entries[entries.length - 1] as Entry & { role: "assistant" })
              .blocks.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] italic text-zinc-500">
                <LiveDots /> thinking…
              </div>
            )}
          {error && !streaming && (
            <div className="rounded border border-rose-900 bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {!stuckUI && (
        <button
          onClick={jumpToLive}
          className="absolute bottom-14 right-4 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 shadow-lg hover:bg-zinc-800"
        >
          ↓ jump to live
        </button>
      )}

      <form onSubmit={onSubmit} className="shrink-0 border-t border-zinc-800">
        <div className="relative bg-zinc-900 transition focus-within:bg-zinc-900">
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
            className="w-full resize-none bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </div>
      </form>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="group flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left text-[12px] text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <span className="text-zinc-600 group-hover:text-emerald-500">
              →
            </span>
            <span className="min-w-0 flex-1">{s}</span>
          </button>
        ))}
      </div>
      <div className="text-[10px] text-zinc-600">
        Slash commands:{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">
          /new
        </code>{" "}
        save and reset session
      </div>
    </div>
  );
}

function MessageView({
  entry,
  streaming,
}: {
  entry: Entry;
  streaming: boolean;
}) {
  if (entry.role === "user") {
    return <UserBubble>{entry.text}</UserBubble>;
  }

  return (
    <div className="space-y-2">
      {entry.blocks.map((b, i) => {
        if (b.type === "text") {
          return <AssistantText key={i} text={b.text} />;
        }
        if (b.type === "thinking") {
          return <ThinkingRow key={i} text={b.text} />;
        }
        const parsedInput =
          b.input !== undefined
            ? (b.input as Record<string, unknown>)
            : (tryParseJson(b.partialJson) as
                | Record<string, unknown>
                | undefined);
        return (
          <ToolRow
            key={i}
            name={b.name}
            input={parsedInput}
            partialJson={b.partialJson}
            result={
              b.result !== undefined
                ? { content: b.result, isError: b.isError === true }
                : null
            }
            running={b.result === undefined && streaming}
          />
        );
      })}
      {entry.error && (
        <div className="text-xs text-rose-400">error: {entry.error}</div>
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
  if (entry.blocksByKey[key] !== undefined) return entry;
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
        patch(entryId, (a) =>
          upsertBlock(a, key, { type: "text", text: "" }),
        );
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
