import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isPathAllowed } from "@/lib/paths";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response("path required", { status: 400 });
  const abs = path.resolve(p);
  if (!isPathAllowed(abs)) return new Response("forbidden", { status: 403 });
  try {
    const s = await stat(abs);
    if (!s.isFile()) return new Response("not a file", { status: 400 });
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    const buf = await readFile(abs);
    return new Response(buf, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
