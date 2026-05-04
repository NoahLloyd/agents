import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Project } from "./types";

const DATA_DIR = path.join(process.env.HOME ?? "/Users/noah", "agents", "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

export function loadProjects(): Project[] {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROJECTS_FILE)) return [];
  const raw = readFileSync(PROJECTS_FILE, "utf8").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
