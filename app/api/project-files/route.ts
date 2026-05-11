import { NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPathAllowed } from "@/lib/paths";

export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".next", "__pycache__", ".venv", "venv",
  "dist", "build", ".turbo", ".cache", "coverage",
]);

type FileEntry = { path: string; name: string; isDir: boolean; depth: number };

function listFiles(dir: string, depth: number, maxDepth: number): FileEntry[] {
  if (depth > maxDepth) return [];
  const results: FileEntry[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        results.push({ path: full, name: e.name, isDir: true, depth });
        results.push(...listFiles(full, depth + 1, maxDepth));
      } else if (e.isFile()) {
        results.push({ path: full, name: e.name, isDir: false, depth });
      }
    }
  } catch {}
  return results;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir");
  if (!dir) return NextResponse.json({ error: "dir required" }, { status: 400 });

  const abs = path.resolve(dir);
  if (!isPathAllowed(abs)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const s = statSync(abs);
    if (!s.isDirectory()) return NextResponse.json({ entries: [] });
  } catch {
    return NextResponse.json({ entries: [] });
  }

  const entries = listFiles(abs, 0, 3);
  return NextResponse.json({ entries });
}
