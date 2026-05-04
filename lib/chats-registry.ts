import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ChatSession } from "./types";

const DATA_DIR = path.join(process.env.HOME ?? "/Users/noah", "agents", "data");
const CHATS_FILE = path.join(DATA_DIR, "chats.json");

export function loadChats(): ChatSession[] {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(CHATS_FILE)) return [];
  const raw = readFileSync(CHATS_FILE, "utf8").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: ChatSession[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}
