import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/Users/noah/.bun/bin/claude";
const BUN_BIN = process.env.BUN_BIN ?? "/Users/noah/.bun/bin/bun";
const HOME = process.env.HOME ?? "/Users/noah";
const PROJECT_ROOT = process.cwd();
const MCP_SCRIPT = path.join(PROJECT_ROOT, "mcp-houston.ts");

const SYSTEM_PROMPT = `You are the Houston meta-agent — an assistant embedded in a dashboard that runs many Claude Code agents in parallel.

You have an MCP server named "houston" with tools to inspect, create, and manage those agents. Call its tools eagerly — do not guess from memory. For every "what is X doing" / "how is X going" question, fetch the transcript.

Conventions:
- When the user refers to an agent by name ("the ai-safety agent"), call list_agents first to resolve the name to an id.
- When reporting status, be concise. Use a bullet per agent. Flag rate-limited or stopped agents.
- When asked to create an agent, confirm the workingDir and direction with the user *before* calling create_agent unless the user was explicit.
- When asked to delete or stop an agent, double-check with the user if it looks like production work.
- When summarizing a transcript, call out recent tool calls and any errors — don't replay everything.
- Format agent IDs as short inline code.
- Keep replies tight — the chat pane is small.`;

type ChatRequest = {
  sessionId?: string | null;
  message: string;
};

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const message = (body.message ?? "").trim();
  if (!message) {
    return new Response("message required", { status: 400 });
  }

  const existingSession =
    body.sessionId && isValidUuid(body.sessionId) ? body.sessionId : null;
  const sessionId = existingSession ?? randomUUID();

  const mcpConfig = JSON.stringify({
    mcpServers: {
      houston: {
        command: BUN_BIN,
        args: [MCP_SCRIPT],
      },
    },
  });

  // Strip API-key env vars so claude is forced to use Max-plan OAuth (keychain).
  // Same approach the supervisor uses for spawned agents.
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.ANTHROPIC_API_KEY;
  delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  // Keep claude's built-in tool surface small so it goes straight to our MCP tools.
  const ALLOWED = ["mcp__houston", "Read", "Bash(git log:*)", "Bash(git diff:*)"];

  const args = [
    "--dangerously-skip-permissions",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--allowedTools",
    ALLOWED.join(" "),
    "--disallowedTools",
    "ToolSearch Task WebFetch WebSearch Edit Write NotebookEdit",
    "--append-system-prompt",
    SYSTEM_PROMPT,
    "--output-format",
    "stream-json",
    "--input-format",
    "text",
    "--include-partial-messages",
    "--verbose",
    "--model",
    "claude-sonnet-4-6",
    "--fallback-model",
    "claude-haiku-4-5",
    "--effort",
    "medium",
    "-p",
    message,
  ];
  if (existingSession) args.push("--resume", sessionId);
  else args.push("--session-id", sessionId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(obj)));
        } catch {
          closed = true;
        }
      };

      send({ type: "session", sessionId });

      const spawnEnv = {
        ...cleanEnv,
        PATH: `/Users/noah/.bun/bin:/Users/noah/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME,
      };
      console.log(`[meta] spawning claude for session ${sessionId}`);
      const child = spawn(CLAUDE_BIN, args, {
        cwd: PROJECT_ROOT,
        env: spawnEnv as unknown as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Abort child if client disconnects.
      req.signal.addEventListener("abort", () => {
        try {
          child.kill("SIGTERM");
        } catch {}
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      let turn = 0; // increments on each anthropic-level message_start

      const handleJsonLine = (line: string) => {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(line);
        } catch {
          return;
        }
        const type = obj.type as string;

        if (type === "system" && obj.subtype === "init") {
          // Already emitted session. Could surface tool list, skip for now.
          return;
        }

        if (type === "stream_event") {
          const ev = obj.event as { type: string } & Record<string, unknown>;
          if (!ev || typeof ev !== "object") return;
          if (ev.type === "message_start") {
            turn++;
            return;
          }
          if (ev.type === "content_block_start") {
            const idx = ev.index as number;
            const key = `${turn}-${idx}`;
            const block = ev.content_block as {
              type: string;
              id?: string;
              name?: string;
            };
            if (block.type === "text") {
              send({ type: "text_start", key });
            } else if (block.type === "thinking") {
              send({ type: "thinking_start", key });
            } else if (block.type === "tool_use") {
              send({
                type: "tool_start",
                key,
                tool_use_id: block.id,
                name: block.name,
              });
            }
            return;
          }
          if (ev.type === "content_block_delta") {
            const idx = ev.index as number;
            const key = `${turn}-${idx}`;
            const delta = ev.delta as { type: string } & Record<string, unknown>;
            if (delta.type === "text_delta") {
              send({ type: "text_delta", key, text: delta.text });
            } else if (delta.type === "thinking_delta") {
              send({ type: "thinking_delta", key, text: delta.thinking });
            } else if (delta.type === "input_json_delta") {
              send({
                type: "tool_input_delta",
                key,
                partial_json: delta.partial_json,
              });
            }
            return;
          }
          if (ev.type === "content_block_stop") {
            const idx = ev.index as number;
            send({ type: "block_stop", key: `${turn}-${idx}` });
            return;
          }
          if (ev.type === "message_delta") {
            const usage = ev.usage as Record<string, number> | undefined;
            if (usage) {
              send({
                type: "usage",
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_read: usage.cache_read_input_tokens ?? null,
                cache_write: usage.cache_creation_input_tokens ?? null,
              });
            }
            return;
          }
          return;
        }

        if (type === "user") {
          // Surface tool_result blocks. These carry the output of MCP tool calls.
          const msg = obj.message as
            | {
                content?: Array<{
                  type: string;
                  tool_use_id?: string;
                  content?: unknown;
                  is_error?: boolean;
                }>;
              }
            | undefined;
          const content = msg?.content ?? [];
          for (const b of content) {
            if (b.type === "tool_result") {
              let text = "";
              if (typeof b.content === "string") text = b.content;
              else if (Array.isArray(b.content)) {
                text = b.content
                  .map((x) => {
                    if (x && typeof x === "object" && "text" in x)
                      return String((x as { text: unknown }).text);
                    return JSON.stringify(x);
                  })
                  .join("\n");
              }
              send({
                type: "tool_result",
                tool_use_id: b.tool_use_id,
                content: text,
                is_error: Boolean(b.is_error),
              });
            }
          }
          return;
        }

        if (type === "result") {
          send({
            type: "result",
            subtype: obj.subtype,
            duration_ms: obj.duration_ms,
            total_cost_usd: obj.total_cost_usd,
            num_turns: obj.num_turns,
            is_error: obj.is_error,
          });
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
      child.stderr?.on("data", (chunk: string) => {
        stderrBuf += chunk;
        console.error(`[meta stderr] ${chunk.trim()}`);
      });

      child.on("error", (e) => {
        send({ type: "error", message: `spawn error: ${e.message}` });
      });

      child.on("close", (code, signal) => {
        if (stdoutBuf.trim()) handleJsonLine(stdoutBuf.trim());
        if (code !== 0) {
          const tail = stderrBuf.slice(-800);
          send({
            type: "error",
            message: `claude exited with code=${code} signal=${signal ?? ""}${
              tail ? `\n${tail}` : ""
            }`,
          });
        }
        send({ type: "done" });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {}
        }
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
