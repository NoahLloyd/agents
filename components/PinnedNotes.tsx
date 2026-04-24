"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

const STORAGE_KEY = "agents.pinnedNotes.v1";
const DEFAULT_PIN = "/Users/noah/AI-safety/Noah's notes.md";
const AUTOSAVE_DELAY_MS = 1200;
const FIRST_LOAD_KEY = "agents.pinnedNotes.firstLoadDone";

type Pin = { path: string; label: string };

function loadPins(): Pin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      // Very first load ever: seed with Noah's notes. After this we trust
      // whatever the user has — including an empty list.
      if (!localStorage.getItem(FIRST_LOAD_KEY)) {
        localStorage.setItem(FIRST_LOAD_KEY, "1");
        return [{ path: DEFAULT_PIN, label: "Noah's notes" }];
      }
      return [];
    }
    const parsed = JSON.parse(raw) as Pin[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePins(pins: Pin[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

function basenameLabel(p: string): string {
  const parts = p.split("/");
  const last = parts[parts.length - 1] || p;
  return last.replace(/\.[^.]+$/, "");
}

export default function PinnedNotes() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setPins(loadPins());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) savePins(pins);
  }, [pins, hydrated]);

  const addByPath = (p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    const existing = pins.findIndex((x) => x.path === trimmed);
    if (existing !== -1) {
      setActiveIdx(existing);
      return;
    }
    const next = [...pins, { path: trimmed, label: basenameLabel(trimmed) }];
    setPins(next);
    setActiveIdx(next.length - 1);
  };

  const removePin = (idx: number) => {
    const next = pins.filter((_, i) => i !== idx);
    setPins(next);
    if (next.length === 0) {
      setActiveIdx(0);
    } else if (activeIdx >= next.length) {
      setActiveIdx(next.length - 1);
    } else if (activeIdx > idx) {
      setActiveIdx(activeIdx - 1);
    }
  };

  const renamePin = (idx: number) => {
    const cur = pins[idx];
    const label = window.prompt("tab label", cur.label);
    if (!label) return;
    setPins(pins.map((p, i) => (i === idx ? { ...p, label } : p)));
  };

  const active = pins[activeIdx];
  const addBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
        {pins.map((p, i) => (
          <button
            key={p.path}
            onClick={() => setActiveIdx(i)}
            onDoubleClick={() => renamePin(i)}
            title={`${p.path} — double-click to rename`}
            className={`group relative shrink-0 px-3 py-1.5 text-xs ${
              i === activeIdx
                ? "border-b-2 border-emerald-500 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {p.label}
            <span
              onClick={(e) => {
                e.stopPropagation();
                removePin(i);
              }}
              className="ml-1.5 text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
              title="unpin"
            >
              ✕
            </span>
          </button>
        ))}
        <button
          ref={addBtnRef}
          onClick={() => setSearchOpen((o) => !o)}
          className="ml-auto shrink-0 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-200"
          title="pin another note"
        >
          + pin
        </button>
        {searchOpen && (
          <PinSearch
            anchorRef={addBtnRef}
            onPick={(absPath) => {
              addByPath(absPath);
              setSearchOpen(false);
            }}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </div>
      {active ? (
        <NoteEditor key={active.path} pin={active} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
          no pinned notes — click <span className="mx-1 text-zinc-400">+ pin</span> to add one
        </div>
      )}
    </div>
  );
}

function PinSearch({
  anchorRef,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (absPath: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ absPath: string; relPath: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Anchor the dropdown to the + pin button. Portaled into document.body so
  // ancestors with overflow-hidden don't clip it.
  useLayoutEffect(() => {
    const recompute = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        });
      }
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !anchorRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose, anchorRef]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/vault-files?q=${encodeURIComponent(query)}`,
        );
        const j = (await r.json()) as { files: typeof results };
        if (!cancelled) {
          setResults(j.files);
          setActiveIdx(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) onPick(r.absPath);
      else if (query.trim().startsWith("/")) onPick(query.trim());
    }
  };

  if (pos === null) return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{ position: "fixed", top: pos.top, right: pos.right }}
      className="z-50 w-96 max-w-[90vw] overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder="search vault notes (or paste absolute path)"
        className="w-full border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
      />
      <div className="max-h-72 overflow-auto">
        {loading && results.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-600">searching…</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-600">
            {query.trim().startsWith("/")
              ? "press Enter to pin this absolute path"
              : "no matches"}
          </div>
        )}
        {results.map((r, i) => (
          <button
            key={r.absPath}
            onMouseEnter={() => setActiveIdx(i)}
            onClick={() => onPick(r.absPath)}
            className={`flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left text-xs ${
              i === activeIdx ? "bg-zinc-800" : "hover:bg-zinc-800/50"
            }`}
          >
            <span className="text-zinc-200">{r.name.replace(/\.[^.]+$/, "")}</span>
            <span className="truncate text-[10px] text-zinc-500 font-mono w-full">
              {r.relPath}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function NoteEditor({ pin }: { pin: Pin }) {
  const [content, setContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoadErr(null);
    void api
      .readFile(pin.path)
      .then((r) => {
        setContent(r.content);
        setSavedContent(r.content);
      })
      .catch((e) => setLoadErr((e as Error).message));
  }, [pin.path]);

  const dirty = content !== savedContent;

  const save = async (text: string) => {
    setSaving(true);
    try {
      await api.writeFile(pin.path, text);
      setSavedContent(text);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save(content);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, dirty]);

  useEffect(() => {
    const flush = () => {
      if (dirty) {
        navigator.sendBeacon(
          "/api/file",
          new Blob([JSON.stringify({ path: pin.path, content })], {
            type: "application/json",
          }),
        );
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("blur", flush);
    };
  }, [content, dirty, pin.path]);

  let statusLabel: string;
  let statusClass = "text-zinc-600";
  if (loadErr) {
    statusLabel = `error: ${loadErr}`;
    statusClass = "text-red-400";
  } else if (saving) {
    statusLabel = "saving…";
    statusClass = "text-zinc-400";
  } else if (dirty) {
    statusLabel = "unsaved (autosaving)";
    statusClass = "text-amber-400";
  } else if (savedAt) {
    statusLabel = `saved ${new Date(savedAt).toLocaleTimeString(undefined, { hour12: false })}`;
  } else {
    statusLabel = "loaded";
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1 text-[10px]">
        <span className="truncate text-zinc-600 font-mono">{pin.path}</span>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        disabled={!!loadErr}
        className="flex-1 resize-none bg-zinc-950 px-4 py-3 font-mono text-xs text-zinc-200 outline-none disabled:opacity-50"
        placeholder={loadErr ? "" : "Edit and the agent will pick it up next turn."}
      />
    </div>
  );
}
