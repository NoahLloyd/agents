import { runOnce, type DirsByAgent } from "../lib/git-autocommit";

const dirs: DirsByAgent = new Map([
  ["/Users/noah/AI-safety", ["research"]],
]);

console.log("running auto-commit once against:", [...dirs.keys()]);
const results = await runOnce(dirs);
for (const r of results) {
  console.log(JSON.stringify(r, null, 2));
}
