import { readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const VAULT = "/Users/noah/AI-safety";
export const PID_FILE = path.join(VAULT, "state/claude.pid");
export const HEARTBEAT_LOG = path.join(VAULT, "logs/heartbeat.log");
export const NOTES_FILE = path.join(VAULT, "Noah's notes.md");
export const LINKS_FILE = path.join(VAULT, "Noah's links.md");
export const SESSIONS_DIR =
  "/Users/noah/.claude/projects/-Users-noah-AI-safety";

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function latestSessionFile(): Promise<string | null> {
  if (!existsSync(SESSIONS_DIR)) return null;
  const entries = await readdir(SESSIONS_DIR);
  const jsonls = entries.filter((e) => e.endsWith(".jsonl"));
  if (jsonls.length === 0) return null;
  const stats = await Promise.all(
    jsonls.map(async (f) => {
      const full = path.join(SESSIONS_DIR, f);
      const s = await stat(full);
      return { full, mtime: s.mtimeMs };
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats[0].full;
}

export function tailHeartbeat(lines = 10): string[] {
  if (!existsSync(HEARTBEAT_LOG)) return [];
  const all = readFileSync(HEARTBEAT_LOG, "utf8").trim().split("\n");
  return all.slice(-lines);
}

export function processStartTime(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
    }).trim();
    if (!out) return null;
    const ms = new Date(out).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export function modelFromProcess(pid: number): string | null {
  try {
    const cmd = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).trim();
    const m = cmd.match(/--model\s+(\S+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}
