import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./registry";

export type AppConfig = {
  vaultDir: string;
};

const DEFAULTS: AppConfig = {
  vaultDir: path.join(process.env.HOME ?? "/root", "AI-safety"),
};

function configPath(): string {
  return path.join(dataDir(), "config.json");
}

let cache: AppConfig | null = null;

function load(): AppConfig {
  if (cache) return cache;
  const file = configPath();
  if (!existsSync(file)) {
    cache = { ...DEFAULTS };
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AppConfig>;
    cache = {
      ...DEFAULTS,
      ...raw,
    };
    return cache;
  } catch {
    cache = { ...DEFAULTS };
    return cache;
  }
}

export function getConfig(): AppConfig {
  return load();
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const cur = load();
  const next: AppConfig = { ...cur, ...patch };
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(next, null, 2));
  cache = next;
  return next;
}

export function getVaultDir(): string {
  return load().vaultDir;
}
