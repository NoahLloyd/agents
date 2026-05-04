"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Entry,
  type PastedImage,
  type SavedConversation,
  MAX_SAVED,
  uid,
  conversationTitle,
  handleEvent,
} from "@/lib/chat-shared";
import { ChatInput, HistoryPanel, LiveDots, MessageView } from "./ChatPieces";

// ── Storage (keyed per chatKey) ─────────────────────────────────────────────────

function storageKey(chatKey: string) {
  return `agent-chat.conversations.v1.${chatKey}`;
}

function loadConversations(chatKey: string): SavedConversation[] {
  try {
    const raw = localStorage.getItem(storageKey(chatKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations(chatKey: string, convs: SavedConversation[]): void {
  try { localStorage.setItem(storageKey(chatKey), JSON.stringify(convs)); } catch {}
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentChat({
  chatKey,
  displayName,
  workingDir,
  onStreamingChange,
}: {
  chatKey: string;
  displayName: string;
  workingDir: string;
  onStreamingChange?: (streaming: boolean) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  // Queued message to send as soon as current streaming finishes
  const [queued, setQueued] = useState<{ text: string; images: PastedImage[] } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stuckRef = useRef(true);
  const [stuckUI, setStuckUI] = useState(true);
  const lastScrollTopRef = useRef(0);

  useEffect(() => { onStreamingChange?.(streaming); }, [streaming, onStreamingChange]);
  useEffect(() => { setConversations(loadConversations(chatKey)); }, [chatKey]);

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
      saveConversations(chatKey, next);
      return next;
    });
  }, [entries, sessionId, chatKey]);

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

  useEffect(() => { if (!historyOpen) inputRef.current?.focus(); }, [historyOpen]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const jumpToLive = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStuck(true);
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  };

  const patchAssistant = useCallback(
    (entryId: string, fn: (e: Entry & { role: "assistant" }) => Entry) => {
      setEntries((prev) =>
        prev.map((e) => e.id === entryId && e.role === "assistant" ? fn(e as Entry & { role: "assistant" }) : e),
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
        saveConversations(chatKey, next);
        return next;
      });
    },
    [chatKey],
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
        saveConversations(chatKey, next);
        return next;
      });
    },
    [chatKey],
  );

  const sendMessage = useCallback(
    async (text: string, imgs: PastedImage[]) => {
      abortRef.current?.abort();
      setError(null);
      stuckRef.current = true;
      setStuckUI(true);
      const userEntry: Entry = { id: uid(), role: "user", text, images: imgs.length > 0 ? imgs : undefined };
      const assistantEntry: Entry = { id: uid(), role: "assistant", blocks: [], blockOrder: [], blocksByKey: {} };
      setEntries((prev) => [...prev, userEntry, assistantEntry]);
      setStreaming(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const resp = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workingDir,
            sessionId,
            message: text,
            images: imgs.length > 0 ? imgs.map((i) => ({ mimeType: i.mimeType, base64: i.base64 })) : undefined,
          }),
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
    [workingDir, sessionId, patchAssistant],
  );

  // Auto-send queued message when streaming finishes
  useEffect(() => {
    if (streaming || !queued) return;
    const msg = queued;
    setQueued(null);
    void sendMessage(msg.text, msg.images);
  }, [streaming, queued, sendMessage]);

  const onSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && images.length === 0) return;
    if (streaming) {
      // Queue it — will fire as soon as current response ends
      setQueued({ text: trimmed, images });
      setInput("");
      setImages([]);
      return;
    }
    setInput("");
    setImages([]);
    void sendMessage(trimmed, images);
  }, [input, images, streaming, sendMessage]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  if (historyOpen) {
    return (
      <HistoryPanel
        title={`History · ${displayName}`}
        conversations={conversations}
        onRestore={restoreConversation}
        onDelete={deleteConversation}
        onBack={() => setHistoryOpen(false)}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-200">{displayName}</span>
          <span className="shrink-0 text-[10px] text-zinc-500">chat</span>
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
          {streaming && (
            <button
              onClick={cancel}
              className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              stop
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-5">
        <div ref={innerRef} className="mx-auto max-w-2xl space-y-4">
          {entries.length === 0 && (
            <div className="space-y-2 text-[12px] text-zinc-600">
              <p>Ask anything about what&apos;s happening in <span className="font-mono text-zinc-400">{workingDir.split("/").slice(-2).join("/")}</span>.</p>
              <p className="text-[11px]">This session has full access to read and write files in the working directory. You can also paste images.</p>
            </div>
          )}
          {entries.map((e) => (
            <MessageView key={e.id} entry={e} streaming={streaming} onAnswerQuestion={(text) => { void sendMessage(text, []); }} />
          ))}
          {streaming && entries[entries.length - 1]?.role === "assistant" &&
            (entries[entries.length - 1] as Entry & { role: "assistant" }).blocks.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] italic text-zinc-500">
                <LiveDots /> thinking…
              </div>
            )}
          {queued && (
            <div className="flex justify-end">
              <div className="flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-3 py-1.5 text-[12px] text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="italic">queued: {queued.text.slice(0, 40)}{queued.text.length > 40 ? "…" : ""}</span>
              </div>
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
        placeholder={queued ? "Another message queued…" : sessionId ? "Continue the conversation…" : `Ask about ${displayName}…`}
        queued={!!queued}
        images={images}
        onAddImage={(img) => setImages((prev) => [...prev, img])}
        onRemoveImage={(id) => setImages((prev) => prev.filter((i) => i.id !== id))}
      />
    </div>
  );
}
