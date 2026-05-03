import path from "node:path";

const HOME = process.env.HOME ?? "/root";

export const ALLOWED_ROOTS: string[] = [
  HOME,
  ...(process.env.AGENTS_EXTRA_ROOTS ?? "/srv/agents")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean),
];

export function isPathAllowed(p: string): boolean {
  const abs = path.resolve(p);
  return ALLOWED_ROOTS.some((root) => abs === root || abs.startsWith(root + "/"));
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return HOME + p.slice(1);
  if (p === "~") return HOME;
  return p;
}
