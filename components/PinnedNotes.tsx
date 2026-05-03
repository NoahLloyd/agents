"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

const STORAGE_KEY = "agents.pinnedNotes.v1";
const AUTOSAVE_DELAY_MS = 1200;

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".mdx"]);

function hasTextExt(p: string): boolean {
  const dot = p.lastIndexOf(".");
  if (dot === -1) return false;
  return TEXT_EXTS.has(p.slice(dot).toLowerCase());
}

type Pin = { path: string; label: string };

function loadPins(): Pin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
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
      <div className="relative flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
        {pins.map((p, i) => (
          <button
            key={p.path}
            onClick={() => setActiveIdx(i)}
            onDoubleClick={() => renamePin(i)}
            title={`${p.path} — double-click to rename`}
            className={`group relative inline-flex h-full shrink-0 items-center px-3 text-xs ${
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
          className="ml-auto inline-flex h-full shrink-0 items-center px-2 text-xs text-zinc-500 hover:text-zinc-200"
          title="pin a file"
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
          no pinned files — click <span className="mx-1 text-zinc-400">+ pin</span> to add one
        </div>
      )}
    </div>
  );
}

type FsEntry = { path: string; isDir: boolean };

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
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the server-configured workspace root and start there.
  useEffect(() => {
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d: { workspace: string }) => {
        setQuery(d.workspace + "/");
      })
      .catch(() => setQuery("~/"));
  }, []);

  const fetchEntries = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/files?q=${encodeURIComponent(q)}`);
        const j = (await r.json()) as { entries: FsEntry[] };
        setEntries(j.entries ?? []);
        setActiveIdx(0);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }, 80);
  };

  // Fetch on mount (list home dir) and whenever query changes
  useEffect(() => {
    if (query) fetchEntries(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Position dropdown anchored to the "+ pin" button
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

  // Close on outside click
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

  const pick = (entry: FsEntry) => {
    if (entry.isDir) {
      // Navigate into directory
      setQuery(entry.path + "/");
      inputRef.current?.focus();
    } else {
      onPick(entry.path);
    }
  };

  const confirmQuery = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // If it's a file entry in the list, pin it
    const active = entries[activeIdx];
    if (active && !active.isDir) {
      onPick(active.path);
      return;
    }
    // If it's a dir entry, navigate in
    if (active && active.isDir) {
      setQuery(active.path + "/");
      return;
    }
    // Otherwise pin the typed path directly (creates file if needed)
    if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed === "~") {
      onPick(trimmed);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(entries.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmQuery();
    } else if (e.key === "Tab" && entries.length > 0) {
      e.preventDefault();
      const target = entries[activeIdx >= 0 ? activeIdx : 0];
      if (target) pick(target);
    } else if (e.key === "Backspace" && query.endsWith("/") && query.length > 1) {
      // Navigate up one level
      e.preventDefault();
      const parent = query.slice(0, -1).split("/").slice(0, -1).join("/") + "/";
      setQuery(parent || "~/");
    }
  };

  const trimmedQuery = query.trim();
  const looksLikePath = trimmedQuery.startsWith("/") || trimmedQuery.startsWith("~/");
  const isNewFile = looksLikePath && entries.length === 0 && !loading && hasTextExt(trimmedQuery);
  const canPin = looksLikePath && entries.length === 0 && !loading && trimmedQuery.length > 1;

  if (pos === null) return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{ position: "fixed", top: pos.top, right: pos.right }}
      className="z-50 w-96 max-w-[90vw] overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder="type a path, e.g. ~/notes/todo.md"
        className="w-full border-b border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600 placeholder:font-sans"
      />
      <div className="max-h-72 overflow-auto">
        {loading && entries.length === 0 && (
          <div className="px-3 py-2 text-xs text-zinc-600">loading…</div>
        )}
        {!loading && entries.length === 0 && isNewFile && (
          <div className="px-3 py-2 text-xs text-zinc-500">
            press <span className="font-mono text-emerald-400">Enter</span> to pin and create this file
          </div>
        )}
        {!loading && entries.length === 0 && canPin && !isNewFile && (
          <div className="px-3 py-2 text-xs text-zinc-500">
            press <span className="font-mono text-zinc-400">Enter</span> to pin this path
          </div>
        )}
        {!loading && entries.length === 0 && !looksLikePath && (
          <div className="px-3 py-2 text-xs text-zinc-600">
            type a path like <span className="font-mono text-zinc-400">~/</span> to browse
          </div>
        )}
        {entries.map((entry, i) => {
          const name = entry.path.split("/").pop() ?? entry.path;
          return (
            <button
              key={entry.path}
              onMouseDown={(e) => { e.preventDefault(); pick(entry); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs ${
                i === activeIdx ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/50"
              }`}
            >
              <span className="shrink-0 text-zinc-600">{entry.isDir ? "▸" : "·"}</span>
              <span className="min-w-0 truncate">
                {entry.isDir ? name + "/" : name}
              </span>
              {!entry.isDir && hasTextExt(entry.path) && (
                <span className="ml-auto shrink-0 text-[10px] text-zinc-600">pin</span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}


const IS_MD = (p: string) => /\.(md|mdx|markdown)$/i.test(p);

// ── WYSIWYG markdown editor (TipTap) ─────────────────────────────────────────

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { createLowlight, common } from "lowlight";

const lowlight = createLowlight(common);

function NoteEditor({ pin }: { pin: Pin }) {
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [isNewFile, setIsNewFile] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<((text: string) => Promise<void>) | null>(null);

  const isMd = IS_MD(pin.path);

  const save = useCallback(async (text: string) => {
    setSaving(true);
    try {
      await api.writeFile(pin.path, text);
      setSavedContent(text);
      setSavedAt(Date.now());
      setIsNewFile(false);
    } finally {
      setSaving(false);
    }
  }, [pin.path]);

  useEffect(() => { saveRef.current = save; }, [save]);

  // TipTap editor — only used for markdown files
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockLowlight.configure({ lowlight }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        Markdown.configure({
          html: false,
          tightLists: true,
          transformPastedText: true,
        }),
      ],
      content: "",
      editorProps: {
        attributes: { class: "tiptap-editor" },
      },
      onUpdate({ editor }) {
        if (!isMd) return;
        const md = (editor.storage as unknown as Record<string, { getMarkdown(): string }>).markdown.getMarkdown();
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          saveRef.current?.(md);
        }, AUTOSAVE_DELAY_MS);
      },
    },
    [],
  );

  // Load file content
  useEffect(() => {
    setLoadErr(null);
    setIsNewFile(false);
    setRawContent(null);
    void api
      .readFile(pin.path)
      .then((r) => {
        const text = r.content;
        setRawContent(text);
        setSavedContent(text);
        if ((r as { new?: boolean }).new) setIsNewFile(true);
      })
      .catch((e) => setLoadErr((e as Error).message));
  }, [pin.path]);

  // Push loaded content into TipTap once editor + content are both ready
  useEffect(() => {
    if (editor && rawContent !== null) {
      editor.commands.setContent(rawContent);
    }
  }, [editor, rawContent]);

  // Plain text autosave (for non-md files)
  const [plainText, setPlainText] = useState("");
  useEffect(() => {
    if (!isMd && rawContent !== null) setPlainText(rawContent);
  }, [isMd, rawContent]);

  useEffect(() => {
    if (isMd) return;
    const dirty = plainText !== savedContent;
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { saveRef.current?.(plainText); }, AUTOSAVE_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [plainText, savedContent, isMd]);

  // Flush on tab close / blur (TipTap path)
  useEffect(() => {
    if (!isMd || !editor) return;
    const flush = () => {
      const md = (editor.storage as unknown as Record<string, { getMarkdown(): string }>).markdown.getMarkdown();
      if (md !== savedContent) {
        navigator.sendBeacon("/api/file",
          new Blob([JSON.stringify({ path: pin.path, content: md })], { type: "application/json" }));
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [isMd, editor, savedContent, pin.path]);

  // Flush on tab close (plain text path)
  useEffect(() => {
    if (isMd) return;
    const flush = () => {
      if (plainText !== savedContent) {
        navigator.sendBeacon("/api/file",
          new Blob([JSON.stringify({ path: pin.path, content: plainText })], { type: "application/json" }));
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [isMd, plainText, savedContent, pin.path]);

  let statusLabel: string;
  let statusClass = "text-zinc-600";
  if (loadErr) { statusLabel = `error: ${loadErr}`; statusClass = "text-red-400"; }
  else if (saving) { statusLabel = "saving…"; statusClass = "text-zinc-400"; }
  else if (isNewFile && savedAt === null) { statusLabel = "new file"; statusClass = "text-emerald-600"; }
  else if (savedAt) { statusLabel = `saved ${new Date(savedAt).toLocaleTimeString(undefined, { hour12: false })}`; }
  else { statusLabel = rawContent === null ? "loading…" : "loaded"; }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1 text-[10px]">
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-600">{pin.path}</span>
        <span className={`shrink-0 ${statusClass}`}>{statusLabel}</span>
      </div>

      {loadErr ? (
        <div className="flex flex-1 items-center justify-center px-4 text-xs text-red-400">{loadErr}</div>
      ) : isMd ? (
        <div className="tiptap-editor flex-1 overflow-auto">
          <EditorContent editor={editor} className="h-full" />
        </div>
      ) : (
        <textarea
          value={plainText}
          onChange={(e) => setPlainText(e.target.value)}
          spellCheck={false}
          className="flex-1 resize-none bg-zinc-950 px-4 py-3 font-mono text-xs text-zinc-200 outline-none"
          placeholder={isNewFile ? "New file. Start typing…" : "Edit and the agent will pick it up next turn."}
        />
      )}
    </div>
  );
}
