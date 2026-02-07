# cdx-cli

Codex SDK を使ってローカルの作業ディレクトリに対して実行する、シンプルな CLI ラッパーです。

## 前提

- Node.js 20+
- npm
- OpenAI API キー（例: `OPENAI_API_KEY`）

## インストール

```bash
npm i -g cdx-cli
```

## 使い方

```bash
cdx-cli run -w <workdir> "やってほしいこと"
```

例:

```bash
cdx-cli run -w /Users/masao/project/my-app "テストを実行して失敗を直して"
```

## コマンド

`cdx-cli run [options] "prompt"`

オプション:

- `--workdir, -w <path>`: 作業ディレクトリ（必須）
- `--instructions, -i <path>`: 追加指示を読み込むテキストファイル
- `--trace-file <path>`: トレースJSONの出力先
- `--agent-id <id>`: トレースへ記録する任意のエージェントID
- `--agent-type <type>`: トレースへ記録する任意のエージェント種別（自由入力）
- `--model, -m <model>`: 使用モデルの上書き
- `--thinking <effort>`: 推論強度（`low|medium|high|xhigh`）

## 出力

標準出力に以下形式の JSON を返します。

```json
{
  "session_id": "sess_xxx",
  "status": "completed",
  "files_changed": [
    { "path": "src/foo.ts", "kind": "update" }
  ],
  "final_response": "作業内容の要約",
  "duration_ms": 12345
}
```

終了コード:

- `0`: 成功（`status=completed`）
- `1`: 実行失敗（`status=failed`）
- `2`: CLI 実行時の致命エラー

## トレースファイル

実行ごとに `.agent-trace.json` へ追記します。

- `--trace-file` 未指定時は、Git リポジトリのルート（サブモジュール時は superproject ルート）に出力
- Git 管理外ディレクトリでは `<workdir>/.agent-trace.json` に出力

## 開発用コマンド

```bash
npm install
npm run build
npm run typecheck
npm run start -- --help
```
