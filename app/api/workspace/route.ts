import { NextResponse } from "next/server";
import { ALLOWED_ROOTS } from "@/lib/paths";

export const dynamic = "force-dynamic";

const HOME = process.env.HOME ?? "/root";

export async function GET() {
  // First non-HOME allowed root is the natural workspace default.
  // Falls back to HOME so fresh installs start somewhere sensible.
  const workspace = ALLOWED_ROOTS.find((r) => r !== HOME) ?? HOME;
  return NextResponse.json({ home: HOME, workspace, roots: ALLOWED_ROOTS });
}
