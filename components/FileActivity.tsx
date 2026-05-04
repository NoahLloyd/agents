"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { AutoCommitInfo, FileChange } from "@/lib/types";

type Commit = {
  hash: string;
  isoDate: string;
  subject: string;
  files: { status: string; path: string }[];
};

type FilesResp = {
  commits: Commit[];
  pending: { status: string; path: string }[];
  notARepo?: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  A: "text-emerald-400",
  M: "text-amber-400",
  D: "text-red-400",
  R: "text-blue-400",
  "??": "text-zinc-500",
};

export default function FileActivity({
  liveChanges,
  workingDir,
  lastCommit,
  onOpenFile,
  collapsed,
  onToggle,
}: {
  liveChanges: FileChange[];
  workingDir: string | null;
  lastCommit: AutoCommitInfo | null;
  onOpenFile: (args: {
    workingDir: string;
    hash: string;
    filePath: string | null;
  }) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [data, setData] = useState<FilesResp | null>(null);

  const refresh = async () => {
    if (!workingDir) {
      setData(null);
      return;
    }
    try {
      const r = await fetch(
        `/api/files?workingDir=${encodeURIComponent(workingDir)}`,
      );
      const j = (await r.json()) as FilesResp;
      setData(j);
    } catch {}
  };
  useEffect(() => {
    void refresh();
  }, [workingDir]);
  useEffect(() => {
    if (liveChanges.length > 0) void refresh();
  }, [liveChanges.length]);

  const showDiff = (hash: string, file?: string) => {
    if (!workingDir) return;
    onOpenFile({ workingDir, hash, filePath: file ?? null });
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          file activity
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {lastCommit && <CommitChip info={lastCommit} />}
          {workingDir && (
            <span
              className="truncate font-mono text-[10px] text-zinc-600"
              title={workingDir}
            >
              {workingDir.split("/").pop()}
            </span>
          )}
          <button
            onClick={onToggle}
            className="ml-1 shrink-0 text-[10px] text-zinc-600 hover:text-zinc-300"
            title={collapsed ? "expand" : "collapse"}
          >
            {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className="flex-1 overflow-auto px-3 py-2 text-xs">
        {!workingDir && (
          <div className="text-zinc-600 italic">select an agent</div>
        )}
        {data?.notARepo && (
          <div className="text-zinc-600 italic">not a git repo — only live events shown</div>
        )}
        {liveChanges.length > 0 && (
          <Section title="live (last minute)">
            {liveChanges
              .slice(-12)
              .reverse()
              .map((c, i) => (
                <Row
                  key={`live-${i}`}
                  status={c.kind === "add" ? "A" : c.kind === "unlink" ? "D" : "M"}
                  path={c.relPath}
                  onClick={
                    c.kind === "unlink"
                      ? undefined
                      : () => showDiff("WORKING", c.relPath)
                  }
                />
              ))}
          </Section>
        )}
        {data?.pending && data.pending.length > 0 && (
          <Section title="uncommitted">
            {data.pending.map((p, i) => (
              <Row
                key={`p-${i}`}
                status={p.status}
                path={p.path}
                onClick={() => showDiff("WORKING", p.path)}
              />
            ))}
          </Section>
        )}
        {data?.commits?.map((c) => (
          <Section
            key={c.hash}
            title={
              <span>
                <button
                  onClick={() => showDiff(c.hash)}
                  className="font-mono text-zinc-400 hover:text-zinc-200"
                >
                  {c.hash.slice(0, 7)}
                </button>{" "}
                <span className="text-zinc-500">{c.subject}</span>{" "}
                <span className="text-zinc-600">
                  {new Date(c.isoDate).toLocaleString(undefined, { hour12: false })}
                </span>
              </span>
            }
          >
            {c.files.map((f, i) => (
              <Row
                key={`${c.hash}-${i}`}
                status={f.status}
                path={f.path}
                onClick={() => showDiff(c.hash, f.path)}
              />
            ))}
          </Section>
        ))}
      </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 border-b border-zinc-900 pb-0.5 text-[10px] uppercase text-zinc-600">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  status,
  path,
  onClick,
}: {
  status: string;
  path: string;
  onClick?: () => void;
}) {
  const color = STATUS_COLOR[status] ?? "text-zinc-400";
  return (
    <div
      className={`flex items-center gap-2 px-1 py-0.5 ${onClick ? "cursor-pointer hover:bg-zinc-900" : ""}`}
      onClick={onClick}
    >
      <span className={`w-4 font-mono ${color}`}>{status}</span>
      <span className="truncate text-zinc-300">{path}</span>
    </div>
  );
}

function fmtAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CommitChip({ info }: { info: AutoCommitInfo }) {
  const ago = fmtAgo(info.ts);
  if (info.state === "committed") {
    const label = info.pushed ? "pushed" : "committed";
    const color = info.pushed ? "bg-emerald-500" : "bg-emerald-500/60";
    return (
      <span
        className="flex items-center gap-1 font-mono text-[10px] text-zinc-500"
        title={`auto-${label} ${ago}${info.hash ? ` (${info.hash})` : ""}${
          info.pushed ? "" : " — push failed or no upstream"
        }`}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />
        {info.hash ?? "commit"} · {ago}
      </span>
    );
  }
  if (info.state === "no-changes") {
    return (
      <span
        className="flex items-center gap-1 font-mono text-[10px] text-zinc-600"
        title={`auto-commit ran ${ago} — no changes`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600" />
        clean · {ago}
      </span>
    );
  }
  if (info.state === "error") {
    return (
      <span
        className="flex items-center gap-1 font-mono text-[10px] text-red-400"
        title={info.message ?? "auto-commit error"}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        commit error
      </span>
    );
  }
  return null;
}
