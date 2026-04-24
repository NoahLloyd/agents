"use client";

import { useEffect, useState } from "react";
import type { FileChange } from "@/lib/types";

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
}: {
  liveChanges: FileChange[];
  workingDir: string | null;
}) {
  const [data, setData] = useState<FilesResp | null>(null);
  const [diff, setDiff] = useState<{ title: string; body: string } | null>(null);

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

  const showDiff = async (hash: string, file?: string) => {
    if (!workingDir) return;
    const url = `/api/diff?workingDir=${encodeURIComponent(workingDir)}&hash=${encodeURIComponent(hash)}${
      file ? `&file=${encodeURIComponent(file)}` : ""
    }`;
    const r = await fetch(url);
    const j = (await r.json()) as { diff: string };
    setDiff({
      title: file ? `${hash.slice(0, 7)} · ${file}` : hash.slice(0, 7),
      body: j.diff,
    });
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          file activity
        </span>
        {workingDir && (
          <span className="truncate text-[10px] text-zinc-600 font-mono" title={workingDir}>
            {workingDir.split("/").pop()}
          </span>
        )}
      </div>
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
      {diff && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDiff(null)}
        >
          <div
            className="flex max-h-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <span className="font-mono text-sm text-zinc-300">{diff.title}</span>
              <button
                onClick={() => setDiff(null)}
                className="text-zinc-500 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-xs">
              {diff.body.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "text-emerald-300"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "text-red-300"
                        : line.startsWith("@@")
                          ? "text-blue-300"
                          : "text-zinc-400"
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          </div>
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
