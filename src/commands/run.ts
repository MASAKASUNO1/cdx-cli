import { resolve } from "node:path";
import type { RunOptions, RunResult } from "../types.js";
import { runSession } from "../core/session.js";
import { appendTrace, resolveTraceFilePath } from "../core/trace-writer.js";

const REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
] as const);

/** CLI 引数をパースして RunOptions を生成 */
export function parseRunArgs(args: string[]): RunOptions {
  let workdir: string | undefined;
  let threadId: string | undefined;
  let instructions: string | undefined;
  let traceFile: string | undefined;
  let agentId: string | undefined;
  let agentType: string | undefined;
  let model: string | undefined;
  let reasoningEffort: RunOptions["reasoningEffort"];
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--workdir":
      case "-w":
        workdir = args[++i];
        break;
      case "--thread-id":
      case "--session-id":
        threadId = args[++i];
        break;
      case "--instructions":
      case "-i":
        instructions = args[++i];
        break;
      case "--trace-file":
        traceFile = args[++i];
        break;
      case "--agent-id":
        agentId = args[++i];
        break;
      case "--agent-type":
        agentType = args[++i];
        break;
      case "--model":
      case "-m":
        model = args[++i];
        break;
      case "--thinking":
      case "--reasoning-effort": {
        const next = args[++i];
        if (!next || !REASONING_EFFORTS.has(next as never)) {
          process.stderr.write(
            "Error: --thinking must be one of low|medium|high|xhigh\n",
          );
          process.exit(1);
        }
        reasoningEffort = next as RunOptions["reasoningEffort"];
        break;
      }
      default:
        if (!arg.startsWith("-")) {
          positional.push(arg);
        }
        break;
    }
  }

  if (!workdir) {
    process.stderr.write("Error: --workdir (-w) is required\n");
    process.exit(1);
  }

  const prompt = positional.join(" ");
  if (!prompt) {
    process.stderr.write("Error: prompt is required\n");
    process.exit(1);
  }

  return {
    workdir: resolve(workdir),
    threadId,
    instructions: instructions ? resolve(instructions) : undefined,
    traceFile: traceFile ? resolve(traceFile) : undefined,
    agentId,
    agentType,
    model,
    reasoningEffort,
    prompt,
  };
}

/** run コマンドを実行 */
export async function executeRun(args: string[]): Promise<void> {
  const options = parseRunArgs(args);
  const startTime = Date.now();

  try {
    const result = await runSession(options);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.status === "completed" ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[cdx] fatal: ${message}\n`);

    // crash でもトレース + JSON 出力
    const durationMs = Date.now() - startTime;
    const crashResult: RunResult = {
      session_id: "unknown",
      status: "failed",
      files_changed: [],
      final_response: "",
      error: message,
      duration_ms: durationMs,
    };
    process.stdout.write(JSON.stringify(crashResult, null, 2) + "\n");

    try {
      const traceFilePath = options.traceFile ?? await resolveTraceFilePath(options.workdir);
      await appendTrace(traceFilePath, {
        coding_agent: "codex",
        session_id: "unknown",
        agent_id: options.agentId ?? "",
        agent_type: options.agentType ?? "",
        status: "failed",
        files_changed: [],
        error: message,
        timestamp: new Date().toISOString(),
        duration_ms: durationMs,
        transcript: "",
      });
    } catch {
      // トレース書き込み自体が失敗しても exit する
    }

    process.exit(2);
  }
}
