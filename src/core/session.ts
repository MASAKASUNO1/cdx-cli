import { Codex } from "@openai/codex-sdk";
import type { ThreadOptions } from "@openai/codex-sdk";
import type { RunOptions, RunResult, TraceEntry, FileChange } from "../types.js";
import { createAccumulator, handleEvent } from "./event-handler.js";
import { appendTrace, resolveTraceFilePath } from "./trace-writer.js";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";

/** Codex セッションを実行し、結果を返す */
export async function runSession(options: RunOptions): Promise<RunResult> {
  const startTime = Date.now();

  const codex = new Codex();

  const threadOptions: ThreadOptions = {
    workingDirectory: options.workdir,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort ? { modelReasoningEffort: options.reasoningEffort } : {}),
  };

  const thread = options.threadId
    ? codex.resumeThread(options.threadId, threadOptions)
    : codex.startThread(threadOptions);

  // プロンプト構築: instructions + タスク
  let prompt = options.prompt;
  if (options.instructions) {
    const instructionsContent = await readFile(options.instructions, "utf-8");
    prompt = `${instructionsContent}\n\n---\n\n${prompt}`;
  }

  const acc = createAccumulator();
  if (options.threadId) {
    acc.sessionId = options.threadId;
  }
  const streamed = await thread.runStreamed(prompt);

  for await (const event of streamed.events) {
    handleEvent(acc, event);
  }

  const durationMs = Date.now() - startTime;

  // トレース書き込み先（このファイル自体は files_changed から除外したい）
  const traceFilePath = options.traceFile ?? await resolveTraceFilePath(options.workdir);
  const transcriptPath = await resolveTranscriptPath(acc.sessionId);
  const excludedPaths = new Set<string>();
  const traceRelativePath = resolvePathRelativeToGitRoot(options.workdir, traceFilePath);
  if (traceRelativePath) excludedPaths.add(traceRelativePath);

  // git で実際の変更を検出（FileChangeItem だけでは shell 経由の変更を拾えない）
  const gitChanges = detectGitChanges(options.workdir, excludedPaths);
  const filesChanged = mergeFileChanges(acc.filesChanged, gitChanges).filter(
    (c) => !excludedPaths.has(c.path),
  );

  const result: RunResult = {
    session_id: acc.sessionId ?? "unknown",
    status: acc.status,
    files_changed: filesChanged,
    final_response: acc.finalResponse,
    ...(acc.error ? { error: acc.error } : {}),
    duration_ms: durationMs,
  };

  const traceEntry: TraceEntry = {
    coding_agent: "codex",
    session_id: acc.sessionId ?? "unknown",
    agent_id: options.agentId ?? "",
    agent_type: options.agentType ?? "",
    status: acc.status,
    files_changed: filesChanged,
    ...(acc.error ? { error: acc.error } : {}),
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    transcript: transcriptPath,
  };

  await appendTrace(traceFilePath, traceEntry);

  return result;
}

/** git status + diff で実際のファイル変更を検出 */
function detectGitChanges(workdir: string, excludedPaths: Set<string>): FileChange[] {
  try {
    // --porcelain=v1: M/A/D/?? をパース
    const output = execSync("git status --porcelain", {
      cwd: workdir,
      encoding: "utf-8",
    }).trim();
    if (!output) return [];
    return output.split("\n").map((line) => {
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3);
      if (excludedPaths.has(filePath)) return null;
      let kind: FileChange["kind"];
      switch (status) {
        case "D":
          kind = "delete";
          break;
        case "??":
        case "A":
          kind = "add";
          break;
        default:
          kind = "update";
          break;
      }
      return { path: filePath, kind };
    }).filter((c): c is FileChange => c !== null);
  } catch {
    return [];
  }
}

/** SDK の FileChangeItem と git 検出結果をマージ（重複排除） */
function mergeFileChanges(sdkChanges: FileChange[], gitChanges: FileChange[]): FileChange[] {
  const seen = new Set(sdkChanges.map((c) => c.path));
  const merged = [...sdkChanges];
  for (const gc of gitChanges) {
    if (!seen.has(gc.path)) {
      merged.push(gc);
      seen.add(gc.path);
    }
  }
  return merged;
}

function resolveGitToplevel(workdir: string): string | null {
  try {
    const toplevel = execSync("git rev-parse --show-toplevel", {
      cwd: workdir,
      encoding: "utf-8",
    }).trim();
    return toplevel || null;
  } catch {
    return null;
  }
}

function resolvePathRelativeToGitRoot(workdir: string, absolutePath: string): string | null {
  const toplevel = resolveGitToplevel(workdir);
  if (!toplevel) return null;

  const rel = relative(toplevel, absolutePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.replaceAll("\\", "/");
}

/** Codex セッションの transcript パスを推定（可能なら該当jsonlを探す） */
async function resolveTranscriptPath(sessionId: string | null): Promise<string> {
  if (!sessionId) return "";
  const home = process.env["HOME"] ?? "";
  const root = `${home}/.codex/sessions`;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dir = `${root}/${y}/${m}/${d}`;

  const matchToday = await findTranscriptInDirectory(dir, sessionId);
  if (matchToday) return matchToday;

  const match = await findTranscriptRecursive(root, sessionId, 4);
  if (match) return match;

  return root;
}

async function findTranscriptInDirectory(dir: string, sessionId: string): Promise<string | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const match = entries.find(
      (e) => e.isFile() && e.name.endsWith(".jsonl") && e.name.includes(sessionId),
    );
    if (!match) return null;
    return `${dir}/${match.name}`;
  } catch {
    return null;
  }
}

async function findTranscriptRecursive(
  root: string,
  sessionId: string,
  maxDepth: number,
): Promise<string | null> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl") && e.name.includes(sessionId)) {
        return `${current.dir}/${e.name}`;
      }
      if (e.isDirectory() && current.depth < maxDepth) {
        stack.push({ dir: `${current.dir}/${e.name}`, depth: current.depth + 1 });
      }
    }
  }

  return null;
}
