import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getVaultDir } from "@/lib/vault";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/Users/noah";
const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", "logs", "state"]);
const EXTS = new Set([".md", ".txt", ".markdown"]);

async function walk(root: string, max: number): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith(".DS_Store")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await rec(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (EXTS.has(ext)) out.push(full);
      }
    }
  }
  await rec(root);
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
  const rootParam = url.searchParams.get("root");
  let root = getVaultDir();
  if (rootParam) {
    const abs = path.resolve(rootParam);
    if (abs.startsWith(HOME + "/") || abs === HOME) root = abs;
  }
  try {
    await stat(root);
  } catch {
    return NextResponse.json({ files: [], root });
  }
  const all = await walk(root, 5000);
  const filtered = q
    ? all.filter((p) => p.toLowerCase().includes(q))
    : all;
  // Rank: prefer matches in the basename, then by shorter path.
  filtered.sort((a, b) => {
    if (q) {
      const aBase = path.basename(a).toLowerCase().includes(q) ? 0 : 1;
      const bBase = path.basename(b).toLowerCase().includes(q) ? 0 : 1;
      if (aBase !== bBase) return aBase - bBase;
    }
    return a.length - b.length;
  });
  const files = filtered.slice(0, 30).map((absPath) => ({
    absPath,
    relPath: path.relative(root, absPath),
    name: path.basename(absPath),
  }));
  return NextResponse.json({ files, root });
}
