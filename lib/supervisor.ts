import { spawn, spawnSync } from "node:child_process";
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
  // Timestamp of the most recent transcript event, used for stuck-detection.
  lastActivityAt: number | null;
  // Previous session JSONL paths this agent has used. After a restart the
  // pre-restart file is often still the "newest" one on disk for a few
  // seconds — skipping it prevents us from re-tailing it and replaying
  // every old event as if it were fresh.
  usedSessionPaths: Set<string>;
  // Sliding window of recent tool calls, used for stagnation detection (the
  // "agent ran out of real work and is now spinning on heartbeat-style
  // commands" failure mode). Capped/trimmed in tailFromOffset.
  recentToolCalls: { name: string; ts: number }[];
  // If set, prepended to the next spawn's prompt. Cleared after use. Used by
  // the stagnation kill path to nudge the model back into substantive work.
  pendingExtraContext: string | null;
};

// An agent that's alive but has produced no transcript activity for this
// long is considered stuck and gets killed + relaunched.
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
// Short backoff after a voluntary/clean exit or crash before respawning.
// Previously 30s — long enough that clean exits felt like they never came
// back.
const RESTART_BACKOFF_MS = 5_000;
// Stagnation window: if the agent has made many tool calls in this window
// but none of them were progress tools (Edit/Write/MultiEdit), we treat it
// as stuck-in-loop (e.g. atlas was spinning `echo "ok"` for 5h after running
// out of useful work). Kill + restart with extra context.
const STAGNATION_WINDOW_MS = 15 * 60 * 1000;
const STAGNATION_MIN_EVENTS = 10;
const PROGRESS_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const STAGNATION_RESTART_CONTEXT = `You were just restarted because for the previous ~15 minutes you were making tool calls but none of them edited any file or otherwise moved the work forward. That usually means you ran out of obvious next steps and started filling time. There is always more substantive work here — even if you are not sure what. Re-read your steering file. Re-read the notes you most recently touched. Find the weakest claim, the thinnest argument, the question you have been avoiding. Sit with it. Think hard. Refine. Do not reach for trivial filler tool calls when you are unsure — pick a specific hard question and dig into it.`;

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
  // kill(pid,0) returns true for ANY process that exists in the process
  // table — including zombies. A claude that exited but hasn't been reaped
  // would look alive to the supervisor and never get restarted. Check the
  // kernel state and reject anything whose state starts with Z (zombie).
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "state="], {
      encoding: "utf8",
    });
    const state = (r.stdout ?? "").trim();
    if (!state) return false;
    if (state.startsWith("Z")) return false;
    return true;
  } catch {
    // If ps fails for some reason, trust the kill(pid,0) result.
    return true;
  }
}

/**
 * Read the wall-clock time the given PID actually started, via `ps -o
 * lstart=`. Used on ws-server reattach so uptime reflects the real process
 * lifetime instead of resetting every time the dashboard hot-reloads.
 */
function processStartTimeMs(pid: number): number | null {
  try {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
    });
    const out = (r.stdout ?? "").trim();
    if (!out) return null;
    const ms = new Date(out).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
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

const NEVER_EXIT_CODA = `Begin. This session must never end voluntarily. Do not ask questions, do not declare yourself done, do not exit. If you believe the immediate task is complete, find related work: deepen, refactor, cross-link, stress-test, or explore adjacent questions. Always have a next tool call queued.`;

function buildPrompt(agent: Agent): string {
  if (agent.direction.kind === "inline") {
    return `${agent.direction.prompt}\n\n${NEVER_EXIT_CODA}`;
  }
  // file-mode: re-read on every spawn so edits to the file take effect next turn.
  const fp = agent.direction.filePath;
  if (!existsSync(fp)) {
    return `Your steering file ${fp} does not exist yet. Create it and begin work.\n\n${NEVER_EXIT_CODA}`;
  }
  const body = readFileSync(fp, "utf8");
  return `Your steering file is ${fp}. Re-read it often. Current contents follow:\n\n---\n${body}\n---\n\n${NEVER_EXIT_CODA}`;
}

function spawnAgent(la: LiveAgent): void {
  const agent = la.agent;
  if (!existsSync(agent.workingDir)) {
    mkdirSync(agent.workingDir, { recursive: true });
  }
  const stdoutFd = openSync(la.runtime.stdoutLogPath, "a");
  const stderrFd = openSync(la.runtime.stderrLogPath, "a");
  let prompt = buildPrompt(agent);
  if (la.pendingExtraContext) {
    prompt = `${prompt}\n\n${la.pendingExtraContext}`;
    la.pendingExtraContext = null;
  }

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

  // Reap immediately when this process exits. Without this listener the
  // child becomes a zombie under the supervisor (we never waitpid()) and
  // kill(pid,0)-based polling reports it as alive forever. Listening also
  // catches the exit a couple of seconds before the PID poll would.
  const childPid = child.pid;
  child.on("exit", (code, signal) => {
    if (la.runtime.pid !== childPid) return; // a later spawn already replaced us
    handleAgentExit(la, code, signal);
  });

  // Remember the outgoing session so attributeNewestSession doesn't re-pick
  // it during the tail window where it's still the freshest file on disk.
  if (la.runtime.sessionPath) la.usedSessionPaths.add(la.runtime.sessionPath);
  la.runtime.pid = child.pid;
  la.runtime.startedAt = Date.now();
  la.runtime.alive = true;
  la.runtime.sessionPath = null;
  la.runtime.lastExit = null;
  la.lastActivityAt = Date.now();
  la.runtime.scheduledRestartAt = null;
  la.spawnedAt = Date.now();
  la.sessionOffset = 0;
  la.recentToolCalls = [];
  writePidFile(agent.id, child.pid);
  console.log(`[sup] spawned agent ${agent.name} pid=${child.pid}`);
  broadcastAgent(la);
  watchSessionsDirFor(la);
  // After ~3s, also try to attribute the latest session file.
  setTimeout(() => {
    void attributeNewestSession(la);
  }, 3000);
}

/**
 * Find the next wall-clock instant in `tz` that matches the given hour and
 * minute. Returns ms-since-epoch, or null if the timezone is unrecognized.
 *
 * Implementation: walk forward in 1-minute steps (capped at 30h) and check
 * each instant's tz wall-clock components via Intl. Avoids hand-rolled
 * offset math, which is brittle around DST transitions.
 */
function nextOccurrenceInTz(
  hour24: number,
  minute: number,
  tz: string,
): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const now = Date.now();
    for (let m = 1; m < 30 * 60; m++) {
      const ts = now + m * 60 * 1000;
      const parts: Record<string, string> = {};
      for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
      const hh = parseInt(parts.hour, 10) % 24;
      const mm = parseInt(parts.minute, 10);
      if (hh === hour24 && mm === minute) return ts;
    }
    return null;
  } catch {
    return null;
  }
}

function detectRateLimit(
  stderrPath: string,
  stdoutPath: string,
): number | null {
  // Claude prints the friendly "You've hit your limit" message to stdout, not
  // stderr — so we have to scan both files. Keep stderr first since the older
  // machine-readable formats (pattern 1) historically lived there.
  for (const p of [stderrPath, stdoutPath]) {
    const ts = detectRateLimitFromFile(p);
    if (ts !== null) return ts;
  }
  return null;
}

function detectRateLimitFromFile(filePath: string): number | null {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf8");
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
    // Pattern 3: friendly "You've hit your limit · resets <h>:<mm><am|pm> (<tz>)"
    // (this is the format Claude Code currently prints to stdout)
    const m3 = tail.match(
      /(?:You(?:'ve)? hit your limit|usage limit)[^·\n]*[·\n]\s*resets?\s+(\d{1,2}):?(\d{2})?\s*(am|pm)\s*\(([^)]+)\)/i,
    );
    if (m3) {
      let h = parseInt(m3[1], 10);
      const min = m3[2] ? parseInt(m3[2], 10) : 0;
      const ampm = m3[3].toLowerCase();
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      const ts = nextOccurrenceInTz(h, min, m3[4]);
      if (ts) return ts;
    }
    // Pattern 4: explicit "rate limit" / "5-hour limit" without parsable time.
    if (/rate ?limit|5-?hour limit|usage limit|hit your limit/i.test(tail)) {
      // Default: try in 5 minutes.
      return Date.now() + 5 * 60 * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

function handleAgentExit(
  la: LiveAgent,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  if (!la.runtime.alive && la.runtime.pid === null) return; // already handled
  const exitedPid = la.runtime.pid;
  la.runtime.alive = false;
  la.runtime.pid = null;
  la.runtime.uptimeSec = null;
  la.runtime.lastExit = { code, signal, ts: Date.now() };
  writePidFile(la.agent.id, null);
  console.log(
    `[sup] agent ${la.agent.name} pid=${exitedPid} exited (code=${code ?? "?"} signal=${signal ?? "?"})`,
  );
  if (la.agent.enabled && la.agent.keepAlive) {
    const limitUntil = detectRateLimit(
      la.runtime.stderrLogPath,
      la.runtime.stdoutLogPath,
    );
    if (limitUntil && limitUntil > Date.now()) {
      la.runtime.rateLimitedUntil = limitUntil;
      scheduleRestart(la, limitUntil + 5_000);
    } else {
      // Crash, voluntary exit, "I'm done" — all get the same fast restart.
      // Small backoff prevents tight crash loops.
      scheduleRestart(la, Date.now() + RESTART_BACKOFF_MS);
    }
  }
  broadcastAgent(la);
}

function pollExitedAgents(): void {
  for (const la of live.values()) {
    if (la.runtime.pid !== null && la.runtime.alive) {
      if (!isAlive(la.runtime.pid)) {
        handleAgentExit(la, null, null);
      }
    }
  }
}

/**
 * Kill any agent that is alive but has produced no transcript activity for
 * longer than STUCK_THRESHOLD_MS. pollExitedAgents will see the dead PID on
 * the next tick and schedule the restart through the normal path.
 */
function pollStuckAgents(): void {
  const now = Date.now();
  for (const la of live.values()) {
    if (!la.runtime.alive || la.runtime.pid === null) continue;
    if (!la.agent.enabled || !la.agent.keepAlive) continue;
    if (la.lastActivityAt === null) continue;
    const idleMs = now - la.lastActivityAt;
    if (idleMs < STUCK_THRESHOLD_MS) continue;
    console.warn(
      `[sup] agent ${la.agent.name} pid=${la.runtime.pid} idle ${Math.round(idleMs / 1000)}s — killing to force restart`,
    );
    try {
      process.kill(-la.runtime.pid, "SIGTERM");
    } catch {
      try {
        process.kill(la.runtime.pid, "SIGTERM");
      } catch {}
    }
    // Clear so we don't spam SIGTERM every 30s — pollExitedAgents will take
    // it from here once the OS reaps the process.
    la.lastActivityAt = now;
  }
}

/**
 * Detect agents that are alive and producing tool calls but have stopped
 * making concrete progress — e.g., looping on `echo "ok"` heartbeats after
 * exhausting obvious next steps. Trigger: in the past STAGNATION_WINDOW_MS,
 * STAGNATION_MIN_EVENTS+ tool calls, none of which were progress tools
 * (Edit/Write/MultiEdit/NotebookEdit). Kill the process group; the next
 * spawn picks up `pendingExtraContext` to nudge the model back into real
 * work.
 *
 * Intentionally does NOT inspect command content (no banned commands) — a
 * legitimate `echo` or `sleep` mid-build is fine. The signal is the absence
 * of edits over a sustained window.
 */
function pollStagnantAgents(): void {
  const now = Date.now();
  const cutoff = now - STAGNATION_WINDOW_MS;
  for (const la of live.values()) {
    if (!la.runtime.alive || la.runtime.pid === null) continue;
    if (!la.agent.enabled || !la.agent.keepAlive) continue;
    // Skip if the process hasn't been alive long enough to have a full
    // window's worth of activity yet.
    if (la.runtime.startedAt && now - la.runtime.startedAt < STAGNATION_WINDOW_MS) {
      continue;
    }
    const recent = la.recentToolCalls.filter((c) => c.ts >= cutoff);
    if (recent.length < STAGNATION_MIN_EVENTS) continue;
    const progress = recent.filter((c) => PROGRESS_TOOLS.has(c.name)).length;
    if (progress > 0) continue;
    console.warn(
      `[sup] agent ${la.agent.name} pid=${la.runtime.pid} stagnant: ${recent.length} tool calls in last ${STAGNATION_WINDOW_MS / 60000}m, 0 edits — killing to force restart with extra context`,
    );
    la.pendingExtraContext = STAGNATION_RESTART_CONTEXT;
    la.recentToolCalls = [];
    try {
      process.kill(-la.runtime.pid, "SIGTERM");
    } catch {
      try {
        process.kill(la.runtime.pid, "SIGTERM");
      } catch {}
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
  // Only running agents should claim session files. Stopped or
  // never-started agents share the same sessions directory as their
  // siblings, so without this guard the dir watcher would latch them
  // onto whichever unclaimed JSONL looks newest — including old files
  // from another agent's previous run, producing the "stopped agent shows
  // someone else's work" bug.
  if (!la.runtime.alive) return;
  if (!la.spawnedAt) return;
  const dir = sessionsDirFor(la.agent.workingDir);
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir).filter((e) => e.endsWith(".jsonl"));
  const spawnedAt = la.spawnedAt;
  // Pick the file whose creation time is closest to our spawn moment,
  // within a tight window. Using mtime here is wrong: a sibling's still-
  // active session file has a fresh mtime even though it's ancient.
  let best: { path: string; diff: number } | null = null;
  for (const f of entries) {
    const full = path.join(dir, f);
    try {
      const s = statSync(full);
      if (sessionAlreadyAttributed(full, la.agent.id)) continue;
      if (la.usedSessionPaths.has(full)) continue;
      const born = s.birthtimeMs || s.ctimeMs;
      const diff = born - spawnedAt;
      if (diff < -5_000 || diff > 30_000) continue;
      if (!best || Math.abs(diff) < Math.abs(best.diff)) {
        best = { path: full, diff };
      }
    } catch {}
  }
  if (best && best.path !== la.runtime.sessionPath) {
    const isSwitch = la.runtime.sessionPath !== null;
    la.runtime.sessionPath = best.path;
    la.sessionOffset = 0;
    la.lastActivityAt = Date.now();
    // Tell the frontend to drop any cached events from the previous session
    // before we start streaming the new one.
    if (isSwitch) {
      broadcastFn({ type: "session_reset", agentId: la.agent.id });
    }
    broadcastAgent(la);
    await tailFromOffset(la);
  }
}

/**
 * Attach to the agent's current session file without emitting anything
 * that's already in it. Used on ws-server init/hot-reload so existing
 * transcript content isn't re-streamed to clients that already have it.
 */
async function reattachCurrentSession(la: LiveAgent): Promise<void> {
  if (!la.runtime.pid) return;
  const processStart = processStartTimeMs(la.runtime.pid);
  if (!processStart) return;
  const dir = sessionsDirFor(la.agent.workingDir);
  if (!existsSync(dir)) return;
  // Claude creates its session JSONL within a few seconds of launching.
  // Accept only files born in a tight window around the process start —
  // this prevents picking up a sibling agent's still-active-but-older
  // session file, which would otherwise look newest because the sibling
  // keeps writing to it.
  const entries = readdirSync(dir).filter((e) => e.endsWith(".jsonl"));
  let best: { path: string; diff: number } | null = null;
  for (const f of entries) {
    const full = path.join(dir, f);
    try {
      const s = statSync(full);
      const born = s.birthtimeMs || s.ctimeMs;
      const diff = born - processStart;
      if (diff < -5_000 || diff > 30_000) continue;
      if (sessionAlreadyAttributed(full, la.agent.id)) continue;
      if (!best || Math.abs(diff) < Math.abs(best.diff)) {
        best = { path: full, diff };
      }
    } catch {}
  }
  if (best) {
    la.runtime.sessionPath = best.path;
    try {
      la.sessionOffset = statSync(best.path).size;
    } catch {
      la.sessionOffset = 0;
    }
    broadcastAgent(la);
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
      la.lastActivityAt = Date.now();
      if (ev.kind === "tool_use") {
        la.recentToolCalls.push({ name: ev.name, ts: ev.ts });
        // Keep buffer bounded; pollStagnantAgents only looks at the recent
        // window anyway.
        if (la.recentToolCalls.length > 200) {
          la.recentToolCalls.splice(0, la.recentToolCalls.length - 200);
        }
      }
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
    lastActivityAt: null,
    usedSessionPaths: new Set(),
    recentToolCalls: [],
    pendingExtraContext: null,
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
      lastActivityAt: null,
      usedSessionPaths: new Set(),
      recentToolCalls: [],
      pendingExtraContext: null,
    };
    // Reattach to existing live process if PID file exists.
    const existingPid = readPidFile(a.id);
    if (existingPid && isAlive(existingPid)) {
      const actualStart = processStartTimeMs(existingPid);
      la.runtime.pid = existingPid;
      la.runtime.alive = true;
      // Prefer the kernel-reported start time so uptime survives ws-server
      // hot-reloads and reconnects. Fall back to "now" only if ps fails.
      la.runtime.startedAt = actualStart ?? Date.now();
      la.spawnedAt = actualStart ?? Date.now() - 60_000;
      la.lastActivityAt = Date.now();
      console.log(
        `[sup] reattached to ${a.name} pid=${existingPid} (existing process)`,
      );
      // Reattach to the current session without re-streaming historical
      // events. The frontend already has them cached or will fetch them
      // on demand via getInitialEvents. Re-emitting would duplicate
      // everything on every ws-server hot reload.
      void reattachCurrentSession(la);
    }
    live.set(a.id, la);
    watchSessionsDirFor(la);
    if (a.enabled && !la.runtime.alive) {
      spawnAgent(la);
    }
  }
  setInterval(pollExitedAgents, 2000);
  setInterval(pollStuckAgents, 30_000);
  setInterval(pollStagnantAgents, 60_000);
  startSessionTailers();
}
