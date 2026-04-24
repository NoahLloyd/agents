"use client";

import { useEffect, useState, type ReactNode } from "react";

type Resp = {
  mode: "diff" | "content";
  body: string;
  note?: string;
};

export default function FileViewer({
  workingDir,
  hash,
  filePath,
}: {
  workingDir: string;
  hash: string;
  filePath: string | null;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    const url = `/api/diff?workingDir=${encodeURIComponent(workingDir)}&hash=${encodeURIComponent(hash)}${
      filePath ? `&file=${encodeURIComponent(filePath)}` : ""
    }`;
    fetch(url)
      .then(async (r) => {
        const j = (await r.json()) as Partial<Resp> & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setErr(j.error ?? `HTTP ${r.status}`);
          return;
        }
        setData({
          mode: j.mode === "content" ? "content" : "diff",
          body: j.body ?? "",
          note: j.note,
        });
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [workingDir, hash, filePath]);

  const title = filePath
    ? `${hash === "WORKING" ? "working" : hash.slice(0, 7)} · ${filePath}`
    : hash === "WORKING"
      ? "working tree"
      : hash.slice(0, 7);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
        <span className="truncate font-mono text-xs text-zinc-300" title={title}>
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {data?.note && (
            <span className="rounded border border-amber-900 bg-amber-900/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              {data.note}
            </span>
          )}
          {data && (
            <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {data.mode}
            </span>
          )}
          <span className="font-mono text-[10px] text-zinc-600">
            {workingDir.split("/").slice(-2).join("/")}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {err && (
          <div className="m-4 rounded border border-red-700 bg-red-900/30 px-2 py-1 text-xs text-red-300">
            {err}
          </div>
        )}
        {!err && data === null && (
          <div className="px-4 py-3 text-xs italic text-zinc-600">loading…</div>
        )}
        {data && data.mode === "diff" && <DiffBody body={data.body} />}
        {data && data.mode === "content" && <ContentBody body={data.body} />}
      </div>
    </div>
  );
}

const STRIPPED_HEADER_RE =
  /^(index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to )/;

function DiffBody({ body }: { body: string }) {
  if (!body.trim()) {
    return (
      <div className="px-4 py-3 text-xs italic text-zinc-600">(no changes)</div>
    );
  }
  const lines = body.split("\n");
  const rows: ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    // File heading — replace with a simple sticky-ish label, useful when
    // multiple files are diffed (e.g. full commit view).
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      const aPath = header[1];
      const bPath = header[2];
      const label = aPath === bPath ? aPath : `${aPath} → ${bPath}`;
      rows.push(
        <div
          key={key++}
          className="mt-5 border-t border-zinc-800 bg-zinc-950 px-4 pt-3 pb-1 font-mono text-[11px] font-semibold text-zinc-200 first:mt-0 first:border-t-0 first:pt-2"
        >
          {label}
        </div>,
      );
      continue;
    }

    if (STRIPPED_HEADER_RE.test(line)) continue;

    if (line.startsWith("@@")) {
      const m = line.match(/^@@ (-\S+ \+\S+) @@(.*)$/);
      const range = m ? m[1] : line;
      const context = m ? m[2].trim() : "";
      rows.push(
        <div
          key={key++}
          className="mt-2 flex items-baseline gap-3 px-4 text-[10px] text-zinc-500"
        >
          <span className="font-mono">{range}</span>
          {context && <span className="italic text-zinc-600">{context}</span>}
        </div>,
      );
      continue;
    }

    if (line.length === 0) {
      rows.push(<div key={key++} className="h-3" />);
      continue;
    }

    const prefix = line[0];
    const content = line.slice(1);
    if (prefix === "+") {
      rows.push(
        <div
          key={key++}
          className="whitespace-pre-wrap break-words border-l-2 border-emerald-500/60 bg-emerald-500/10 px-4 py-0.5 text-emerald-200"
        >
          {content || " "}
        </div>,
      );
    } else if (prefix === "-") {
      rows.push(
        <div
          key={key++}
          className="whitespace-pre-wrap break-words border-l-2 border-red-500/60 bg-red-500/10 px-4 py-0.5 text-red-200"
        >
          {content || " "}
        </div>,
      );
    } else if (prefix === " ") {
      rows.push(
        <div
          key={key++}
          className="whitespace-pre-wrap break-words px-4 py-0.5 text-zinc-400"
        >
          {content || " "}
        </div>,
      );
    } else if (prefix === "\\") {
      // "\ No newline at end of file" — dim, italic
      rows.push(
        <div
          key={key++}
          className="px-4 py-0.5 text-[10px] italic text-zinc-600"
        >
          {line}
        </div>,
      );
    } else {
      rows.push(
        <div
          key={key++}
          className="whitespace-pre-wrap break-words px-4 py-0.5 text-zinc-500"
        >
          {line}
        </div>,
      );
    }
  }

  return <div className="font-mono text-xs leading-relaxed">{rows}</div>;
}

function ContentBody({ body }: { body: string }) {
  if (!body) {
    return (
      <div className="px-4 py-3 text-xs italic text-zinc-600">(empty file)</div>
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed text-zinc-300">
      {body}
    </pre>
  );
}
