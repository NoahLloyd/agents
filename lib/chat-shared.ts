// Shared types, utilities, and SSE event helpers for MetaAgentChat and AgentChat.

export type TextBlock = { type: "text"; text: string };
export type ThinkingBlock = { type: "thinking"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  partialJson: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
};
export type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export type UsageInfo = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read?: number | null;
  cache_write?: number | null;
};

export type PastedImage = {
  id: string;
  dataUrl: string;
  mimeType: string;
  base64: string;
};

export type Entry =
  | { id: string; role: "user"; text: string; images?: PastedImage[] }
  | {
      id: string;
      role: "assistant";
      blocks: AssistantBlock[];
      blockOrder: string[];
      blocksByKey: Record<string, number>;
      usage?: UsageInfo;
      error?: string;
      costUsd?: number;
      durationMs?: number;
    };

export type SavedConversation = {
  sessionId: string;
  title: string;
  timestamp: number;
  entries: Entry[];
};

export type PatchFn = (
  entryId: string,
  fn: (e: Entry & { role: "assistant" }) => Entry,
) => void;

export const MAX_SAVED = 30;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function conversationTitle(entries: Entry[]): string {
  const first = entries.find((e) => e.role === "user");
  if (!first || first.role !== "user") return "Untitled";
  const text = first.text || (first.images?.length ? "[image]" : "");
  return text.slice(0, 60) + (text.length > 60 ? "…" : "");
}

export function upsertBlock(
  entry: Entry & { role: "assistant" },
  key: string,
  block: AssistantBlock,
): Entry {
  if (entry.blocksByKey[key] !== undefined) return entry;
  const blocks = [...entry.blocks, block];
  return {
    ...entry,
    blocks,
    blockOrder: [...entry.blockOrder, key],
    blocksByKey: { ...entry.blocksByKey, [key]: blocks.length - 1 },
  };
}

export function mutateBlock(
  entry: Entry & { role: "assistant" },
  key: string,
  fn: (b: AssistantBlock) => AssistantBlock,
): Entry {
  const idx = entry.blocksByKey[key];
  if (idx === undefined) return entry;
  const blocks = entry.blocks.slice();
  blocks[idx] = fn(blocks[idx]);
  return { ...entry, blocks };
}

export function mutateToolByUseId(
  entry: Entry & { role: "assistant" },
  tool_use_id: string,
  fn: (b: ToolUseBlock) => ToolUseBlock,
): Entry {
  const blocks = entry.blocks.map((b) =>
    b.type === "tool_use" && b.id === tool_use_id ? fn(b) : b,
  );
  return { ...entry, blocks };
}

export function handleEvent(
  ev: Record<string, unknown>,
  entryId: string,
  patch: PatchFn,
  setSessionId: (s: string) => void,
) {
  const type = ev.type as string;
  const key = ev.key as string | undefined;
  switch (type) {
    case "session":
      setSessionId(String(ev.sessionId));
      break;
    case "text_start":
      if (key) patch(entryId, (a) => upsertBlock(a, key, { type: "text", text: "" }));
      break;
    case "thinking_start":
      if (key) patch(entryId, (a) => upsertBlock(a, key, { type: "thinking", text: "" }));
      break;
    case "tool_start":
      if (key)
        patch(entryId, (a) =>
          upsertBlock(a, key, {
            type: "tool_use",
            id: String(ev.tool_use_id ?? ""),
            name: String(ev.name ?? ""),
            partialJson: "",
          }),
        );
      break;
    case "text_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "text" ? { ...b, text: b.text + String(ev.text ?? "") } : b,
          ),
        );
      break;
    case "thinking_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "thinking" ? { ...b, text: b.text + String(ev.text ?? "") } : b,
          ),
        );
      break;
    case "tool_input_delta":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "tool_use"
              ? { ...b, partialJson: b.partialJson + String(ev.partial_json ?? "") }
              : b,
          ),
        );
      break;
    case "block_stop":
      if (key)
        patch(entryId, (a) =>
          mutateBlock(a, key, (b) =>
            b.type === "tool_use" && b.input === undefined
              ? { ...b, input: tryParseJson(b.partialJson) }
              : b,
          ),
        );
      break;
    case "tool_result":
      patch(entryId, (a) =>
        mutateToolByUseId(a, String(ev.tool_use_id ?? ""), (b) => ({
          ...b,
          result: String(ev.content ?? ""),
          isError: Boolean(ev.is_error),
          input: b.input !== undefined ? b.input : tryParseJson(b.partialJson),
        })),
      );
      break;
    case "usage":
      patch(entryId, (a) => ({
        ...a,
        usage: {
          input_tokens: ev.input_tokens as number | undefined,
          output_tokens: ev.output_tokens as number | undefined,
          cache_read: ev.cache_read as number | null,
          cache_write: ev.cache_write as number | null,
        },
      }));
      break;
    case "result":
      patch(entryId, (a) => ({
        ...a,
        costUsd: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : a.costUsd,
        durationMs: typeof ev.duration_ms === "number" ? ev.duration_ms : a.durationMs,
      }));
      break;
    case "error":
      patch(entryId, (a) => ({ ...a, error: String(ev.message ?? "unknown error") }));
      break;
  }
}
