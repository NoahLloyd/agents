import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPrompt,
  detectRateLimit,
  detectRateLimitFromFile,
  isStagnant,
  nextOccurrenceInTz,
} from "../lib/supervisor";
import type { Agent } from "../lib/types";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "agents-supervisor-test-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeTmp(name: string, content: string): string {
  const p = path.join(tmp, name);
  writeFileSync(p, content);
  return p;
}

describe("nextOccurrenceInTz", () => {
  test("returns a future timestamp for a valid (h,m,tz) triple", () => {
    const ts = nextOccurrenceInTz(22, 30, "Europe/Stockholm");
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThan(Date.now());
  });

  test("the resolved timestamp's wall clock in tz matches the requested h:m", () => {
    const ts = nextOccurrenceInTz(14, 7, "America/Los_Angeles")!;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
    expect(parseInt(parts.hour, 10) % 24).toBe(14);
    expect(parseInt(parts.minute, 10)).toBe(7);
  });

  test("returns within next 24h+ window (target is upcoming, not past)", () => {
    const ts = nextOccurrenceInTz(0, 1, "Europe/Stockholm")!;
    const deltaH = (ts - Date.now()) / 3600_000;
    expect(deltaH).toBeGreaterThan(0);
    expect(deltaH).toBeLessThan(25);
  });

  test("returns null for an unknown timezone", () => {
    expect(nextOccurrenceInTz(10, 0, "Mars/Olympus_Mons")).toBeNull();
  });
});

describe("detectRateLimitFromFile", () => {
  test("missing file → null", () => {
    expect(detectRateLimitFromFile(path.join(tmp, "does-not-exist.log"))).toBeNull();
  });

  test("empty file → null", () => {
    const p = writeTmp("empty.log", "");
    expect(detectRateLimitFromFile(p)).toBeNull();
  });

  test("plain unrelated content → null", () => {
    const p = writeTmp("benign.log", "starting up\nall good\n");
    expect(detectRateLimitFromFile(p)).toBeNull();
  });

  test("pattern 1: 'usage limit reached|<unix_seconds>'", () => {
    const future = Math.floor((Date.now() + 60 * 60 * 1000) / 1000);
    const p = writeTmp("p1.log", `Claude AI usage limit reached|${future}\n`);
    const ts = detectRateLimitFromFile(p);
    expect(ts).toBe(future * 1000);
  });

  test("pattern 1: 'usage limit reached|<unix_millis>'", () => {
    const futureMs = Date.now() + 60 * 60 * 1000;
    const p = writeTmp("p1ms.log", `usage limit reached|${futureMs}\n`);
    expect(detectRateLimitFromFile(p)).toBe(futureMs);
  });

  test("pattern 2: ISO timestamp after 'reset'", () => {
    const iso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const p = writeTmp("p2.log", `please try again, resets at ${iso}\n`);
    const ts = detectRateLimitFromFile(p);
    expect(ts).not.toBeNull();
    // ISO regex strips trailing 'Z' if it stops at the comma — accept ±1s
    const expected = Date.parse(iso);
    expect(Math.abs(ts! - expected)).toBeLessThan(2000);
  });

  test("pattern 3: friendly 'You've hit your limit · resets <h>:<mm><am|pm> (<tz>)'", () => {
    const p = writeTmp(
      "p3.log",
      "You've hit your limit · resets 10:30pm (Europe/Stockholm)\n",
    );
    const ts = detectRateLimitFromFile(p)!;
    expect(ts).toBeGreaterThan(Date.now());
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
    expect(parseInt(parts.hour, 10) % 24).toBe(22);
    expect(parseInt(parts.minute, 10)).toBe(30);
  });

  test("pattern 3: also matches 4:40pm (the other format from the live logs)", () => {
    const p = writeTmp(
      "p3b.log",
      "You've hit your limit · resets 4:40pm (Europe/Stockholm)\n",
    );
    const ts = detectRateLimitFromFile(p)!;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Stockholm",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
    expect(parseInt(parts.hour, 10) % 24).toBe(16);
    expect(parseInt(parts.minute, 10)).toBe(40);
  });

  test("pattern 3: 12am edge case → midnight", () => {
    const p = writeTmp("p3-12am.log", "You've hit your limit · resets 12:00am (UTC)\n");
    const ts = detectRateLimitFromFile(p)!;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
    expect(parseInt(parts.hour, 10) % 24).toBe(0);
    expect(parseInt(parts.minute, 10)).toBe(0);
  });

  test("pattern 3: 12pm edge case → noon", () => {
    const p = writeTmp("p3-12pm.log", "You've hit your limit · resets 12:00pm (UTC)\n");
    const ts = detectRateLimitFromFile(p)!;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
    expect(parseInt(parts.hour, 10) % 24).toBe(12);
  });

  test("pattern 4 fallback: matches 'rate limit' without parsable time → ~5 min from now", () => {
    const p = writeTmp("p4.log", "fatal: rate limit exceeded, please retry later\n");
    const ts = detectRateLimitFromFile(p)!;
    const deltaMin = (ts - Date.now()) / 60_000;
    expect(deltaMin).toBeGreaterThan(4);
    expect(deltaMin).toBeLessThan(6);
  });

  test("pattern 4 fallback: also matches 'hit your limit' without tz", () => {
    const p = writeTmp(
      "p4b.log",
      "You've hit your limit, please retry later\n",
    );
    const ts = detectRateLimitFromFile(p)!;
    expect(ts).toBeGreaterThan(Date.now());
  });

  test("only the last 8KB is scanned (huge benign prefix doesn't hide tail match)", () => {
    const padding = "x".repeat(50_000);
    const p = writeTmp(
      "huge.log",
      `${padding}\nYou've hit your limit · resets 10:30pm (Europe/Stockholm)\n`,
    );
    expect(detectRateLimitFromFile(p)).not.toBeNull();
  });
});

describe("detectRateLimit (stderr+stdout)", () => {
  test("falls back to stdout when stderr is empty", () => {
    const stderr = writeTmp("rl-empty.stderr", "");
    const stdout = writeTmp(
      "rl-stdout.log",
      "You've hit your limit · resets 10:30pm (Europe/Stockholm)\n",
    );
    expect(detectRateLimit(stderr, stdout)).not.toBeNull();
  });

  test("prefers stderr when both contain hits", () => {
    const futureSec = Math.floor((Date.now() + 7200_000) / 1000);
    const stderr = writeTmp(
      "rl-pref.stderr",
      `usage limit reached|${futureSec}\n`,
    );
    const stdout = writeTmp(
      "rl-pref.stdout",
      "You've hit your limit · resets 10:30pm (Europe/Stockholm)\n",
    );
    const ts = detectRateLimit(stderr, stdout)!;
    expect(ts).toBe(futureSec * 1000);
  });

  test("returns null when neither file matches", () => {
    const stderr = writeTmp("none.stderr", "all clear\n");
    const stdout = writeTmp("none.stdout", "still working\n");
    expect(detectRateLimit(stderr, stdout)).toBeNull();
  });
});

describe("isStagnant", () => {
  const now = 1_000_000_000_000;
  const minute = 60_000;
  const startedLongAgo = now - 60 * minute;

  test("empty buffer → not stagnant", () => {
    expect(isStagnant([], now, startedLongAgo)).toBeNull();
  });

  test("fewer than 10 calls → not stagnant", () => {
    const buf = Array.from({ length: 5 }, (_, i) => ({
      name: "Bash",
      ts: now - i * minute,
    }));
    expect(isStagnant(buf, now, startedLongAgo)).toBeNull();
  });

  test("10 Bash calls within window, no edits → stagnant (returns count)", () => {
    const buf = Array.from({ length: 10 }, (_, i) => ({
      name: "Bash",
      ts: now - i * minute,
    }));
    expect(isStagnant(buf, now, startedLongAgo)).toBe(10);
  });

  test("10 calls but one is an Edit → not stagnant", () => {
    const buf: { name: string; ts: number }[] = Array.from({ length: 9 }, (_, i) => ({
      name: "Bash",
      ts: now - i * minute,
    }));
    buf.push({ name: "Edit", ts: now - 2 * minute });
    expect(isStagnant(buf, now, startedLongAgo)).toBeNull();
  });

  test("any of the progress tools (Write/MultiEdit/NotebookEdit) blocks stagnation", () => {
    for (const tool of ["Write", "MultiEdit", "NotebookEdit"]) {
      const buf: { name: string; ts: number }[] = Array.from(
        { length: 9 },
        (_, i) => ({ name: "Bash", ts: now - i * minute }),
      );
      buf.push({ name: tool, ts: now - minute });
      expect(isStagnant(buf, now, startedLongAgo)).toBeNull();
    }
  });

  test("calls outside the 15-min window are ignored", () => {
    // 20 Bash calls but all >20 min old
    const buf = Array.from({ length: 20 }, (_, i) => ({
      name: "Bash",
      ts: now - (20 + i) * minute,
    }));
    expect(isStagnant(buf, now, startedLongAgo)).toBeNull();
  });

  test("process younger than the window is skipped (avoids killing fresh agents)", () => {
    const youngStart = now - 5 * minute;
    const buf = Array.from({ length: 20 }, (_, i) => ({
      name: "Bash",
      ts: now - i * 10_000,
    }));
    expect(isStagnant(buf, now, youngStart)).toBeNull();
  });

  test("startedAt=null is allowed and uses only the window check", () => {
    const buf = Array.from({ length: 12 }, (_, i) => ({
      name: "Bash",
      ts: now - i * minute,
    }));
    expect(isStagnant(buf, now, null)).toBe(12);
  });

  test("non-progress tools other than Bash also count toward stagnation", () => {
    // Read-only loops (Glob/Grep/Read/etc.) without edits should also trip it.
    const buf = Array.from({ length: 12 }, (_, i) => ({
      name: i % 2 === 0 ? "Bash" : "Read",
      ts: now - i * minute,
    }));
    expect(isStagnant(buf, now, startedLongAgo)).toBe(12);
  });
});

describe("buildPrompt", () => {
  const inlineAgent: Agent = {
    id: "x",
    name: "x",
    workingDir: tmpdir(),
    direction: { kind: "inline", prompt: "Do the thing." },
    model: "claude-opus-4-7",
    fallbackModel: "claude-opus-4-6",
    effort: "max",
    enabled: true,
    keepAlive: true,
    createdAt: 0,
  };

  test("inline direction includes prompt + never-exit coda", () => {
    const out = buildPrompt(inlineAgent);
    expect(out).toContain("Do the thing.");
    expect(out).toContain("Begin. This session must never end voluntarily.");
  });

  test("inline + extraContext appends after coda", () => {
    const out = buildPrompt(inlineAgent, "EXTRA-CONTEXT-MARKER");
    expect(out.indexOf("Begin. This session must never end")).toBeGreaterThan(-1);
    expect(out.indexOf("EXTRA-CONTEXT-MARKER")).toBeGreaterThan(
      out.indexOf("Begin. This session must never end"),
    );
  });

  test("undefined / null / empty extraContext does not add a stray separator", () => {
    const a = buildPrompt(inlineAgent);
    const b = buildPrompt(inlineAgent, null);
    const c = buildPrompt(inlineAgent, undefined);
    const d = buildPrompt(inlineAgent, "");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).toBe(a);
  });

  test("file direction with missing path yields the placeholder + coda", () => {
    const agent: Agent = {
      ...inlineAgent,
      direction: { kind: "file", filePath: path.join(tmp, "no-such-steering.md") },
    };
    const out = buildPrompt(agent, "NUDGE");
    expect(out).toContain("does not exist yet");
    expect(out).toContain("Begin. This session must never end");
    expect(out).toContain("NUDGE");
  });

  test("file direction reads file contents and embeds them between fences", () => {
    const fp = writeTmp("steering.md", "MY-STEERING-BODY");
    const agent: Agent = {
      ...inlineAgent,
      direction: { kind: "file", filePath: fp },
    };
    const out = buildPrompt(agent, "NUDGE");
    expect(out).toContain("Your steering file is");
    expect(out).toContain("MY-STEERING-BODY");
    expect(out).toContain("NUDGE");
    // Coda comes before the appended nudge
    expect(out.indexOf("Begin. This session must never end")).toBeGreaterThan(
      out.indexOf("MY-STEERING-BODY"),
    );
    expect(out.indexOf("NUDGE")).toBeGreaterThan(
      out.indexOf("Begin. This session must never end"),
    );
  });
});
