import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { TraceFile, TraceEntry } from "../types.js";

const TRACE_VERSION = "0.1.0";

/** .agent-trace.json を読み込む。存在しなければ空構造を返す */
async function readTraceFile(path: string): Promise<TraceFile> {
  if (!existsSync(path)) {
    return { version: TRACE_VERSION, traces: [] };
  }
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as TraceFile;
}

/** .agent-trace.json にトレースエントリを追記する */
export async function appendTrace(
  traceFilePath: string,
  entry: TraceEntry,
): Promise<void> {
  const traceFile = await readTraceFile(traceFilePath);
  traceFile.traces.push(entry);
  await writeFile(traceFilePath, JSON.stringify(traceFile, null, 2) + "\n");
}

/** git common-dir からトレースファイルパスを算出 */
export async function resolveTraceFilePath(
  workdir: string,
): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const superproject = execSync("git rev-parse --show-superproject-working-tree", {
      cwd: workdir,
      encoding: "utf-8",
    }).trim();
    const toplevel = superproject || execSync("git rev-parse --show-toplevel", {
      cwd: workdir,
      encoding: "utf-8",
    }).trim();
    return `${toplevel}/.agent-trace.json`;
  } catch {
    return `${workdir}/.agent-trace.json`;
  }
}
