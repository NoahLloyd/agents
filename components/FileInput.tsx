"use client";

import { useEffect, useRef, useState } from "react";

type Entry = { path: string; isDir: boolean };

export default function FileInput({
  value,
  onChange,
  onBlur,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchEntries = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/files?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { entries: Entry[] };
        setEntries(data.entries);
        setOpen(data.entries.length > 0);
        setActiveIdx(-1);
      } catch {}
    }, 120);
  };

  const pick = (entry: Entry) => {
    onChange(entry.path);
    if (entry.isDir) {
      // navigate into directory — keep dropdown open
      fetchEntries(entry.path + "/");
    } else {
      setEntries([]);
      setOpen(false);
      onBlur?.();
    }
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          fetchEntries(e.target.value);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, entries.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, -1));
          } else if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            pick(entries[activeIdx]);
          } else if (e.key === "Escape") {
            setOpen(false);
          } else if (e.key === "Tab" && entries.length > 0) {
            e.preventDefault();
            pick(entries[activeIdx >= 0 ? activeIdx : 0]);
          }
        }}
        onFocus={() => {
          if (entries.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // delay so mousedown on suggestion fires first
          setTimeout(() => {
            if (!containerRef.current?.querySelector(":focus-within")) onBlur?.();
          }, 150);
        }}
        className={className}
      />
      {open && entries.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {entries.map((entry, i) => (
            <li
              key={entry.path}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(entry);
              }}
              className={`flex cursor-pointer items-center gap-1.5 px-2 py-1.5 font-mono text-xs ${
                i === activeIdx
                  ? "bg-emerald-800/50 text-zinc-100"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <span className={entry.isDir ? "text-zinc-500" : "text-zinc-600"}>
                {entry.isDir ? "▸" : "·"}
              </span>
              <span className="truncate">{entry.path}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
