import type {
  ThreadEvent,
  ThreadItem,
  FileChangeItem,
  CommandExecutionItem,
  AgentMessageItem,
  ModelReasoningEffort,
  Usage,
} from "@openai/codex-sdk";

/** CLI run コマンドのオプション */
export interface RunOptions {
  workdir: string;
  threadId?: string;
  instructions?: string;
  traceFile?: string;
  agentId?: string;
  agentType?: string;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
  prompt: string;
}

/** ファイル変更記録 */
export interface FileChange {
  path: string;
  kind: "add" | "delete" | "update";
}

/** run コマンドの実行結果（stdout JSON） */
export interface RunResult {
  session_id: string;
  status: "completed" | "failed";
  files_changed: FileChange[];
  final_response: string;
  error?: string;
  duration_ms: number;
}

/** .agent-trace.json 内の個別トレースエントリ */
export interface TraceEntry {
  coding_agent: string;
  session_id: string;
  agent_id: string;
  agent_type: string;
  status: "completed" | "failed";
  files_changed: FileChange[];
  error?: string;
  timestamp: string;
  duration_ms: number;
  transcript: string;
}

/** .agent-trace.json のルート構造 */
export interface TraceFile {
  version: string;
  traces: TraceEntry[];
}

/** イベントハンドラが蓄積する状態 */
export interface EventAccumulator {
  sessionId: string | null;
  filesChanged: FileChange[];
  finalResponse: string;
  status: "completed" | "failed";
  error?: string;
  usage: Usage | null;
}

// SDK型の再エクスポート
export type {
  ThreadEvent,
  ThreadItem,
  FileChangeItem,
  CommandExecutionItem,
  AgentMessageItem,
  Usage,
};
