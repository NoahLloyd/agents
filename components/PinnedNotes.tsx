"use client";

import { ChevronDown, ChevronRight, X, FolderOpen, FileText, Bot, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Pin } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { Project, Agent } from "@/lib/types";

const STORAGE_KEY = "agents.pinnedNotes.v1";
const SELECTED_PROJECT_KEY = "agents.pinnedNotes.projectId.v1";
const FILE_LIST_OPEN_KEY = "agents.pinnedNotes.fileListOpen.v1";
const AUTOSAVE_DELAY_MS = 1200;
const POLL_INTERVAL_MS = 2500;

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

type ProjectFileEntry = { path: string; name: string; isDir: boolean; depth: number };

function loadPins(): Pin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => {
      const pin = p as Record<string, string>;
      return pin.kind === "url"
        ? { kind: "url" as const, url: pin.url, label: pin.label }
        : { kind: "file" as const, path: pin.path, label: pin.label };
    });
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

const PinnedNotes = forwardRef<
  PinnedNotesHandle,
  {
    collapsed?: boolean;
    onToggle?: () => void;
    projects?: Project[];
    agents?: { agent: Agent }[];
  }
>(function PinnedNotes({ collapsed, onToggle, projects = [], agents = [] }, ref) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  // Transient tab: opened from file list but not pinned
  const [tempPin, setTempPin] = useState<Pin | null>(null);
  const [activeIsTemp, setActiveIsTemp] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [fileListOpen, setFileListOpen] = useState(true);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  useImperativeHandle(ref, () => ({
    navigate: (delta: number) => {
      setPins((p) => {
        if (p.length === 0) return p;
        setActiveIdx((i) => (i + delta + p.length) % p.length);
        return p;
      });
    },
  }), []);

  useEffect(() => {
    setPins(loadPins());
    setHydrated(true);
    try {
      const pid = localStorage.getItem(SELECTED_PROJECT_KEY);
      if (pid) setSelectedProjectId(pid);
      const flo = localStorage.getItem(FILE_LIST_OPEN_KEY);
      if (flo !== null) setFileListOpen(flo === "1");
    } catch {}
  }, []);

  useEffect(() => {
    if (hydrated) savePins(pins);
  }, [pins, hydrated]);

  useEffect(() => {
    try { localStorage.setItem(SELECTED_PROJECT_KEY, selectedProjectId ?? ""); } catch {}
  }, [selectedProjectId]);

  useEffect(() => {
    try { localStorage.setItem(FILE_LIST_OPEN_KEY, fileListOpen ? "1" : "0"); } catch {}
  }, [fileListOpen]);

  // Auto-select first project if none selected
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Poll project files for real-time updates
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  useEffect(() => {
    if (!selectedProject) { setProjectFiles([]); return; }
    let cancelled = false;
    const load = () => {
      fetch(`/api/project-files?dir=${encodeURIComponent(selectedProject.workingDir)}`)
        .then((r) => r.json())
        .then((d: { entries: ProjectFileEntry[] }) => {
          if (!cancelled) setProjectFiles(d.entries ?? []);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedProject?.workingDir]);

  // Reset expanded dirs when project changes
  useEffect(() => { setExpandedDirs(new Set()); }, [selectedProject?.workingDir]);

  // File-driven agents for selected project
  const agentFiles = agents
    .filter((a) =>
      a.agent.direction.kind === "file" &&
      selectedProject &&
      a.agent.workingDir === selectedProject.workingDir,
    )
    .map((a) => ({
      agent: a.agent,
      filePath: (a.agent.direction as { kind: "file"; filePath: string }).filePath,
    }));

  // Pinned tab actions
  const addByPath = (p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    const existing = pins.findIndex((x) => x.kind === "file" && x.path === trimmed);
    if (existing !== -1) { setActiveIdx(existing); setActiveIsTemp(false); return; }
    const next: Pin[] = [...pins, { kind: "file", path: trimmed, label: basenameLabel(trimmed) }];
    setPins(next);
    setActiveIdx(next.length - 1);
    setActiveIsTemp(false);
  };

  const addByUrl = (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const existing = pins.findIndex((x) => x.kind === "url" && x.url === trimmed);
    if (existing !== -1) { setActiveIdx(existing); setActiveIsTemp(false); return; }
    let label = trimmed;
    try { const u = new URL(trimmed); label = u.hostname + (u.port ? `:${u.port}` : ""); } catch {}
    const next: Pin[] = [...pins, { kind: "url", url: trimmed, label }];
    setPins(next);
    setActiveIdx(next.length - 1);
    setActiveIsTemp(false);
  };

  // Open as transient tab (from file list) — does not persist
  const openByPath = (p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    const existing = pins.findIndex((x) => x.kind === "file" && x.path === trimmed);
    if (existing !== -1) { setActiveIdx(existing); setActiveIsTemp(false); return; }
    setTempPin({ kind: "file", path: trimmed, label: basenameLabel(trimmed) });
    setActiveIsTemp(true);
  };

  const removePin = (idx: number) => {
    const next = pins.filter((_, i) => i !== idx);
    setPins(next);
    if (next.length === 0) {
      setActiveIdx(0);
      if (!tempPin) setActiveIsTemp(false);
      else setActiveIsTemp(true);
    } else if (activeIdx >= next.length) {
      setActiveIdx(next.length - 1);
      setActiveIsTemp(false);
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

  const pinTempTab = () => {
    if (!tempPin) return;
    const next = [...pins, tempPin];
    setPins(next);
    setActiveIdx(next.length - 1);
    setActiveIsTemp(false);
    setTempPin(null);
  };

  const closeTempTab = () => {
    setTempPin(null);
    setActiveIsTemp(false);
  };

  // Folder expand/collapse
  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const dirEntries = useMemo(() => projectFiles.filter((e) => e.isDir), [projectFiles]);

  const isVisible = useCallback((entry: ProjectFileEntry): boolean => {
    return dirEntries
      .filter((d) => entry.path.startsWith(d.path + "/"))
      .every((d) => expandedDirs.has(d.path));
  }, [dirEntries, expandedDirs]);

  const active = activeIsTemp ? tempPin : (pins[activeIdx] ?? null);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-2">
        <button
          onClick={() => setFileListOpen((o) => !o)}
          className="inline-flex h-full shrink-0 items-center px-1.5 text-zinc-500 hover:text-zinc-200"
          title={fileListOpen ? "hide file list" : "show file list"}
        >
          {fileListOpen ? <PanelLeftClose size={14} strokeWidth={2} /> : <PanelLeftOpen size={14} strokeWidth={2} />}
        </button>

        {projects.length > 0 && (
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="h-6 min-w-0 flex-1 truncate rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-300 outline-none focus:border-emerald-600"
          >
            <option value="">— no project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

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
            title="pin a URL"
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

      {!collapsed && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: file list panel */}
          {fileListOpen && (
            <>
              <div className="flex w-44 shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {/* Agent direction files */}
                  {agentFiles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        <Bot size={10} strokeWidth={2} />
                        <span>Agent files</span>
                      </div>
                      {agentFiles.map(({ agent, filePath }) => {
                        const name = filePath.split("/").pop() ?? filePath;
                        const isActive = active?.kind === "file" && active.path === filePath;
                        return (
                          <button
                            key={agent.id}
                            onClick={() => openByPath(filePath)}
                            title={filePath}
                            className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] ${
                              isActive ? "bg-zinc-800 text-emerald-400" : "text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100"
                            }`}
                          >
                            <FileText size={10} strokeWidth={2} className="shrink-0 text-emerald-600" />
                            <span className="min-w-0 truncate">{name}</span>
                            <span className="ml-auto shrink-0 text-[9px] text-zinc-600 truncate max-w-[40px]">{agent.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Project files */}
                  {selectedProject && (
                    <div>
                      <div className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        <FolderOpen size={10} strokeWidth={2} />
                        <span>Files</span>
                      </div>
                      {projectFiles
                        .filter(isVisible)
                        .map((entry) => {
                          const indent = entry.depth * 10;
                          if (entry.isDir) {
                            const isExpanded = expandedDirs.has(entry.path);
                            return (
                              <button
                                key={entry.path}
                                onClick={() => toggleDir(entry.path)}
                                title={entry.path}
                                className="flex w-full items-center gap-1 py-0.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300"
                                style={{ paddingLeft: `${8 + indent}px` }}
                              >
                                {isExpanded
                                  ? <ChevronDown size={10} strokeWidth={2} className="shrink-0" />
                                  : <ChevronRight size={10} strokeWidth={2} className="shrink-0" />
                                }
                                <span className="min-w-0 truncate">{entry.name}</span>
                              </button>
                            );
                          }
                          const isActive = active?.kind === "file" && active.path === entry.path;
                          const pinnable = isPinnable(entry.path);
                          return (
                            <button
                              key={entry.path}
                              onClick={() => pinnable ? openByPath(entry.path) : undefined}
                              title={entry.path}
                              disabled={!pinnable}
                              className={`flex w-full items-center gap-1.5 py-0.5 text-left text-[11px] ${
                                isActive
                                  ? "bg-zinc-800 text-emerald-400"
                                  : pinnable
                                  ? "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
                                  : "cursor-default text-zinc-600"
                              }`}
                              style={{ paddingLeft: `${8 + indent + 12}px` }}
                            >
                              <span className="min-w-0 truncate">{entry.name}</span>
                            </button>
                          );
                        })}
                      {projectFiles.length === 0 && (
                        <div className="px-2 py-1 text-[10px] text-zinc-700">no files</div>
                      )}
                    </div>
                  )}

                  {!selectedProject && (
                    <div className="px-2 py-3 text-[10px] text-zinc-700">select a project above</div>
                  )}
                </div>
              </div>
              <div className="w-px shrink-0 bg-zinc-800" />
            </>
          )}

          {/* Right: tabs + viewer */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Tab row */}
            <div className="flex h-8 shrink-0 items-center overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-1">
              {pins.map((p, i) => (
                <PinTab
                  key={pinKey(p)}
                  pin={p}
                  isActive={!activeIsTemp && i === activeIdx}
                  isPinned
                  onClick={() => { setActiveIdx(i); setActiveIsTemp(false); }}
                  onUnpin={() => removePin(i)}
                  onRename={() => renamePin(i)}
                />
              ))}
              {tempPin && (
                <PinTab
                  key={`temp:${pinKey(tempPin)}`}
                  pin={tempPin}
                  isActive={activeIsTemp}
                  isPinned={false}
                  onClick={() => setActiveIsTemp(true)}
                  onPin={pinTempTab}
                  onClose={closeTempTab}
                />
              )}
              {pins.length === 0 && !tempPin && (
                <span className="px-2 text-[10px] text-zinc-700 italic">click a file to open it</span>
              )}
            </div>

            {/* Viewer */}
            {active ? (
              <NoteEditor key={pinKey(active)} pin={active} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-zinc-700">
                select a file from the list
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default PinnedNotes;

// ── Tab component with hover menu ─────────────────────────────────────────────

function PinTab({
  pin,
  isActive,
  isPinned,
  onClick,
  onUnpin,
  onRename,
  onPin,
  onClose,
}: {
  pin: Pin;
  isActive: boolean;
  isPinned: boolean;
  onClick: () => void;
  onUnpin?: () => void;
  onRename?: () => void;
  onPin?: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={pinTitle(pin)}
      className={`group relative inline-flex h-full shrink-0 cursor-pointer select-none items-center gap-1.5 px-2.5 text-xs ${
        isActive
          ? isPinned
            ? "border-b-2 border-emerald-500 text-zinc-100"
            : "border-b-2 border-zinc-400 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {pin.kind === "url" && <span className="text-zinc-600">↗</span>}
      <span className={isPinned ? "" : "italic"}>{pin.label}</span>
      {!isPinned && <span className="text-[9px] text-zinc-600 opacity-70">~</span>}
      <TabMenu
        isPinned={isPinned}
        onUnpin={onUnpin}
        onRename={onRename}
        onPin={onPin}
        onClose={onClose}
      />
    </div>
  );
}

function TabMenu({
  isPinned,
  onUnpin,
  onRename,
  onPin,
  onClose,
}: {
  isPinned: boolean;
  onUnpin?: () => void;
  onRename?: () => void;
  onPin?: () => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 150;
    setPos({ top: rect.bottom + 2, left: Math.min(rect.left, window.innerWidth - menuWidth - 8) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="tab options"
        className="ml-0.5 rounded p-0.5 text-zinc-600 opacity-0 transition hover:bg-zinc-700 hover:text-zinc-300 group-hover:opacity-100"
      >
        <MoreHorizontal size={11} strokeWidth={2} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-[150px] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 py-1 text-xs shadow-xl"
        >
          {isPinned ? (
            <>
              {onRename && (
                <button
                  onClick={() => { setOpen(false); onRename(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
                >
                  Rename
                </button>
              )}
              {onUnpin && (
                <button
                  onClick={() => { setOpen(false); onUnpin(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-red-400 hover:bg-red-950/40"
                >
                  Unpin
                </button>
              )}
            </>
          ) : (
            <>
              {onPin && (
                <button
                  onClick={() => { setOpen(false); onPin(); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-emerald-400 hover:bg-emerald-950/40"
                >
                  <Pin size={11} strokeWidth={2} />
                  Pin this
                </button>
              )}
              {onClose && (
                <button
                  onClick={() => { setOpen(false); onClose(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-zinc-300 hover:bg-zinc-800"
                >
                  Close
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── File search popover ───────────────────────────────────────────────────────

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

  useEffect(() => {
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((d: { workspace: string }) => { setQuery(d.workspace + "/"); })
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
  }, [query]);

  useLayoutEffect(() => {
    const recompute = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
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
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose, anchorRef]);

  const pick = (entry: FsEntry) => {
    if (entry.isDir) { setQuery(entry.path + "/"); inputRef.current?.focus(); }
    else onPick(entry.path);
  };

  const confirmQuery = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const act = entries[activeIdx];
    if (act && !act.isDir) { onPick(act.path); return; }
    if (act && act.isDir) { setQuery(act.path + "/"); return; }
    if (trimmed.startsWith("/") || trimmed.startsWith("~/")) onPick(trimmed);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(entries.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); confirmQuery(); }
    else if (e.key === "Tab" && entries.length > 0) { e.preventDefault(); const t = entries[activeIdx >= 0 ? activeIdx : 0]; if (t) pick(t); }
    else if (e.key === "Backspace" && query.endsWith("/") && query.length > 1) {
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
        {loading && entries.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">loading…</div>}
        {!loading && entries.length === 0 && isNewTextFile && (
          <div className="px-3 py-2 text-xs text-zinc-500">press <span className="font-mono text-emerald-400">Enter</span> to pin and create this file</div>
        )}
        {!loading && entries.length === 0 && canPin && !isNewTextFile && (
          <div className="px-3 py-2 text-xs text-zinc-500">press <span className="font-mono text-zinc-400">Enter</span> to pin this path</div>
        )}
        {!loading && entries.length === 0 && !looksLikePath && (
          <div className="px-3 py-2 text-xs text-zinc-600">type a path like <span className="font-mono text-zinc-400">~/</span> to browse</div>
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
              <span className="flex shrink-0 items-center text-zinc-600">
                {entry.isDir ? <ChevronRight size={11} strokeWidth={2} /> : <span className="w-[11px] text-center text-[11px]">·</span>}
              </span>
              <span className="min-w-0 truncate">{entry.isDir ? name + "/" : name}</span>
              {pinnable && <span className="ml-auto shrink-0 text-[10px] text-zinc-600">pin</span>}
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

  const submit = () => { const t = val.trim(); if (t) onPin(t); };
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
        <button onClick={submit} className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-600">
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
        <a href={pin.url} target="_blank" rel="noreferrer" className="shrink-0 text-zinc-500 hover:text-zinc-300" title="open in new tab">↗</a>
      </div>
      <iframe src={pin.url} className="flex-1 w-full border-0 bg-white" title={pin.label} />
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
      } catch {}
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
        <iframe key={rev} src={src} sandbox="allow-scripts allow-same-origin" className="flex-1 w-full border-0 bg-white" title={pin.label} />
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-auto p-4">
          <img src={src} alt={pin.label} className="max-w-full max-h-full object-contain" />
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

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockLowlight.configure({ lowlight }),
        Placeholder.configure({ placeholder: "Start writing…" }),
        Markdown.configure({ html: false, tightLists: true, transformPastedText: true }),
      ],
      content: "",
      editorProps: { attributes: { class: "tiptap-editor" } },
      onUpdate({ editor }) {
        if (!isMd) return;
        const md = (editor.storage as unknown as Record<string, { getMarkdown(): string }>).markdown.getMarkdown();
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { saveRef.current?.(md); }, AUTOSAVE_DELAY_MS);
      },
    },
    [],
  );

  useEffect(() => {
    setLoadErr(null);
    setIsNewFile(false);
    setRawContent(null);
    void api.readFile(pin.path)
      .then((r) => {
        const text = r.content;
        setRawContent(text);
        setSavedContent(text);
        if ((r as { new?: boolean }).new) setIsNewFile(true);
      })
      .catch((e) => setLoadErr((e as Error).message));
  }, [pin.path]);

  useEffect(() => {
    if (editor && rawContent !== null) editor.commands.setContent(rawContent);
  }, [editor, rawContent]);

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

  useEffect(() => {
    if (!isMd || !editor) return;
    const flush = () => {
      const md = (editor.storage as unknown as Record<string, { getMarkdown(): string }>).markdown.getMarkdown();
      if (md !== savedContent) {
        navigator.sendBeacon("/api/file", new Blob([JSON.stringify({ path: pin.path, content: md })], { type: "application/json" }));
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [isMd, editor, savedContent, pin.path]);

  useEffect(() => {
    if (isMd) return;
    const flush = () => {
      if (plainText !== savedContent) {
        navigator.sendBeacon("/api/file", new Blob([JSON.stringify({ path: pin.path, content: plainText })], { type: "application/json" }));
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
