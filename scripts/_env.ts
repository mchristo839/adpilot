import { readFileSync } from "node:fs";
import path from "node:path";

/** Tiny .env loader so scripts run without extra deps. Does not override existing env. */
export function loadEnv(file = path.resolve(process.cwd(), ".env")): void {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, raw] = m;
      const v = raw!.replace(/^["']|["']$/g, "");
      if (process.env[k!] === undefined) process.env[k!] = v;
    }
  } catch {
    /* no .env */
  }
}
