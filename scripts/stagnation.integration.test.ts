/**
 * Integration test for the stagnation kill → respawn-with-nudge flow.
 *
 * Drives the real supervisor functions against a mock `claude` binary that
 * dumps its argv to a file and then sleeps forever. The mock lets us
 * observe what prompt the supervisor passed to each spawn without paying
 * for or waiting on a real model.
 *
 * Verifies end-to-end:
 *   1. spawnAgent launches the mock with the original prompt (no nudge).
 *   2. pollStagnantAgents detects a stale all-Bash buffer and SIGTERMs.
 *   3. handleAgentExit (via child.on("exit")) schedules the restart.
 *   4. The next spawnAgent prepends pendingExtraContext to the prompt.
 *   5. pendingExtraContext is cleared after one consumption.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let tmp: string;
let mockBin: string;
let dumpFile: string;
let workingDir: string;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "agents-stagnation-it-"));
  mockBin = path.join(tmp, "mock-claude.sh");
  dumpFile = path.join(tmp, "argv.dump");
  workingDir = path.join(tmp, "wd");
  // Mock binary: dump argv as one line per arg (so the prompt arg, which
  // contains newlines, can still be retrieved as a single trailing field by
  // reading the file as a whole). Then sleep forever so the supervisor sees
  // the process as alive.
  writeFileSync(
    mockBin,
    `#!/bin/bash\nprintf '%s\\0' "$@" > "$MOCK_CLAUDE_DUMP"\nexec sleep 999999\n`,
  );
  chmodSync(mockBin, 0o755);
  process.env.CLAUDE_BIN = mockBin;
  process.env.MOCK_CLAUDE_DUMP = dumpFile;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function readDumpedArgs(): string[] {
  if (!existsSync(dumpFile)) return [];
  // null-separated; bash printf '%s\0' "$@" emits each arg followed by NUL.
  return readFileSync(dumpFile, "utf8").split("\0").slice(0, -1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("stagnation → SIGTERM → respawn with nudge prepended to prompt", async () => {
  // Import inside the test so CLAUDE_BIN/MOCK_CLAUDE_DUMP are set before the
  // module captures them in the top-level const.
  const supervisor = await import("../lib/supervisor");
  const { __test } = supervisor;

  const agentId = randomUUID();
  const ORIGINAL_PROMPT = `INTEGRATION-TEST-PROMPT-${agentId.slice(0, 8)}`;

  // Build a LiveAgent shape directly — sidesteps createAgent() (which would
  // persist to data/agents.json and pollute the real registry).
  const agent = {
    id: agentId,
    name: `it-${agentId.slice(0, 8)}`,
    workingDir,
    direction: { kind: "inline" as const, prompt: ORIGINAL_PROMPT },
    model: "claude-opus-4-7",
    fallbackModel: "claude-opus-4-6",
    effort: "max" as const,
    enabled: true,
    keepAlive: true,
    createdAt: Date.now(),
  };
  const runtime = {
    agentId,
    pid: null,
    startedAt: null,
    uptimeSec: null,
    alive: false,
    sessionPath: null,
    lastExit: null,
    rateLimitedUntil: null,
    scheduledRestartAt: null,
    stdoutLogPath: path.join(tmp, "agent.stdout.log"),
    stderrLogPath: path.join(tmp, "agent.stderr.log"),
  };
  const la = {
    agent,
    runtime,
    sessionOffset: 0,
    sessionTailHandle: null,
    sessionsDirWatcher: null,
    restartTimer: null,
    spawnedAt: null,
    lastActivityAt: null,
    usedSessionPaths: new Set<string>(),
    recentToolCalls: [],
    pendingExtraContext: null,
  } as unknown as Parameters<typeof __test.spawnAgent>[0];

  __test.live.set(agentId, la as never);

  try {
    // ---------- 1. initial spawn ----------
    __test.spawnAgent(la);
    expect(la.runtime.pid).not.toBeNull();
    const firstPid = la.runtime.pid as number;
    expect(pidAlive(firstPid)).toBe(true);

    // Wait briefly for the mock to write its argv dump.
    for (let i = 0; i < 30 && !existsSync(dumpFile); i++) await sleep(50);
    let args = readDumpedArgs();
    expect(args.length).toBeGreaterThan(0);
    // -p <prompt> — find the prompt arg
    const pIdx1 = args.indexOf("-p");
    expect(pIdx1).toBeGreaterThan(-1);
    const prompt1 = args[pIdx1 + 1];
    expect(prompt1).toContain(ORIGINAL_PROMPT);
    expect(prompt1).toContain("Begin. This session must never end voluntarily.");
    expect(prompt1).not.toContain("You were just restarted because");

    // ---------- 2. simulate stagnation ----------
    const now = Date.now();
    // 12 Bash calls spread across the past 5 minutes — well under the 15-min
    // window, well over the 10-event minimum, all non-progress.
    la.recentToolCalls = Array.from({ length: 12 }, (_, i) => ({
      name: "Bash",
      ts: now - i * 25_000,
    }));
    // Pretend the process has been alive longer than the window so the
    // fresh-process guard doesn't skip us.
    la.runtime.startedAt = now - 30 * 60 * 1000;

    __test.pollStagnantAgents();

    // Nudge should have been queued for the next spawn.
    expect(la.pendingExtraContext).not.toBeNull();
    expect(la.pendingExtraContext).toContain("You were just restarted because");

    // ---------- 3. wait for mock process to die from SIGTERM ----------
    let deathDeadline = Date.now() + 5_000;
    while (Date.now() < deathDeadline && pidAlive(firstPid)) await sleep(100);
    expect(pidAlive(firstPid)).toBe(false);

    // ---------- 4. wait for handleAgentExit + scheduleRestart + spawn ----------
    // RESTART_BACKOFF_MS = 5_000; scheduleRestart enforces min 1_000.
    // Poll for the new PID for up to ~10s.
    const respawnDeadline = Date.now() + 10_000;
    while (
      Date.now() < respawnDeadline &&
      (la.runtime.pid === null || la.runtime.pid === firstPid)
    ) {
      await sleep(100);
    }
    expect(la.runtime.pid).not.toBeNull();
    expect(la.runtime.pid).not.toBe(firstPid);
    expect(pidAlive(la.runtime.pid as number)).toBe(true);

    // Wait for the new mock process to dump its argv (overwrites the file).
    // The new process may take a moment to exec the script.
    for (let i = 0; i < 40; i++) {
      await sleep(50);
      const fresh = readDumpedArgs();
      if (fresh.length > 0) {
        const pIdx = fresh.indexOf("-p");
        if (pIdx > -1 && fresh[pIdx + 1].includes("You were just restarted")) {
          break;
        }
      }
    }

    args = readDumpedArgs();
    const pIdx2 = args.indexOf("-p");
    expect(pIdx2).toBeGreaterThan(-1);
    const prompt2 = args[pIdx2 + 1];
    expect(prompt2).toContain(ORIGINAL_PROMPT);
    expect(prompt2).toContain("Begin. This session must never end voluntarily.");
    expect(prompt2).toContain(
      "You were just restarted because for the previous ~15 minutes",
    );

    // ---------- 5. pendingExtraContext cleared after consumption ----------
    expect(la.pendingExtraContext).toBeNull();
  } finally {
    // Cleanup order matters: disable the agent BEFORE killing, so the
    // child.on("exit") → handleAgentExit path sees `enabled=false` and skips
    // scheduleRestart. Otherwise the supervisor will keep respawning the
    // mock in the background and pollute subsequent tests.
    la.agent.enabled = false;
    if (la.restartTimer) {
      clearTimeout(la.restartTimer);
      la.restartTimer = null;
    }
    if (la.runtime.pid && pidAlive(la.runtime.pid)) {
      try {
        process.kill(-la.runtime.pid, "SIGKILL");
      } catch {
        try {
          process.kill(la.runtime.pid, "SIGKILL");
        } catch {}
      }
    }
    __test.live.delete(agentId);
    // Give the exit handler a moment to fire on the final SIGKILL so it
    // marks runtime.alive=false and we don't leave a dangling listener.
    await sleep(200);
  }
}, 30_000); // generous test timeout: 30s
