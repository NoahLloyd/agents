"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Entry,
  type SavedConversation,
  MAX_SAVED,
  uid,
  conversationTitle,
  handleEvent,
} from "@/lib/chat-shared";
import { ChatInput, HistoryPanel, LiveDots, MessageView } from "./ChatPieces";

const HISTORY_KEY = "meta-agent.history.v2";
const SESSION_KEY = "meta-agent.session.v1";
const CONVERSATIONS_KEY = "meta-agent.conversations.v1";
const MODEL_LABEL = "claude-sonnet-4-6";

const SUGGESTIONS = [
  "What agents are running and how are they doing?",
  "Summarize what each agent has been working on recently.",
  "Create a new agent in ~/scratch/cleanup that tidies stale markdown files in my vault.",
];

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

type Props = { onClose: () => void };

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
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries)); } catch {}
  }, [entries]);

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    if (entries.length === 0 || !sessionId) return;
    setConversations((prev) => {
      const conv: SavedConversation = {
        sessionId,
        title: conversationTitle(entries),
        timestamp: Date.now(),
        entries,
      };
      const filtered = prev.filter((c) => c.sessionId !== sessionId);
      const next = [conv, ...filtered].slice(0, MAX_SAVED);
      saveConversations(next);
      return next;
    });
  }, [entries, sessionId]);

  const setStuck = (v: boolean) => {
    if (stuckRef.current !== v) { stuckRef.current = v; setStuckUI(v); }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollTopRef.current;
    const now = el.scrollTop;
    if (now < prev - 2) setStuck(false);
    else if (el.scrollHeight - now - el.clientHeight < 40) setStuck(true);
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
      if (stuckRef.current) { el.scrollTop = el.scrollHeight; lastScrollTopRef.current = el.scrollTop; }
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

  useEffect(() => { if (!historyOpen) inputRef.current?.focus(); }, [historyOpen]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const patchAssistant = useCallback(
    (entryId: string, fn: (e: Entry & { role: "assistant" }) => Entry) => {
      setEntries((prev) =>
        prev.map((e) => e.id === entryId && e.role === "assistant" ? fn(e) : e),
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
    saveCurrentToHistory(entries, sessionId);
    setEntries([]);
    setSessionId(null);
    setError(null);
    setHistoryOpen(false);
  }, [streaming, entries, sessionId, saveCurrentToHistory]);

  const restoreConversation = useCallback(
    (conv: SavedConversation) => {
      if (streaming) return;
      saveCurrentToHistory(entries, sessionId);
      setEntries(conv.entries);
      setSessionId(conv.sessionId);
      setError(null);
      setHistoryOpen(false);
      stuckRef.current = true;
      setStuckUI(true);
    },
    [streaming, entries, sessionId, saveCurrentToHistory],
  );

  const deleteConversation = useCallback(
    (sid: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversations((prev) => {
        const next = prev.filter((c) => c.sessionId !== sid);
        saveConversations(next);
        return next;
      });
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      abortRef.current?.abort();
      setError(null);
      stuckRef.current = true;
      setStuckUI(true);
      const userEntry: Entry = { id: uid(), role: "user", text };
      const assistantEntry: Entry = { id: uid(), role: "assistant", blocks: [], blockOrder: [], blocksByKey: {} };
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
        if (!resp.ok || !resp.body) throw new Error(`${resp.status} ${await resp.text()}`);
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
            try { ev = JSON.parse(payload); } catch { continue; }
                  handleEvent(ev, assistantEntry.id, patchAssistant, setSessionId);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          patchAssistant(assistantEntry.id, (a) => ({ ...a, error: "cancelled" }));
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

  const onSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (trimmed === "/clear" || trimmed === "/reset" || trimmed === "/new") {
      newChat();
      setInput("");
      return;
    }
    setInput("");
    void sendMessage(trimmed);
  }, [input, sendMessage, newChat]);

  if (historyOpen) {
    return (
      <HistoryPanel
        title="History"
        conversations={conversations}
        onRestore={restoreConversation}
        onDelete={deleteConversation}
        onBack={() => setHistoryOpen(false)}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-200">Meta</span>
          <span className="shrink-0 text-[10px] text-zinc-500">{MODEL_LABEL}</span>
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
          >
            history{conversations.length > 0 ? ` (${conversations.length})` : ""}
          </button>
          <button
            onClick={newChat}
            disabled={streaming || entries.length === 0}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            new
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            title="Close (Esc)"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-5">
        <div ref={innerRef} className="mx-auto max-w-2xl space-y-4">
          {entries.length === 0 && <EmptyState onPick={(s) => setInput(s)} />}
          {entries.map((e) => (
            <MessageView key={e.id} entry={e} streaming={streaming} onAnswerQuestion={(text) => { void sendMessage(text); }} />
          ))}
          {streaming &&
            entries[entries.length - 1]?.role === "assistant" &&
            (entries[entries.length - 1] as Entry & { role: "assistant" }).blocks.length === 0 && (
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

      <ChatInput
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={onSubmit}
        placeholder={sessionId ? "Continue the conversation…" : "Ask about your agents…"}
        images={[]}
        onAddImage={() => {}}
        onRemoveImage={() => {}}
      />
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
            <span className="text-zinc-600 group-hover:text-emerald-500">→</span>
            <span className="min-w-0 flex-1">{s}</span>
          </button>
        ))}
      </div>
      <div className="text-[10px] text-zinc-600">
        Slash commands:{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-400">/new</code>{" "}
        save and reset session
      </div>
    </div>
  );
}
