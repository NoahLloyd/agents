#!/usr/bin/env bun
// Production web-only launcher: runs the compiled Next.js server on port 4000.
// The WebSocket server runs separately under agents-ws.service.
import { spawn } from "node:child_process";

const child = spawn(
  "bunx",
  ["next", "start", "-p", "4000"],
  {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
