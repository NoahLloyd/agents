import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Agent } from "./types";

const DATA_DIR = path.join(process.env.HOME ?? "/Users/noah", "agents", "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const LOGS_DIR = path.join(DATA_DIR, "logs");

export function dataDir(): string {
  return DATA_DIR;
}

export function logsDir(): string {
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  return LOGS_DIR;
}

export function logPathsFor(agentId: string): { stdout: string; stderr: string } {
  const dir = logsDir();
  return {
    stdout: path.join(dir, `${agentId}.stdout.log`),
    stderr: path.join(dir, `${agentId}.stderr.log`),
  };
}

export function loadAgents(): Agent[] {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(AGENTS_FILE)) return [];
  const raw = readFileSync(AGENTS_FILE, "utf8").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Agent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAgents(agents: Agent[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

export function projectSlug(workingDir: string): string {
  // Claude Code derives ~/.claude/projects/<slug> by replacing / with -.
  return workingDir.replace(/\//g, "-");
}

export function sessionsDirFor(workingDir: string): string {
  return path.join(
    process.env.HOME ?? "/Users/noah",
    ".claude",
    "projects",
    projectSlug(workingDir),
  );
}
