import { NextResponse } from "next/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/Users/noah";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const prefix = url.searchParams.get("q") ?? "";

  // Resolve the directory to list and the partial basename being typed.
  let dir: string;
  let partial: string;

  const expanded = prefix.startsWith("~") ? HOME + prefix.slice(1) : prefix;
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

  // Safety: only allow browsing under HOME.
  const safeDir = path.resolve(dir);
  if (!safeDir.startsWith(HOME)) {
    return NextResponse.json({ dirs: [] });
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
