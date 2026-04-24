import { existsSync } from "node:fs";
import path from "node:path";

const INTERVAL_MS = 10 * 60 * 1000;
const GIT_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 60_000;

// Commits are authored as this bot so they don't count toward your GitHub
// profile. Override via env if you want a different identity.
const AUTHOR_EMAIL = process.env.AUTOCOMMIT_EMAIL ?? "agents-bot@local";
const AUTHOR_NAME = process.env.AUTOCOMMIT_NAME ?? "agents-bot";

export type AutoCommitState =
  | "committed"
  | "no-changes"
  | "not-a-repo"
  | "error";

export type AutoCommitResult = {
  workingDir: string;
  state: AutoCommitState;
  hash?: string;
  message?: string;
  pushed?: boolean;
  agentNames: string[];
  ts: number;
};

export type DirsByAgent = Map<string, string[]>;

async function runGit(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const killTimer = setTimeout(() => {
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);
  const code = await proc.exited;
  clearTimeout(killTimer);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function tsLabel(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

async function commitOnce(
  workingDir: string,
  agentNames: string[],
): Promise<AutoCommitResult> {
  const ts = Date.now();
  const base = { workingDir, agentNames, ts };

  if (!existsSync(path.join(workingDir, ".git"))) {
    return { ...base, state: "not-a-repo" };
  }

  const add = await runGit(["add", "-A"], workingDir);
  if (add.code !== 0) {
    return {
      ...base,
      state: "error",
      message: `add: ${add.stderr.trim().slice(0, 200)}`,
    };
  }

  const diff = await runGit(["diff", "--cached", "--quiet"], workingDir);
  // git diff --cached --quiet exits 0 when staging is clean, 1 when there
  // are staged changes. Anything else is an error we'd want to see.
  if (diff.code === 0) return { ...base, state: "no-changes" };
  if (diff.code !== 1) {
    return {
      ...base,
      state: "error",
      message: `diff: exit ${diff.code} ${diff.stderr.trim().slice(0, 200)}`,
    };
  }

  const msg = agentNames.length
    ? `auto ${tsLabel(ts)} — ${agentNames.join(", ")}`
    : `auto ${tsLabel(ts)}`;

  const commit = await runGit(
    [
      "-c",
      `user.email=${AUTHOR_EMAIL}`,
      "-c",
      `user.name=${AUTHOR_NAME}`,
      "commit",
      "-q",
      "-m",
      msg,
    ],
    workingDir,
  );
  if (commit.code !== 0) {
    return {
      ...base,
      state: "error",
      message: `commit: ${commit.stderr.trim().slice(0, 200)}`,
    };
  }

  const hashR = await runGit(["rev-parse", "--short", "HEAD"], workingDir);
  const hash = hashR.code === 0 ? hashR.stdout.trim() : undefined;

  // Push best-effort. Offline or no-upstream are fine — we'll get it next tick.
  const push = await runGit(["push", "--quiet"], workingDir, PUSH_TIMEOUT_MS);
  const pushed = push.code === 0;

  return { ...base, state: "committed", hash, pushed };
}

export async function runOnce(dirs: DirsByAgent): Promise<AutoCommitResult[]> {
  const results: AutoCommitResult[] = [];
  for (const [dir, names] of dirs) {
    try {
      const r = await commitOnce(dir, names);
      results.push(r);
    } catch (e) {
      results.push({
        workingDir: dir,
        agentNames: names,
        state: "error",
        message: (e as Error).message.slice(0, 200),
        ts: Date.now(),
      });
    }
  }
  return results;
}

export async function tickOnce(
  getRunningDirs: () => DirsByAgent,
  onResult?: (r: AutoCommitResult) => void,
): Promise<AutoCommitResult[]> {
  const dirs = getRunningDirs();
  if (dirs.size === 0) return [];
  const results = await runOnce(dirs);
  for (const r of results) onResult?.(r);
  return results;
}

export function startAutoCommit(opts: {
  getRunningDirs: () => DirsByAgent;
  onResult?: (r: AutoCommitResult) => void;
  intervalMs?: number;
}): () => void {
  const tick = () =>
    void tickOnce(opts.getRunningDirs, opts.onResult).catch((e) =>
      console.error("[autocommit] tick error:", e),
    );
  const handle = setInterval(tick, opts.intervalMs ?? INTERVAL_MS);
  return () => clearInterval(handle);
}
