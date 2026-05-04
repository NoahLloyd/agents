"use client";

import { ChevronDown, ChevronRight, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";

const STORAGE_KEY = "agents.pinnedNotes.v1";
const AUTOSAVE_DELAY_MS = 1200;

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".mdx"]);
const HTML_EXTS  = new Set([".html", ".htm"]);
const IMAGE_EXTS = new Set([".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function ext(p: string): string {
  const dot = p.lastIndexOf(".");
  return dot === -1 ? "" : p.slice(dot).toLowerCase();
}

function isPinnable(p: string): boolean {
  const e = ext(p);
  return TEXT_EXTS.has(e) || HTML_EXTS.has(e) || IMAGE_EXTS.has(e);
}

type FilePin = { kind: "file"; path: string; label: string };
type UrlPin  = { kind: "url";  url: string;  label: string };
type Pin = FilePin | UrlPin;

function pinKey(p: Pin) { return p.kind === "url" ? `url:${p.url}` : `file:${p.path}`; }
function pinTitle(p: Pin) { return p.kind === "url" ? p.url : p.path; }

export type PinnedNotesHandle = { navigate: (delta: number) => void };

function loadPins(): Pin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) =>
      p.kind === "url"
        ? { kind: "url", url: p.url, label: p.label }
        : { kind: "file", path: p.path, label: p.label },
    );
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

const PinnedNotes = forwardRef<PinnedNotesHandle, { collapsed?: boolean; onToggle?: () => void }>(function PinnedNotes({ collapsed, onToggle }, ref) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useImperativeHandle(ref, () => ({
    navigate: (delta: number) => {
      setPins((p) => {
        if (p.length === 0) return p;
        setActiveIdx((i) => (i + delta + p.length) % p.length);
        return p;
      });
    },
  }), []);
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
    const existing = pins.findIndex((x) => x.kind === "file" && x.path === trimmed);
    if (existing !== -1) { setActiveIdx(existing); return; }
    const next: Pin[] = [...pins, { kind: "file", path: trimmed, label: basenameLabel(trimmed) }];
    setPins(next);
    setActiveIdx(next.length - 1);
  };

  const addByUrl = (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const existing = pins.findIndex((x) => x.kind === "url" && x.url === trimmed);
    if (existing !== -1) { setActiveIdx(existing); return; }
    let label = trimmed;
    try { const u = new URL(trimmed); label = u.hostname + (u.port ? `:${u.port}` : ""); } catch { /* keep raw */ }
    const next: Pin[] = [...pins, { kind: "url", url: trimmed, label }];
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
  const [urlInputOpen, setUrlInputOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2">
        {pins.map((p, i) => (
          <button
            key={pinKey(p)}
            onClick={() => setActiveIdx(i)}
            onDoubleClick={() => renamePin(i)}
            title={`${pinTitle(p)} — double-click to rename`}
            className={`group relative inline-flex h-full shrink-0 items-center px-3 text-xs ${
              i === activeIdx
                ? "border-b-2 border-emerald-500 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {p.kind === "url" && <span className="mr-1 text-zinc-600">↗</span>}
            {p.label}
            <span
              onClick={(e) => { e.stopPropagation(); removePin(i); }}
              className="ml-1.5 text-zinc-600 opacity-0 hover:text-red-400 group-hover:opacity-100"
              title="unpin"
            >
              <X size={13} strokeWidth={2} />
            </span>
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center">
          <button
            ref={addBtnRef}
            onClick={() => { setSearchOpen((o) => !o); setUrlInputOpen(false); }}
            className="inline-flex h-full shrink-0 items-center px-2 text-xs text-zinc-500 hover:text-zinc-200"
            title="pin a file"
          >
            + file
          </button>
          <button
            onClick={() => { setUrlInputOpen((o) => !o); setSearchOpen(false); }}
            className="inline-flex h-full shrink-0 items-center px-2 text-xs text-zinc-500 hover:text-zinc-200"
            title="pin a URL (e.g. http://localhost:3001)"
          >
            + url
          </button>
          <button
            onClick={onToggle}
            className="inline-flex h-full shrink-0 items-center px-2 text-xs text-zinc-500 hover:text-zinc-200"
            title={collapsed ? "expand notes" : "collapse notes"}
          >
            {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </button>
        </div>
        {searchOpen && (
          <PinSearch
            anchorRef={addBtnRef}
            onPick={(absPath) => { addByPath(absPath); setSearchOpen(false); }}
            onClose={() => setSearchOpen(false)}
          />
        )}
        {urlInputOpen && (
          <UrlInput
            onPin={(url) => { addByUrl(url); setUrlInputOpen(false); }}
            onClose={() => setUrlInputOpen(false)}
          />
        )}
      </div>
      {!collapsed && (active ? (
        <NoteEditor key={pinKey(active)} pin={active} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
          no pinned notes — click <span className="mx-1 text-zinc-400">+ file</span> or <span className="mx-1 text-zinc-400">+ url</span>
        </div>
      ))}
    </div>
  );
});

export default PinnedNotes;

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
      setQuery(entry.path + "/");
      inputRef.current?.focus();
    } else {
      onPick(entry.path);
    }
  };

  const confirmQuery = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const active = entries[activeIdx];
    if (active && !active.isDir) {
      onPick(active.path);
      return;
    }
    if (active && active.isDir) {
      setQuery(active.path + "/");
      return;
    }
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
      e.preventDefault();
      const parent = query.slice(0, -1).split("/").slice(0, -1).join("/") + "/";
      setQuery(parent || "~/");
    }
  };

  const trimmedQuery = query.trim();
  const looksLikePath = trimmedQuery.startsWith("/") || trimmedQuery.startsWith("~/");
  const isNewTextFile = looksLikePath && entries.length === 0 && !loading && TEXT_EXTS.has(ext(trimmedQuery));
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
        {!loading && entries.length === 0 && isNewTextFile && (
          <div className="px-3 py-2 text-xs text-zinc-500">
            press <span className="font-mono text-emerald-400">Enter</span> to pin and create this file
          </div>
        )}
        {!loading && entries.length === 0 && canPin && !isNewTextFile && (
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
          const pinnable = !entry.isDir && isPinnable(entry.path);
          return (
            <button
              key={entry.path}
              onMouseDown={(e) => { e.preventDefault(); pick(entry); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs ${
                i === activeIdx ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800/50"
              }`}
            >
              <span className="flex shrink-0 items-center text-zinc-600">{entry.isDir ? <ChevronRight size={11} strokeWidth={2} /> : <span className="w-[11px] text-center text-[11px]">·</span>}</span>
              <span className="min-w-0 truncate">
                {entry.isDir ? name + "/" : name}
              </span>
              {pinnable && (
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


// ── URL input popover ─────────────────────────────────────────────────────────

function UrlInput({ onPin, onClose }: { onPin: (url: string) => void; onClose: () => void }) {
  const [val, setVal] = useState("http://localhost:");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const submit = () => {
    const trimmed = val.trim();
    if (!trimmed) return;
    onPin(trimmed);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") onClose();
  };

  return createPortal(
    <div
      style={{ position: "fixed", top: "calc(36px + 4px)", right: 8 }}
      className="z-50 w-80 overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      <div className="border-b border-zinc-800 px-3 py-2 text-[10px] text-zinc-500">pin a URL</div>
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={ref}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          placeholder="http://localhost:3001"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        <button
          onClick={submit}
          className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600"
        >
          pin
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ── URL iframe viewer ─────────────────────────────────────────────────────────

function UrlViewer({ pin }: { pin: UrlPin }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1 text-[10px]">
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-600">{pin.url}</span>
        <a
          href={pin.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          title="open in new tab"
        >
          ↗
        </a>
      </div>
      <iframe
        src={pin.url}
        className="flex-1 w-full border-0 bg-white"
        title={pin.label}
      />
    </div>
  );
}

const IS_MD    = (p: string) => /\.(md|mdx|markdown)$/i.test(p);
const IS_HTML  = (p: string) => HTML_EXTS.has(ext(p));
const IS_IMAGE = (p: string) => IMAGE_EXTS.has(ext(p));

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
  if (pin.kind === "url") return <UrlViewer pin={pin} />;
  if (IS_HTML(pin.path) || IS_IMAGE(pin.path)) return <MediaViewer pin={pin} />;
  return <TextEditor pin={pin} />;
}

// ── Read-only viewer for HTML (iframe) and images ────────────────────────────

const POLL_MS = 3000;

function MediaViewer({ pin }: { pin: FilePin }) {
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  const [rev, setRev] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Initial load + polling for file changes
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch(`/api/file?path=${encodeURIComponent(pin.path)}`);
        if (!r.ok) { setErr("file not found"); return; }
        const j = (await r.json()) as { mtimeMs: number | null; error?: string };
        if (j.error) { setErr(j.error); return; }
        if (cancelled) return;
        setErr(null);
        setMtimeMs((prev) => {
          if (prev !== null && j.mtimeMs !== null && j.mtimeMs !== prev) {
            setRev((r) => r + 1);
            setUpdatedAt(Date.now());
          }
          return j.mtimeMs ?? prev;
        });
      } catch {
        // silently retry
      }
    };

    check();
    const id = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [pin.path]);

  const src = `/api/raw-file?path=${encodeURIComponent(pin.path)}&v=${rev}`;

  let statusLabel = "watching…";
  let statusClass = "text-zinc-600";
  if (err) { statusLabel = `error: ${err}`; statusClass = "text-red-400"; }
  else if (updatedAt) { statusLabel = `updated ${new Date(updatedAt).toLocaleTimeString(undefined, { hour12: false })}`; statusClass = "text-emerald-600"; }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-1 text-[10px]">
        <span className="min-w-0 flex-1 truncate font-mono text-zinc-600">{pin.path}</span>
        <span className={`shrink-0 ${statusClass}`}>{statusLabel}</span>
      </div>
      {err ? (
        <div className="flex flex-1 items-center justify-center px-4 text-xs text-red-400">{err}</div>
      ) : IS_HTML(pin.path) ? (
        <iframe
          key={rev}
          src={src}
          sandbox="allow-scripts allow-same-origin"
          className="flex-1 w-full border-0 bg-white"
          title={pin.label}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={src}
            alt={pin.label}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </div>
  );
}

// ── Text / markdown editor ────────────────────────────────────────────────────

function TextEditor({ pin }: { pin: FilePin }) {
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
