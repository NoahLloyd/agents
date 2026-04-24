import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getVaultDir } from "@/lib/vault";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/Users/noah";

function safeWorkingDir(p: string | null): string {
  const vault = getVaultDir();
  if (!p) return vault;
  const abs = path.resolve(p);
  if (!abs.startsWith(HOME + "/") && abs !== HOME) return vault;
  return abs;
}

function runGit(
  args: string[],
  cwd: string,
): Promise<{ out: string; code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      resolve({ out, err, code: code ?? 1 });
    });
  });
}

async function tryReadFile(cwd: string, relPath: string): Promise<string | null> {
  try {
    return await readFile(path.resolve(cwd, relPath), "utf8");
  } catch {
    return null;
  }
}

/** A diff where every line is an add (or every line a delete) is really
 *  just the whole file with decorative +/- prefixes. Show the raw content
 *  instead — it's much cleaner. Returns null if the diff has mixed changes.
 */
function unwrapAllAddedOrDeleted(diff: string): {
  mode: "added" | "deleted";
  content: string;
} | null {
  const lines = diff.split("\n");
  let mode: "added" | "deleted" | null = null;
  const content: string[] = [];
  let sawHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      sawHunk = true;
      continue;
    }
    if (!sawHunk) continue; // skip git header block before first @@
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      if (mode === "deleted") return null;
      mode = "added";
      content.push(line.slice(1));
    } else if (line.startsWith("-")) {
      if (mode === "added") return null;
      mode = "deleted";
      content.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      return null; // has context lines, there's mixed content
    }
  }
  if (!mode || content.length === 0) return null;
  return { mode, content: content.join("\n") };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hash = url.searchParams.get("hash");
  const file = url.searchParams.get("file");
  const cwd = safeWorkingDir(url.searchParams.get("workingDir"));
  if (!hash) {
    return NextResponse.json({ error: "hash required" }, { status: 400 });
  }

  // Full-commit or full-working-tree view (no file scoped) — always a diff.
  if (!file) {
    const args =
      hash === "WORKING" ? ["diff", "HEAD"] : ["show", "--format=", hash];
    const r = await runGit(args, cwd);
    if (r.out.trim()) {
      return NextResponse.json({ mode: "diff", body: r.out });
    }
    return NextResponse.json({
      mode: "content",
      body: "",
      note: "no changes",
    });
  }

  // File-scoped view. Prefer a real diff; when it'd just be the whole file
  // as +/- lines (new/deleted file), prefer the raw content instead.
  if (hash === "WORKING") {
    const d = await runGit(["diff", "HEAD", "--", file], cwd);
    if (d.out.trim()) {
      const simple = unwrapAllAddedOrDeleted(d.out);
      if (simple?.mode === "added") {
        return NextResponse.json({ mode: "content", body: simple.content });
      }
      if (simple?.mode === "deleted") {
        return NextResponse.json({
          mode: "content",
          body: simple.content,
          note: "deleted",
        });
      }
      return NextResponse.json({ mode: "diff", body: d.out });
    }
    const content = await tryReadFile(cwd, file);
    return NextResponse.json({ mode: "content", body: content ?? "" });
  }

  // Historical commit, file-scoped.
  const show = await runGit(["show", "--format=", hash, "--", file], cwd);
  if (show.out.trim()) {
    const simple = unwrapAllAddedOrDeleted(show.out);
    if (simple?.mode === "added") {
      return NextResponse.json({ mode: "content", body: simple.content });
    }
    if (simple?.mode === "deleted") {
      return NextResponse.json({
        mode: "content",
        body: simple.content,
        note: "deleted in this commit",
      });
    }
    return NextResponse.json({ mode: "diff", body: show.out });
  }
  const blob = await runGit(["show", `${hash}:${file}`], cwd);
  return NextResponse.json({
    mode: "content",
    body: blob.code === 0 ? blob.out : "",
    note: blob.code === 0 ? undefined : "file not found at this commit",
  });
}
