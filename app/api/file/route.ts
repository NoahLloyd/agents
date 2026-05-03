import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { isPathAllowed } from "@/lib/paths";

export const dynamic = "force-dynamic";

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".mdx"]);

function safe(p: string): string | null {
  if (!p) return null;
  const abs = path.resolve(p);
  return isPathAllowed(abs) ? abs : null;
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
  } catch (e: unknown) {
    // If the file doesn't exist but has a text extension, treat it as a new empty file.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && TEXT_EXTS.has(path.extname(abs).toLowerCase())) {
      return NextResponse.json({ content: "", path: abs, mtimeMs: null, new: true });
    }
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
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return NextResponse.json({ ok: true });
}
