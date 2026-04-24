"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toolDisplay } from "./ToolDisplay";

export { shortPath } from "./ToolDisplay";

export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-800 px-3.5 py-2 text-[13px] leading-relaxed text-zinc-100">
        {children}
      </div>
    </div>
  );
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-zinc-200">
      <ReactMarkdown
        components={{
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          strong: (props) => (
            <strong className="font-semibold text-white" {...props} />
          ),
          em: (props) => <em className="italic" {...props} />,
          h1: (props) => (
            <h1
              className="mt-3 mb-2 text-[15px] font-semibold text-white"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="mt-3 mb-1.5 text-[14px] font-semibold text-white"
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="mt-2 mb-1 text-[13px] font-semibold text-white"
              {...props}
            />
          ),
          ul: (props) => (
            <ul
              className="my-2 list-disc space-y-0.5 pl-5 marker:text-zinc-600"
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              className="my-2 list-decimal space-y-0.5 pl-5 marker:text-zinc-600"
              {...props}
            />
          ),
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400"
              {...props}
            />
          ),
          a: (props) => (
            <a
              className="text-emerald-400 underline hover:text-emerald-300"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return (
                <code
                  className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px] text-zinc-200"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="block overflow-x-auto rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-[12px] text-zinc-200"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => (
            <pre className="my-2" {...props}>
              {children}
            </pre>
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" {...props} />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-zinc-700 bg-zinc-900 px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border border-zinc-700 px-2 py-1" {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function ThinkingRow({ text, ts }: { text: string; ts?: number }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const preview = text.split("\n")[0].slice(0, 200);
  return (
    <div
      className="text-[12px] italic text-zinc-500"
      title={ts ? fmtClockFull(ts) : undefined}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-1.5 text-left hover:text-zinc-300"
      >
        <span
          className={`inline-block w-3 shrink-0 text-center text-zinc-600 transition-transform not-italic ${
            open ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        <span className="shrink-0 text-[10px] uppercase not-italic tracking-wider text-zinc-600">
          thinking
        </span>
        {!open && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </button>
      {open && (
        <div className="mt-1 ml-5 border-l border-zinc-800 pl-3">
          {ts !== undefined && (
            <div className="mb-1 font-mono text-[10px] not-italic text-zinc-600">
              {fmtClockFull(ts)}
            </div>
          )}
          <div className="whitespace-pre-wrap text-zinc-400">{text}</div>
        </div>
      )}
    </div>
  );
}

function fmtClockFull(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

type ToolRowProps = {
  name: string;
  input?: Record<string, unknown>;
  partialJson?: string;
  result: { content: string; isError: boolean } | null;
  running?: boolean;
  ts?: number;
};

export function ToolRow({
  name,
  input,
  partialJson,
  result,
  running,
  ts,
}: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const display = toolDisplay(name, input);
  const isError = result?.isError ?? false;
  const isRunning = running ?? result === null;

  const inputJson = useMemo(() => {
    if (input) return JSON.stringify(input, null, 2);
    return partialJson || "";
  }, [input, partialJson]);

  // Error overrides the tool's semantic color; running just pulses the icon.
  const iconColor = isError ? "text-red-400" : display.iconColor;
  const Icon = display.icon;

  return (
    <div className="text-[11px] font-mono text-zinc-500">
      <button
        onClick={() => setOpen((v) => !v)}
        title={display.displayName}
        className="group flex w-full items-center gap-1.5 text-left hover:text-zinc-300"
      >
        {Icon ? (
          <Icon
            size={12}
            strokeWidth={2}
            className={`shrink-0 ${iconColor} ${
              isRunning ? "animate-pulse" : ""
            }`}
          />
        ) : (
          <span
            className={`shrink-0 ${iconColor} ${
              isRunning ? "animate-pulse" : ""
            }`}
          >
            {display.displayName}
          </span>
        )}
        {display.summary && (
          <span className="truncate opacity-70">{display.summary}</span>
        )}
        {isError && (
          <span className="ml-auto shrink-0 text-red-400">error</span>
        )}
        {!isError && isRunning && (
          <span className="ml-auto shrink-0 animate-pulse text-amber-400">
            running
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 ml-4 space-y-1">
          {ts !== undefined && (
            <div className="font-mono text-[10px] text-zinc-600">
              {fmtClockFull(ts)}
            </div>
          )}
          {inputJson && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-300">
              {inputJson}
            </pre>
          )}
          {result && (
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-zinc-600">
                result{isError ? " (error)" : ""}
              </div>
              <pre
                className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border px-2 py-1.5 text-[11px] ${
                  isError
                    ? "border-red-900 text-red-300"
                    : "border-zinc-800 text-zinc-400"
                }`}
              >
                {result.content}
              </pre>
            </div>
          )}
          {!result && isRunning && (
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
              <LiveDots /> running…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-500" />
    </span>
  );
}
