#!/usr/bin/env bun
// Dev launcher: pick the lowest free port pair starting at 4000/4001 and
// spawn `next dev` + `ws-server.ts` against it. Lets a second instance
// run without colliding with the first.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

async function findPair(base: number): Promise<[number, number]> {
  for (let p = base; p < base + 100; p += 2) {
    if ((await portFree(p)) && (await portFree(p + 1))) return [p, p + 1];
  }
  throw new Error(`no free port pair found starting at ${base}`);
}

const [nextPort, wsPort] = await findPair(4000);
if (nextPort !== 4000) {
  console.log(`[dev] 4000/4001 busy, using ${nextPort}/${wsPort}`);
}

const env = {
  ...process.env,
  WS_PORT: String(wsPort),
  WS_HTTP: `http://localhost:${wsPort}`,
  NEXT_PUBLIC_WS_PORT: String(wsPort),
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
    `next dev -p ${nextPort}`,
    "bun --watch ws-server.ts",
  ],
  { stdio: "inherit", env },
);

const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));

child.on("exit", (code) => process.exit(code ?? 0));
