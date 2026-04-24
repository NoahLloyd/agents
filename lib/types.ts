export type AgentDirection =
  | { kind: "file"; filePath: string }
  | { kind: "inline"; prompt: string };

export type Agent = {
  id: string;
  name: string;
  workingDir: string;
  direction: AgentDirection;
  model: string;
  fallbackModel: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  enabled: boolean;
  keepAlive: boolean;
  createdAt: number;
};

export type AgentRuntime = {
  agentId: string;
  pid: number | null;
  startedAt: number | null;
  uptimeSec: number | null;
  alive: boolean;
  sessionPath: string | null;
  lastExit: { code: number | null; signal: string | null; ts: number } | null;
  rateLimitedUntil: number | null;
  scheduledRestartAt: number | null;
  stdoutLogPath: string;
  stderrLogPath: string;
};

export type TranscriptEvent =
  | { kind: "text"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | {
      kind: "tool_use";
      name: string;
      input: Record<string, unknown>;
      id: string;
      ts: number;
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      isError: boolean;
      ts: number;
    }
  | { kind: "system"; subtype: string; ts: number }
  | { kind: "result"; subtype: string; durationMs: number; ts: number };

export type FileChange = {
  path: string;
  relPath: string;
  kind: "add" | "change" | "unlink";
  ts: number;
};

export type AutoCommitState =
  | "committed"
  | "no-changes"
  | "not-a-repo"
  | "error";

export type AutoCommitInfo = {
  workingDir: string;
  state: AutoCommitState;
  hash?: string;
  message?: string;
  pushed?: boolean;
  agentNames: string[];
  ts: number;
};

export type WsMessage =
  | { type: "transcript"; agentId: string; event: TranscriptEvent }
  | { type: "file"; agentId: string | null; change: FileChange }
  | { type: "agent"; agent: Agent; runtime: AgentRuntime }
  | { type: "agent_removed"; agentId: string }
  | { type: "agents_snapshot"; agents: { agent: Agent; runtime: AgentRuntime }[] }
  | { type: "auto_commit"; info: AutoCommitInfo }
  | { type: "session_reset"; agentId: string };
