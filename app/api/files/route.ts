import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
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
  const cwd = safeWorkingDir(url.searchParams.get("workingDir"));
  let log = "";
  try {
    log = await runGit(
      ["log", "--name-status", "--format=%H%x09%cI%x09%s", "-15"],
      cwd,
    );
  } catch {
    return NextResponse.json({ commits: [], pending: [], notARepo: true });
  }
  const commits: {
    hash: string;
    isoDate: string;
    subject: string;
    files: { status: string; path: string }[];
  }[] = [];
  let current: (typeof commits)[number] | null = null;
  for (const raw of log.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length === 3 && /^[0-9a-f]{7,40}$/.test(parts[0])) {
      current = {
        hash: parts[0],
        isoDate: parts[1],
        subject: parts[2],
        files: [],
      };
      commits.push(current);
    } else if (current) {
      current.files.push({ status: parts[0], path: parts.slice(1).join("\t") });
    }
  }

  let pending: { status: string; path: string }[] = [];
  try {
    const out = await runGit(["status", "--porcelain"], cwd);
    pending = out
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3).trim() }));
  } catch {}

  return NextResponse.json({ commits, pending });
}
