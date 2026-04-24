import type { TranscriptEvent } from "./types";

type RawEvent = Record<string, unknown>;

export function parseLine(line: string): TranscriptEvent[] {
  if (!line.trim()) return [];
  let raw: RawEvent;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  const ts = Date.now();
  const t = raw.type as string | undefined;

  if (t === "system") {
    return [{ kind: "system", subtype: (raw.subtype as string) ?? "?", ts }];
  }

  if (t === "result") {
    return [
      {
        kind: "result",
        subtype: (raw.subtype as string) ?? "?",
        durationMs: (raw.duration_ms as number) ?? 0,
        ts,
      },
    ];
  }

  if (t === "assistant") {
    const msg = raw.message as { content?: unknown } | undefined;
    const content = msg?.content;
    if (!Array.isArray(content)) return [];
    const out: TranscriptEvent[] = [];
    for (const c of content as RawEvent[]) {
      if (c.type === "text" && typeof c.text === "string") {
        out.push({ kind: "text", text: c.text, ts });
      } else if (c.type === "thinking" && typeof c.thinking === "string") {
        out.push({ kind: "thinking", text: c.thinking, ts });
      } else if (c.type === "tool_use") {
        out.push({
          kind: "tool_use",
          name: (c.name as string) ?? "?",
          input: (c.input as Record<string, unknown>) ?? {},
          id: (c.id as string) ?? "",
          ts,
        });
      }
    }
    return out;
  }

  if (t === "user") {
    const msg = raw.message as { content?: unknown } | undefined;
    const content = msg?.content;
    if (!Array.isArray(content)) return [];
    const out: TranscriptEvent[] = [];
    for (const c of content as RawEvent[]) {
      if (c.type === "tool_result") {
        let txt = "";
        const cc = c.content;
        if (typeof cc === "string") txt = cc;
        else if (Array.isArray(cc))
          txt = cc
            .map((p) =>
              typeof p === "object" && p && "text" in p
                ? String((p as RawEvent).text)
                : JSON.stringify(p),
            )
            .join("\n");
        out.push({
          kind: "tool_result",
          toolUseId: (c.tool_use_id as string) ?? "",
          content: txt,
          isError: Boolean(c.is_error),
          ts,
        });
      }
    }
    return out;
  }

  return [];
}
