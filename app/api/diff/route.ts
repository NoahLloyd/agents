import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { VAULT } from "@/lib/vault";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/Users/noah";

function safeWorkingDir(p: string | null): string {
  if (!p) return VAULT;
  const abs = path.resolve(p);
  if (!abs.startsWith(HOME + "/") && abs !== HOME) return VAULT;
  return abs;
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `exit ${code}`));
      else resolve(out);
    });
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hash = url.searchParams.get("hash");
  const file = url.searchParams.get("file");
  const cwd = safeWorkingDir(url.searchParams.get("workingDir"));
  if (!hash) {
    return NextResponse.json({ error: "hash required" }, { status: 400 });
  }
  const args =
    hash === "WORKING"
      ? ["diff", "HEAD", ...(file ? ["--", file] : [])]
      : ["show", "--format=", hash, ...(file ? ["--", file] : [])];
  const diff = await runGit(args, cwd);
  return NextResponse.json({ diff });
}
