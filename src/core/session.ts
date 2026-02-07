import { Codex } from "@openai/codex-sdk";
import type { RunOptions, RunResult, TraceEntry, FileChange } from "../types.js";
import { createAccumulator, handleEvent } from "./event-handler.js";
import { appendTrace, resolveTraceFilePath } from "./trace-writer.js";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { execSync } from "node:child_process";

/** Codex セッションを実行し、結果を返す */
export async function runSession(options: RunOptions): Promise<RunResult> {
  const startTime = Date.now();

  const codex = new Codex();

  const thread = codex.startThread({
    workingDirectory: options.workdir,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    ...(options.model ? { model: options.model } : {}),
    ...(options.reasoningEffort ? { modelReasoningEffort: options.reasoningEffort } : {}),
  });

  // プロンプト構築: instructions + タスク
  let prompt = options.prompt;
  if (options.instructions) {
    const instructionsContent = await readFile(options.instructions, "utf-8");
    prompt = `${instructionsContent}\n\n---\n\n${prompt}`;
  }

  const acc = createAccumulator();
  const streamed = await thread.runStreamed(prompt);

  for await (const event of streamed.events) {
    handleEvent(acc, event);
  }

  const durationMs = Date.now() - startTime;

  // git で実際の変更を検出（FileChangeItem だけでは shell 経由の変更を拾えない）
  const gitChanges = detectGitChanges(options.workdir);
  const filesChanged = mergeFileChanges(acc.filesChanged, gitChanges);

  const result: RunResult = {
    session_id: acc.sessionId ?? "unknown",
    status: acc.status,
    files_changed: filesChanged,
    final_response: acc.finalResponse,
    duration_ms: durationMs,
  };

  // トレース書き込み
  const traceFilePath = options.traceFile ?? await resolveTraceFilePath(options.workdir);
  const transcriptPath = await resolveTranscriptPath(acc.sessionId);

  const traceEntry: TraceEntry = {
    coding_agent: "codex",
    session_id: acc.sessionId ?? "unknown",
    agent_id: options.agentId ?? "",
    agent_type: options.agentType ?? "",
    status: acc.status,
    files_changed: filesChanged,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    transcript: transcriptPath,
  };

  await appendTrace(traceFilePath, traceEntry);

  return result;
}

/** git status + diff で実際のファイル変更を検出 */
function detectGitChanges(workdir: string): FileChange[] {
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
    });
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

/** Codex セッションの transcript パスを推定（可能なら該当jsonlを探す） */
async function resolveTranscriptPath(sessionId: string | null): Promise<string> {
  if (!sessionId) return "";
  const home = process.env["HOME"] ?? "";
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dir = `${home}/.codex/sessions/${y}/${m}/${d}`;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const match = entries.find(
      (e) => e.isFile() && e.name.endsWith(".jsonl") && e.name.includes(sessionId),
    );
    if (match) return `${dir}/${match.name}`;
  } catch {
    // ignore and fall back below
  }

  return dir;
}
