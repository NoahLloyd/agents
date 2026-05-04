"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toolDisplay } from "./ToolDisplay";

export { shortPath } from "./ToolDisplay";

export function UserBubble({ text, images }: { text: string; images?: PastedImage[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5">
        {images && images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={img.id}
                src={img.dataUrl}
                alt="pasted image"
                className="max-h-48 max-w-[280px] rounded-xl rounded-br-sm object-cover"
              />
            ))}
          </div>
        )}
        {text && (
          <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-zinc-800 px-3.5 py-2 text-[13px] leading-relaxed text-zinc-100">
            {text}
          </div>
        )}
      </div>
    </div>
  );
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-zinc-200">
      <ReactMarkdown
        components={{
          p: (props) => <p className="mb-2 last:mb-0" {...props} />,
          strong: (props) => <strong className="font-semibold text-white" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          h1: (props) => <h1 className="mt-3 mb-2 text-base font-semibold text-white" {...props} />,
          h2: (props) => <h2 className="mt-3 mb-1.5 text-[15px] font-semibold text-white" {...props} />,
          h3: (props) => <h3 className="mt-2 mb-1 text-sm font-semibold text-white" {...props} />,
          ul: (props) => <ul className="my-2 list-disc space-y-0.5 pl-5 marker:text-zinc-600" {...props} />,
          ol: (props) => <ol className="my-2 list-decimal space-y-0.5 pl-5 marker:text-zinc-600" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => <blockquote className="my-2 border-l-2 border-zinc-700 pl-3 text-zinc-400" {...props} />,
          a: (props) => <a className="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener noreferrer" {...props} />,
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[13px] text-zinc-200" {...props}>{children}</code>;
            }
            return <code className="block overflow-x-auto rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-[13px] text-zinc-200" {...props}>{children}</code>;
          },
          pre: ({ children, ...props }) => <pre className="my-2" {...props}>{children}</pre>,
          table: (props) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[13px]" {...props} /></div>,
          th: (props) => <th className="border border-zinc-700 bg-zinc-900 px-2 py-1 text-left font-semibold" {...props} />,
          td: (props) => <td className="border border-zinc-700 px-2 py-1" {...props} />,
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
    <div className="text-[13px] italic text-zinc-500" title={ts ? fmtClockFull(ts) : undefined}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-1.5 text-left hover:text-zinc-300"
      >
        <ChevronRight size={12} className={`shrink-0 text-zinc-600 transition-transform not-italic ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0 text-[11px] uppercase not-italic tracking-wider text-zinc-600">thinking</span>
        {!open && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </button>
      {open && (
        <div className="mt-1 ml-5 border-l border-zinc-800 pl-3">
          {ts !== undefined && <div className="mb-1 font-mono text-[11px] not-italic text-zinc-600">{fmtClockFull(ts)}</div>}
          <div className="whitespace-pre-wrap text-zinc-300">{text}</div>
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

export function ToolRow({ name, input, partialJson, result, running, ts }: ToolRowProps) {
  const [open, setOpen] = useState(false);
  const display = toolDisplay(name, input);
  const isError = result?.isError ?? false;
  const isRunning = running ?? result === null;

  const inputJson = useMemo(() => {
    if (input) return JSON.stringify(input, null, 2);
    return partialJson || "";
  }, [input, partialJson]);

  const iconColor = isError ? "text-red-400" : display.iconColor;
  const Icon = display.icon;

  return (
    <div className="text-[13px] text-zinc-300">
      <button
        onClick={() => setOpen((v) => !v)}
        title={display.displayName}
        className="group flex w-full items-center gap-1.5 text-left hover:text-zinc-300"
      >
        {Icon ? (
          <Icon size={12} strokeWidth={2} className={`shrink-0 ${iconColor} ${isRunning ? "animate-pulse" : ""}`} />
        ) : (
          <span className={`shrink-0 ${iconColor} ${isRunning ? "animate-pulse" : ""}`}>{display.displayName}</span>
        )}
        {display.summary && <span className="truncate opacity-90">{display.summary}</span>}
        {isError && <span className="ml-auto shrink-0 text-red-400">error</span>}
        {!isError && isRunning && <span className="ml-auto shrink-0 animate-pulse text-amber-400">running</span>}
      </button>
      {open && (
        <div className="mt-1 ml-4 space-y-1">
          {ts !== undefined && <div className="font-mono text-[11px] text-zinc-500">{fmtClockFull(ts)}</div>}
          {inputJson && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-300">
              {inputJson}
            </pre>
          )}
          {result && (
            <div>
              <div className="mb-0.5 text-[11px] uppercase tracking-wider text-zinc-500">result{isError ? " (error)" : ""}</div>
              <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border px-2 py-1.5 text-[13px] ${isError ? "border-red-900 text-red-300" : "border-zinc-800 text-zinc-300"}`}>
                {result.content}
              </pre>
            </div>
          )}
          {!result && isRunning && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-600"><LiveDots /> running…</div>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-zinc-400" />
    </span>
  );
}

// ── AskUserQuestion interactive form ─────────────────────────────────────────

type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
};

function AskUserQuestionForm({
  input,
  onSubmit,
}: {
  input: AskUserQuestionInput;
  onSubmit: (text: string) => void;
}) {
  const [selections, setSelections] = useState<Record<number, Set<number>>>({});

  const toggle = (qi: number, oi: number, multiSelect: boolean) => {
    setSelections((prev) => {
      const cur = prev[qi] ?? new Set<number>();
      const next = new Set(cur);
      if (multiSelect) {
        if (next.has(oi)) next.delete(oi); else next.add(oi);
      } else {
        next.clear();
        next.add(oi);
      }
      return { ...prev, [qi]: next };
    });
  };

  const handleSubmit = () => {
    const parts = input.questions.map((q, qi) => {
      const sel = selections[qi] ?? new Set<number>();
      const chosen = q.options.filter((_, oi) => sel.has(oi)).map((o) => o.label).join(", ");
      return `**${q.question}**\n→ ${chosen || "(no selection)"}`;
    });
    onSubmit(parts.join("\n\n"));
  };

  const allAnswered = input.questions.every((_, qi) => (selections[qi]?.size ?? 0) > 0);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-4 space-y-4">
      {input.questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <div className="text-sm font-semibold text-zinc-200">{q.question}</div>
          <div className="space-y-1.5">
            {q.options.map((opt, oi) => {
              const sel = selections[qi]?.has(oi) ?? false;
              return (
                <button
                  key={oi}
                  onClick={() => toggle(qi, oi, q.multiSelect ?? false)}
                  className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition ${
                    sel
                      ? "border-emerald-600 bg-emerald-950/40 text-zinc-100"
                      : "border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800"
                  }`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-${q.multiSelect ? "sm" : "full"} border-2 ${sel ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"}`}>
                    {sel && <span className="text-white text-[10px] leading-none">✓</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="ml-1.5 text-xs text-zinc-500">{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="rounded-md bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Submit answer
      </button>
    </div>
  );
}

// ── Shared chat UI components ─────────────────────────────────────────────────

import type { Entry, PastedImage, SavedConversation } from "@/lib/chat-shared";
import { tryParseJson } from "@/lib/chat-shared";

export function MessageView({
  entry,
  streaming,
  onAnswerQuestion,
}: {
  entry: Entry;
  streaming: boolean;
  onAnswerQuestion?: (text: string) => void;
}) {
  if (entry.role === "user") {
    return <UserBubble text={entry.text} images={entry.images} />;
  }
  return (
    <div className="space-y-2">
      {entry.blocks.map((b, i) => {
        if (b.type === "text") return <AssistantText key={i} text={b.text} />;
        if (b.type === "thinking") return <ThinkingRow key={i} text={b.text} />;

        // AskUserQuestion: render interactive form when unanswered and not streaming
        if (
          b.type === "tool_use" &&
          b.name === "AskUserQuestion" &&
          !streaming &&
          b.result === undefined &&
          onAnswerQuestion
        ) {
          const parsed =
            b.input !== undefined
              ? (b.input as AskUserQuestionInput)
              : (tryParseJson(b.partialJson) as AskUserQuestionInput | undefined);
          if (parsed?.questions?.length) {
            return <AskUserQuestionForm key={i} input={parsed} onSubmit={onAnswerQuestion} />;
          }
        }

        const parsedInput =
          b.input !== undefined
            ? (b.input as Record<string, unknown>)
            : (tryParseJson(b.partialJson) as Record<string, unknown> | undefined);
        return (
          <ToolRow
            key={i}
            name={b.name}
            input={parsedInput}
            partialJson={b.partialJson}
            result={b.result !== undefined ? { content: b.result, isError: b.isError === true } : null}
            running={b.result === undefined && streaming}
          />
        );
      })}
      {entry.error && <div className="text-xs text-rose-400">error: {entry.error}</div>}
    </div>
  );
}

export function HistoryPanel({
  title,
  conversations,
  onRestore,
  onDelete,
  onBack,
  onClose,
}: {
  title: string;
  conversations: SavedConversation[];
  onRestore: (conv: SavedConversation) => void;
  onDelete: (sessionId: string, e: React.MouseEvent) => void;
  onBack: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3">
        <span className="text-sm font-medium text-zinc-200">{title}</span>
        <div className="flex items-center gap-1">
          <button onClick={onBack} className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">← back</button>
          {onClose && (
            <button onClick={onClose} className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Close">✕</button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">no saved conversations yet</div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {conversations.map((conv) => (
              <button
                key={conv.sessionId}
                onClick={() => onRestore(conv)}
                className="group flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{conv.title}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">
                    {new Date(conv.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                    {" · "}
                    <span className="font-mono">{conv.sessionId.slice(0, 8)}</span>
                  </div>
                </div>
                <span
                  onClick={(e) => onDelete(conv.sessionId, e)}
                  className="mt-0.5 shrink-0 text-zinc-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  title="delete"
                >
                  <X size={12} strokeWidth={2.5} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatInput({
  inputRef,
  value,
  onChange,
  onSubmit,
  placeholder,
  queued,
  images,
  onAddImage,
  onRemoveImage,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  queued?: boolean;
  images: PastedImage[];
  onAddImage: (img: PastedImage) => void;
  onRemoveImage: (id: string) => void;
}) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [value]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((i) => i.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] ?? "";
        onAddImage({ id: Math.random().toString(36).slice(2), dataUrl, mimeType: item.type, base64 });
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-900">
      <div className="mx-auto max-w-2xl px-4 pt-3 pb-3">
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((img) => (
              <div key={img.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt="attachment" className="h-16 w-16 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveImage(img.id)}
                  className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-zinc-200 hover:bg-red-700"
                >
                  <X size={10} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
            }}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={3}
            style={{ height: "auto", overflowY: "hidden", resize: "none" }}
            className="min-h-[72px] flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {queued && (
            <span className="mb-0.5 shrink-0 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">queued</span>
          )}
        </div>
      </div>
    </div>
  );
}
