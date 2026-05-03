import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isPathAllowed } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

type ChatRequest = {
  workingDir: string;
  message: string;
  sessionId?: string | null;
};

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const message = (body.message ?? "").trim();
  const workingDir = (body.workingDir ?? "").trim();

  if (!message) return new Response("message required", { status: 400 });
  if (!workingDir) return new Response("workingDir required", { status: 400 });
  if (!isPathAllowed(workingDir)) return new Response("path not allowed", { status: 403 });

  const existingSession =
    body.sessionId && isValidUuid(body.sessionId) ? body.sessionId : null;
  const sessionId = existingSession ?? randomUUID();

  const systemPrompt = `You are a helpful assistant with full access to the project at ${workingDir}. The user wants to understand or discuss the code and work happening there — possibly while a separate agent is actively working in the same directory. Be conversational, concise, and specific. Read files freely to ground your answers. Do not be verbose.`;

  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.ANTHROPIC_API_KEY;
  delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  const args = [
    "--dangerously-skip-permissions",
    "--add-dir", workingDir,
    "--append-system-prompt", systemPrompt,
    "--output-format", "stream-json",
    "--input-format", "text",
    "--include-partial-messages",
    "--verbose",
    "--model", "claude-sonnet-4-6",
    "--fallback-model", "claude-haiku-4-5",
    "--effort", "medium",
    "-p", message,
  ];
  if (existingSession) args.push("--resume", sessionId);
  else args.push("--session-id", sessionId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sse(obj))); } catch { closed = true; }
      };

      send({ type: "session", sessionId });

      const child = spawn(CLAUDE_BIN, args, {
        cwd: workingDir,
        env: cleanEnv as unknown as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      req.signal.addEventListener("abort", () => { try { child.kill("SIGTERM"); } catch {} });

      let stdoutBuf = "";
      let stderrBuf = "";
      let turn = 0;

      const handleJsonLine = (line: string) => {
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(line); } catch { return; }
        const type = obj.type as string;

        if (type === "stream_event") {
          const ev = obj.event as { type: string } & Record<string, unknown>;
          if (!ev) return;
          if (ev.type === "message_start") { turn++; return; }
          if (ev.type === "content_block_start") {
            const idx = ev.index as number;
            const key = `${turn}-${idx}`;
            const block = ev.content_block as { type: string; id?: string; name?: string };
            if (block.type === "text") send({ type: "text_start", key });
            else if (block.type === "thinking") send({ type: "thinking_start", key });
            else if (block.type === "tool_use") send({ type: "tool_start", key, tool_use_id: block.id, name: block.name });
            return;
          }
          if (ev.type === "content_block_delta") {
            const idx = ev.index as number;
            const key = `${turn}-${idx}`;
            const delta = ev.delta as { type: string } & Record<string, unknown>;
            if (delta.type === "text_delta") send({ type: "text_delta", key, text: delta.text });
            else if (delta.type === "thinking_delta") send({ type: "thinking_delta", key, text: delta.thinking });
            else if (delta.type === "input_json_delta") send({ type: "tool_input_delta", key, partial_json: delta.partial_json });
            return;
          }
          if (ev.type === "content_block_stop") {
            send({ type: "block_stop", key: `${turn}-${ev.index as number}` });
            return;
          }
          if (ev.type === "message_delta") {
            const usage = ev.usage as Record<string, number> | undefined;
            if (usage) send({ type: "usage", input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read: usage.cache_read_input_tokens ?? null, cache_write: usage.cache_creation_input_tokens ?? null });
            return;
          }
          return;
        }

        if (type === "user") {
          const msg = obj.message as { content?: Array<{ type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }> } | undefined;
          for (const b of msg?.content ?? []) {
            if (b.type !== "tool_result") continue;
            let text = "";
            if (typeof b.content === "string") text = b.content;
            else if (Array.isArray(b.content)) text = b.content.map((x) => (x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : JSON.stringify(x))).join("\n");
            send({ type: "tool_result", tool_use_id: b.tool_use_id, content: text, is_error: Boolean(b.is_error) });
          }
          return;
        }

        if (type === "result") {
          send({ type: "result", subtype: obj.subtype, duration_ms: obj.duration_ms, is_error: obj.is_error });
          return;
        }
      };

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdoutBuf += chunk;
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
          const line = stdoutBuf.slice(0, nl).trim();
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (line) handleJsonLine(line);
        }
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => { stderrBuf += chunk; });

      child.on("error", (e) => { send({ type: "error", message: `spawn error: ${e.message}` }); });
      child.on("close", (code, signal) => {
        if (stdoutBuf.trim()) handleJsonLine(stdoutBuf.trim());
        if (code !== 0) {
          const tail = stderrBuf.slice(-800);
          send({ type: "error", message: `claude exited with code=${code} signal=${signal ?? ""}${tail ? `\n${tail}` : ""}` });
        }
        send({ type: "done" });
        if (!closed) { closed = true; try { controller.close(); } catch {} }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
