import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  loadAgents,
  saveAgents,
  logsDir,
  logPathsFor,
  sessionsDirFor,
  dataDir,
} from "./registry";
import { parseLine } from "./parse-transcript";
import type { Agent, AgentRuntime, TranscriptEvent, WsMessage } from "./types";

const CLAUDE_BIN =
  process.env.CLAUDE_BIN ?? "/Users/noah/.bun/bin/claude";

type Broadcast = (msg: WsMessage) => void;

type LiveAgent = {
  agent: Agent;
  runtime: AgentRuntime;
  sessionOffset: number;
  sessionTailHandle: ReturnType<typeof setInterval> | null;
  sessionsDirWatcher: ReturnType<typeof watch> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  // Track when we spawned to attribute the next-created session file.
  spawnedAt: number | null;
};

const live: Map<string, LiveAgent> = new Map();
let broadcastFn: Broadcast = () => {};

function pidFilePath(agentId: string): string {
  return path.join(logsDir(), `${agentId}.pid`);
}

function readPidFile(agentId: string): number | null {
  const f = pidFilePath(agentId);
  if (!existsSync(f)) return null;
  const raw = readFileSync(f, "utf8").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function writePidFile(agentId: string, pid: number | null): void {
  const f = pidFilePath(agentId);
  if (pid === null) {
    try {
      writeFileSync(f, "");
    } catch {}
  } else {
    writeFileSync(f, String(pid));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeRuntime(agent: Agent): AgentRuntime {
  const logs = logPathsFor(agent.id);
  return {
    agentId: agent.id,
    pid: null,
    startedAt: null,
    uptimeSec: null,
    alive: false,
    sessionPath: null,
    lastExit: null,
    rateLimitedUntil: null,
    scheduledRestartAt: null,
    stdoutLogPath: logs.stdout,
    stderrLogPath: logs.stderr,
  };
}

function broadcastAgent(la: LiveAgent): void {
  broadcastFn({ type: "agent", agent: la.agent, runtime: la.runtime });
}

function refreshUptime(la: LiveAgent): void {
  if (la.runtime.startedAt && la.runtime.alive) {
    la.runtime.uptimeSec = Math.floor((Date.now() - la.runtime.startedAt) / 1000);
  } else {
    la.runtime.uptimeSec = null;
  }
}

export function listLive(): { agent: Agent; runtime: AgentRuntime }[] {
  for (const la of live.values()) refreshUptime(la);
  return Array.from(live.values()).map((la) => ({
    agent: la.agent,
    runtime: la.runtime,
  }));
}

export function setBroadcaster(fn: Broadcast): void {
  broadcastFn = fn;
}

function buildPrompt(agent: Agent): string {
  if (agent.direction.kind === "inline") return agent.direction.prompt;
  // file-mode: re-read on every spawn so edits to the file take effect next turn.
  const fp = agent.direction.filePath;
  if (!existsSync(fp)) {
    return `Your steering file ${fp} does not exist yet. Create it and begin work, or wait for instructions.`;
  }
  const body = readFileSync(fp, "utf8");
  return `Your steering file is ${fp}. Re-read it often. Current contents follow:\n\n---\n${body}\n---\n\nBegin. Don't ask questions, don't stop, don't exit. Always have a next tool call queued.`;
}

function spawnAgent(la: LiveAgent): void {
  const agent = la.agent;
  if (!existsSync(agent.workingDir)) {
    mkdirSync(agent.workingDir, { recursive: true });
  }
  const stdoutFd = openSync(la.runtime.stdoutLogPath, "a");
  const stderrFd = openSync(la.runtime.stderrLogPath, "a");
  const prompt = buildPrompt(agent);

  const args = [
    "--dangerously-skip-permissions",
    "--add-dir",
    agent.workingDir,
    "--model",
    agent.model,
    "--fallback-model",
    agent.fallbackModel,
    "--effort",
    agent.effort,
    "-p",
    prompt,
  ];

  // Strip API-key env vars so claude is forced to use Max-plan OAuth (keychain).
  // This guarantees no per-token API billing — when usage limit hits, claude
  // just errors out instead of falling back to a billable API key.
  const cleanEnv = { ...process.env };
  delete cleanEnv.ANTHROPIC_API_KEY;
  delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  const child = spawn(CLAUDE_BIN, args, {
    cwd: agent.workingDir,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    env: {
      ...cleanEnv,
      PATH: `/Users/noah/.bun/bin:/Users/noah/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: "/Users/noah",
    },
  });

  if (!child.pid) {
    console.error(`[sup] failed to spawn agent ${agent.id}`);
    return;
  }
  child.unref();

  la.runtime.pid = child.pid;
  la.runtime.startedAt = Date.now();
  la.runtime.alive = true;
  la.runtime.sessionPath = null;
  la.runtime.lastExit = null;
  la.runtime.scheduledRestartAt = null;
  la.spawnedAt = Date.now();
  la.sessionOffset = 0;
  writePidFile(agent.id, child.pid);
  console.log(`[sup] spawned agent ${agent.name} pid=${child.pid}`);
  broadcastAgent(la);
  watchSessionsDirFor(la);
  // After ~3s, also try to attribute the latest session file.
  setTimeout(() => {
    void attributeNewestSession(la);
  }, 3000);
}

function detectRateLimitFromStderr(stderrPath: string): number | null {
  try {
    if (!existsSync(stderrPath)) return null;
    const content = readFileSync(stderrPath, "utf8");
    // Read only the last 8KB; rate-limit message is usually the last thing.
    const tail = content.slice(-8192);
    // Pattern 1: "Claude AI usage limit reached|<unix_ts>"
    const m1 = tail.match(/usage limit reached\|(\d{10,13})/i);
    if (m1) {
      let ts = parseInt(m1[1], 10);
      if (ts < 1e12) ts *= 1000;
      return ts;
    }
    // Pattern 2: ISO timestamp after "reset" or "try again"
    const m2 = tail.match(
      /(?:reset(?:s|_at)?|try again|available again)[^0-9]{0,40}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^"\s,]*)/i,
    );
    if (m2) {
      const ts = new Date(m2[1]).getTime();
      if (Number.isFinite(ts)) return ts;
    }
    // Pattern 3: explicit "rate limit" / "5-hour limit" without parsable time.
    if (/rate ?limit|5-?hour limit|usage limit/i.test(tail)) {
      // Default: try in 5 minutes.
      return Date.now() + 5 * 60 * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

function pollExitedAgents(): void {
  for (const la of live.values()) {
    if (la.runtime.pid !== null && la.runtime.alive) {
      if (!isAlive(la.runtime.pid)) {
        const exitedPid = la.runtime.pid;
        la.runtime.alive = false;
        la.runtime.pid = null;
        la.runtime.uptimeSec = null;
        la.runtime.lastExit = { code: null, signal: null, ts: Date.now() };
        writePidFile(la.agent.id, null);
        console.log(`[sup] agent ${la.agent.name} pid=${exitedPid} exited`);

        if (la.agent.enabled && la.agent.keepAlive) {
          const limitUntil = detectRateLimitFromStderr(la.runtime.stderrLogPath);
          if (limitUntil && limitUntil > Date.now()) {
            la.runtime.rateLimitedUntil = limitUntil;
            scheduleRestart(la, limitUntil + 5_000);
          } else {
            // Crash or normal exit while enabled: short backoff then relaunch.
            scheduleRestart(la, Date.now() + 30_000);
          }
        }
        broadcastAgent(la);
      }
    }
  }
}

function scheduleRestart(la: LiveAgent, atMs: number): void {
  if (la.restartTimer) clearTimeout(la.restartTimer);
  const delay = Math.max(1000, atMs - Date.now());
  la.runtime.scheduledRestartAt = atMs;
  la.restartTimer = setTimeout(() => {
    la.restartTimer = null;
    la.runtime.scheduledRestartAt = null;
    if (la.agent.enabled) spawnAgent(la);
    else broadcastAgent(la);
  }, delay);
  console.log(
    `[sup] agent ${la.agent.name} restart scheduled in ${Math.round(delay / 1000)}s`,
  );
  broadcastAgent(la);
}

async function attributeNewestSession(la: LiveAgent): Promise<void> {
  const dir = sessionsDirFor(la.agent.workingDir);
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir).filter((e) => e.endsWith(".jsonl"));
  let best: { path: string; mtime: number } | null = null;
  for (const f of entries) {
    const full = path.join(dir, f);
    try {
      const s = statSync(full);
      // Already attributed to a different agent? skip
      if (sessionAlreadyAttributed(full, la.agent.id)) continue;
      // Created after our spawn timestamp (with small tolerance)?
      if (la.spawnedAt && s.mtimeMs < la.spawnedAt - 5_000) continue;
      if (!best || s.mtimeMs > best.mtime) {
        best = { path: full, mtime: s.mtimeMs };
      }
    } catch {}
  }
  if (best && best.path !== la.runtime.sessionPath) {
    la.runtime.sessionPath = best.path;
    la.sessionOffset = 0;
    broadcastAgent(la);
    await tailFromOffset(la);
  }
}

function sessionAlreadyAttributed(filePath: string, exceptAgentId: string): boolean {
  for (const la of live.values()) {
    if (la.agent.id === exceptAgentId) continue;
    if (la.runtime.sessionPath === filePath) return true;
  }
  return false;
}

function watchSessionsDirFor(la: LiveAgent): void {
  if (la.sessionsDirWatcher) return;
  const dir = sessionsDirFor(la.agent.workingDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  la.sessionsDirWatcher = watch(dir, async () => {
    await attributeNewestSession(la);
  });
}

async function tailFromOffset(la: LiveAgent): Promise<void> {
  const file = la.runtime.sessionPath;
  if (!file || !existsSync(file)) return;
  const s = await stat(file);
  if (s.size < la.sessionOffset) la.sessionOffset = 0;
  if (s.size === la.sessionOffset) return;
  const f = Bun.file(file);
  const slice = f.slice(la.sessionOffset, s.size);
  const text = await slice.text();
  la.sessionOffset = s.size;
  for (const line of text.split("\n")) {
    for (const ev of parseLine(line)) {
      broadcastFn({ type: "transcript", agentId: la.agent.id, event: ev });
    }
  }
}

function startSessionTailers(): void {
  setInterval(async () => {
    for (const la of live.values()) {
      if (la.runtime.sessionPath) await tailFromOffset(la);
    }
  }, 1000);
}

export function getInitialEvents(agentId: string, max = 200): TranscriptEvent[] {
  const la = live.get(agentId);
  if (!la || !la.runtime.sessionPath || !existsSync(la.runtime.sessionPath))
    return [];
  const text = readFileSync(la.runtime.sessionPath, "utf8");
  const out: TranscriptEvent[] = [];
  for (const line of text.split("\n")) {
    for (const ev of parseLine(line)) out.push(ev);
  }
  return out.slice(-max);
}

export function startAgent(agentId: string): boolean {
  const la = live.get(agentId);
  if (!la) return false;
  if (la.runtime.alive) return true;
  la.agent.enabled = true;
  persistAgent(la.agent);
  spawnAgent(la);
  return true;
}

export function stopAgent(agentId: string): boolean {
  const la = live.get(agentId);
  if (!la) return false;
  la.agent.enabled = false;
  persistAgent(la.agent);
  if (la.restartTimer) {
    clearTimeout(la.restartTimer);
    la.restartTimer = null;
    la.runtime.scheduledRestartAt = null;
  }
  if (la.runtime.pid !== null && isAlive(la.runtime.pid)) {
    try {
      // Kill the whole process group (claude spawns subprocs).
      process.kill(-la.runtime.pid, "SIGTERM");
    } catch {
      try {
        process.kill(la.runtime.pid, "SIGTERM");
      } catch {}
    }
  }
  broadcastAgent(la);
  return true;
}

export function restartAgent(agentId: string): boolean {
  const la = live.get(agentId);
  if (!la) return false;
  la.agent.enabled = true;
  persistAgent(la.agent);
  if (la.runtime.pid !== null && isAlive(la.runtime.pid)) {
    try {
      process.kill(-la.runtime.pid, "SIGTERM");
    } catch {
      try {
        process.kill(la.runtime.pid, "SIGTERM");
      } catch {}
    }
    // poll loop will detect exit and respawn.
    scheduleRestart(la, Date.now() + 2000);
  } else {
    spawnAgent(la);
  }
  return true;
}

export function createAgent(agent: Agent): LiveAgent {
  const la: LiveAgent = {
    agent,
    runtime: makeRuntime(agent),
    sessionOffset: 0,
    sessionTailHandle: null,
    sessionsDirWatcher: null,
    restartTimer: null,
    spawnedAt: null,
  };
  live.set(agent.id, la);
  persistAgent(agent);
  watchSessionsDirFor(la);
  if (agent.enabled) spawnAgent(la);
  broadcastAgent(la);
  return la;
}

export function updateAgent(agentId: string, patch: Partial<Agent>): boolean {
  const la = live.get(agentId);
  if (!la) return false;
  la.agent = { ...la.agent, ...patch, id: la.agent.id, createdAt: la.agent.createdAt };
  persistAgent(la.agent);
  broadcastAgent(la);
  return true;
}

export function removeAgent(agentId: string): boolean {
  const la = live.get(agentId);
  if (!la) return false;
  la.agent.enabled = false;
  if (la.restartTimer) clearTimeout(la.restartTimer);
  if (la.sessionsDirWatcher) la.sessionsDirWatcher.close();
  if (la.runtime.pid !== null && isAlive(la.runtime.pid)) {
    try {
      process.kill(-la.runtime.pid, "SIGTERM");
    } catch {
      try {
        process.kill(la.runtime.pid, "SIGTERM");
      } catch {}
    }
  }
  live.delete(agentId);
  const all = loadAgents().filter((a) => a.id !== agentId);
  saveAgents(all);
  broadcastFn({ type: "agent_removed", agentId });
  return true;
}

function persistAgent(agent: Agent): void {
  const all = loadAgents();
  const idx = all.findIndex((a) => a.id === agent.id);
  if (idx === -1) all.push(agent);
  else all[idx] = agent;
  saveAgents(all);
}

export function getAgent(agentId: string): Agent | null {
  const la = live.get(agentId);
  return la ? la.agent : null;
}

export function init(): void {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
  const agents = loadAgents();
  for (const a of agents) {
    const la: LiveAgent = {
      agent: a,
      runtime: makeRuntime(a),
      sessionOffset: 0,
      sessionTailHandle: null,
      sessionsDirWatcher: null,
      restartTimer: null,
      spawnedAt: null,
    };
    // Reattach to existing live process if PID file exists.
    const existingPid = readPidFile(a.id);
    if (existingPid && isAlive(existingPid)) {
      la.runtime.pid = existingPid;
      la.runtime.alive = true;
      la.runtime.startedAt = Date.now(); // unknown actual start; approximate
      la.spawnedAt = Date.now() - 60_000;
      console.log(
        `[sup] reattached to ${a.name} pid=${existingPid} (existing process)`,
      );
      void attributeNewestSession(la);
    }
    live.set(a.id, la);
    watchSessionsDirFor(la);
    if (a.enabled && !la.runtime.alive) {
      spawnAgent(la);
    }
  }
  setInterval(pollExitedAgents, 2000);
  startSessionTailers();
}
