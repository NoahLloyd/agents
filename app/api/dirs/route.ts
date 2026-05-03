import { NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPathAllowed, expandHome, ALLOWED_ROOTS } from "@/lib/paths";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/root";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const prefix = url.searchParams.get("q") ?? "";

  // Resolve the directory to list and the partial basename being typed.
  let dir: string;
  let partial: string;

  const expanded = expandHome(prefix);
  const abs = path.isAbsolute(expanded) ? expanded : path.join(HOME, expanded);

  // If the prefix ends with "/" or is an exact existing dir, list inside it.
  // Otherwise, list the parent and filter by the last segment.
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

  // Safety: only allow browsing under one of the allowed roots.
  // If the user is typing a parent of an allowed root (e.g. "/srv/"), surface
  // matching root subdirs from that parent instead of returning empty.
  const safeDir = path.resolve(dir);
  if (!isPathAllowed(safeDir)) {
    const matches = ALLOWED_ROOTS
      .filter((root) => path.dirname(root) === safeDir)
      .filter((root) => path.basename(root).toLowerCase().startsWith(partial.toLowerCase()))
      .slice(0, 12);
    return NextResponse.json({ dirs: matches });
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(safeDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name.toLowerCase().startsWith(partial.toLowerCase()))
      .map((e) => path.join(safeDir, e.name))
      .slice(0, 12);
  } catch {
    return NextResponse.json({ dirs: [] });
  }

  return NextResponse.json({ dirs: entries });
}
