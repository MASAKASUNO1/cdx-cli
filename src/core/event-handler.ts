import type { ThreadItem } from "@openai/codex-sdk";
import type {
  ThreadEvent,
  EventAccumulator,
  FileChange,
} from "../types.js";

/** 空の蓄積状態を生成 */
export function createAccumulator(): EventAccumulator {
  return {
    sessionId: null,
    filesChanged: [],
    finalResponse: "",
    status: "completed",
    usage: null,
  };
}

/** stderr にログ出力 */
function log(msg: string): void {
  process.stderr.write(`[cdx] ${msg}\n`);
}

/** ThreadEvent を処理し、蓄積状態を更新する */
export function handleEvent(
  acc: EventAccumulator,
  event: ThreadEvent,
): void {
  switch (event.type) {
    case "thread.started":
      acc.sessionId = event.thread_id;
      log(`session: ${event.thread_id}`);
      break;

    case "turn.started":
      log("turn started");
      break;

    case "turn.completed":
      acc.usage = event.usage;
      log(
        `turn completed (tokens: in=${event.usage.input_tokens} out=${event.usage.output_tokens})`,
      );
      break;

    case "turn.failed":
      acc.status = "failed";
      acc.error = event.error.message;
      log(`turn failed: ${event.error.message}`);
      break;

    case "item.completed":
      handleItemCompleted(acc, event.item);
      break;

    case "item.started":
    case "item.updated":
      // stderr に進捗表示のみ
      if (event.item.type === "command_execution" && event.type === "item.started") {
        log(`exec: ${event.item.command}`);
      }
      break;

    case "error":
      acc.status = "failed";
      acc.error = event.message;
      log(`error: ${event.message}`);
      break;
  }
}

function handleItemCompleted(
  acc: EventAccumulator,
  item: ThreadItem,
): void {
  switch (item.type) {
    case "file_change": {
      const changes: FileChange[] = item.changes.map((c) => ({
        path: c.path,
        kind: c.kind,
      }));
      acc.filesChanged.push(...changes);
      for (const c of changes) {
        log(`file ${c.kind}: ${c.path}`);
      }
      break;
    }

    case "command_execution":
      log(
        `exec done: ${item.command} (exit=${item.exit_code ?? "?"})`,
      );
      break;

    case "agent_message":
      acc.finalResponse = item.text;
      break;
  }
}
