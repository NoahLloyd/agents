import { NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPathAllowed, expandHome } from "@/lib/paths";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/root";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const prefix = url.searchParams.get("q") ?? "";

  let dir: string;
  let partial: string;

  const expanded = expandHome(prefix);
  const abs = path.isAbsolute(expanded) ? expanded : path.join(HOME, expanded);

  try {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      dir = abs;
      partial = "";
    } else {
      dir = path.dirname(abs);
      partial = path.basename(abs);
    }
  } catch {
    dir = path.dirname(abs);
    partial = path.basename(abs);
  }

  const safeDir = path.resolve(dir);
  if (!isPathAllowed(safeDir)) {
    return NextResponse.json({ entries: [] });
  }

  type Entry = { path: string; isDir: boolean };
  let entries: Entry[] = [];
  try {
    entries = readdirSync(safeDir, { withFileTypes: true })
      .filter(
        (e) =>
          (e.isDirectory() || e.isFile()) &&
          !e.name.startsWith(".") &&
          e.name.toLowerCase().startsWith(partial.toLowerCase()),
      )
      .map((e) => ({ path: path.join(safeDir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.path.localeCompare(b.path);
      })
      .slice(0, 16);
  } catch {
    return NextResponse.json({ entries: [] });
  }

  return NextResponse.json({ entries });
}
