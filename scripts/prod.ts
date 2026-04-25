#!/usr/bin/env bun
// Production launcher: runs the compiled Next.js server and the
// ws-server side-by-side on fixed ports 4000/4001. Used by the launchd
// agent (~/Library/LaunchAgents/com.noah.agents.plist) so the dashboard
// is available at http://localhost:4000 continuously.
//
// Run `bun run build` first, otherwise `next start` has nothing to serve.
import { spawn } from "node:child_process";

const NEXT_PORT = 4000;
const WS_PORT = 4001;

const env = {
  ...process.env,
  WS_PORT: String(WS_PORT),
  WS_HTTP: `http://localhost:${WS_PORT}`,
  NEXT_PUBLIC_WS_PORT: String(WS_PORT),
  NODE_ENV: "production" as const,
};

const child = spawn(
  "bunx",
  [
    "concurrently",
    "-k",
    "-n",
    "web,ws",
    "-c",
    "blue,magenta",
    `next start -p ${NEXT_PORT}`,
    "bun ws-server.ts",
  ],
  { stdio: "inherit", env },
);

child.on("exit", (code) => process.exit(code ?? 0));
