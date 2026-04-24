import { NextResponse } from "next/server";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/Users/noah";

function safe(p: string): string | null {
  if (!p) return null;
  const abs = path.resolve(p);
  if (!abs.startsWith(HOME + "/") && abs !== HOME) return null;
  return abs;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return NextResponse.json({ error: "path required" }, { status: 400 });
  const abs = safe(p);
  if (!abs) return NextResponse.json({ error: "forbidden path" }, { status: 403 });
  try {
    const s = await stat(abs);
    if (!s.isFile()) return NextResponse.json({ error: "not a file" }, { status: 400 });
    const content = await readFile(abs, "utf8");
    return NextResponse.json({ content, path: abs, mtimeMs: s.mtimeMs });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function PUT(req: Request) {
  const { path: p, content } = (await req.json()) as { path?: string; content?: string };
  if (!p || typeof content !== "string") {
    return NextResponse.json({ error: "path and content required" }, { status: 400 });
  }
  const abs = safe(p);
  if (!abs) return NextResponse.json({ error: "forbidden path" }, { status: 403 });
  await writeFile(abs, content, "utf8");
  return NextResponse.json({ ok: true });
}
