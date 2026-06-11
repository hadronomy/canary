#!/usr/bin/env -S deno run -A
/// <reference lib="deno.ns" />
/// <reference lib="dom" />

type StepOptions = {
  ok?: number[];
  stdout?: "inherit" | "piped";
  stderr?: "inherit" | "piped";
};

const root = file(new URL("../", import.meta.url));
const tmp = join(".tmp", "demo");
const session = "canary-demo";
const bin = "/Volumes/Yggdrasil/Projects/canary/rust/target/debug/canary";
const cfg = join(".tmp", "canary-rustfs.toml");
const server = join(tmp, "server.sh");
const worker = join(tmp, "worker.sh");
const showcase = join(tmp, "showcase.sh");
const attach = join(tmp, "attach.sh");

const usage = `
Canary demo

Usage:
  deno run -A scripts/canary-demo.ts [--no-dev-up] [--prepare-only]

Options:
  --no-dev-up    Skip \`just dev-up\` and only open the Ghostty/tmux demo.
  --prepare-only Generate demo helper scripts and exit without opening Ghostty.
`.trim();

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log(usage);
  Deno.exit(0);
}

await main();

async function main() {
  await ensure();
  await write();

  if (Deno.args.includes("--prepare-only")) {
    console.log(`Demo helpers written to ${tmp}`);
    return;
  }

  if (!Deno.args.includes("--no-dev-up")) {
    await step(["just", "dev-up"]);
  }

  await step(["tmux", "kill-session", "-t", session], {
    ok: [0, 1],
    stderr: "piped",
  });
  await step([
    "tmux",
    "new-session",
    "-d",
    "-s",
    session,
    "-n",
    "runtime",
    "-c",
    root,
    server,
  ]);
  await step([
    "tmux",
    "split-window",
    "-h",
    "-t",
    `${session}:runtime`,
    "-c",
    root,
    worker,
  ]);
  await step([
    "tmux",
    "select-layout",
    "-t",
    `${session}:runtime`,
    "even-horizontal",
  ]);
  await step([
    "tmux",
    "set-option",
    "-t",
    session,
    "status-left",
    " Canary demo ",
  ]);
  await step([
    "tmux",
    "set-option",
    "-t",
    session,
    "status-style",
    "bg=colour235,fg=colour178",
  ]);
  await step([
    "tmux",
    "set-window-option",
    "-t",
    `${session}:runtime`,
    "pane-border-status",
    "top",
  ]);
  await step([
    "tmux",
    "new-window",
    "-t",
    session,
    "-n",
    "showcase",
    "-c",
    root,
    showcase,
  ]);
  await step(["tmux", "select-window", "-t", `${session}:showcase`]);

  await ghostty();

  console.log("");
  console.log("Canary demo opened in Ghostty.");
  console.log(`tmux session: ${session}`);
  console.log("Stop the demo panes with:");
  console.log(`  tmux kill-session -t ${session}`);
  console.log("Stop local dev services with:");
  console.log("  just dev-stop");
}

async function ensure() {
  await Deno.mkdir(tmp, { recursive: true });
  await ensureConfig();

  for (
    const tool of ["ghostty", "tmux", "deno", "curl", "jq", "temporal", "just"]
  ) {
    await step(["bash", "-lc", `command -v ${quote(tool)} >/dev/null`], {
      stderr: "piped",
    });
  }

  try {
    await Deno.stat(bin);
  } catch {
    throw new Error(`Canary binary not found at ${bin}`);
  }
}

async function ensureConfig() {
  try {
    await Deno.stat(cfg);
    return;
  } catch {
    // The demo uses the repo's local RustFS stack. Keeping this under .tmp
    // makes it disposable and avoids turning developer credentials into docs.
  }

  await Deno.mkdir(join(".tmp"), { recursive: true });
  await Deno.writeTextFile(
    cfg,
    `[files.storage]
bucket = "canary-files-dev"
region = "us-east-1"
endpoint = "http://127.0.0.1:9000"
prefix = "files"
addressing_style = "path_style"
transport_security = "allow_http"

[files.storage.credentials]
kind = "static"
access_key_id = "canaryadmin"
secret_access_key = "canarysecret123"

[files.uploads]
multipart_threshold_bytes = 5242880
multipart_part_size_bytes = 5242880
multipart_max_parts = 32
`,
  );
}

async function write() {
  await script(
    server,
    `#!/usr/bin/env bash
set -euo pipefail

cd ${quote(root)}
clear
printf '\\033[1;32mCanary server\\033[0m\\n'
printf 'binary: %s\\n' ${quote(bin)}
printf 'config: %s\\n\\n' ${quote(cfg)}

exec ${quote(bin)} serve \\
  --config ${quote(cfg)} \\
  --log-filter 'canary_server=info,tower_http=info,canary_authorization=info'
`,
  );

  await script(
    worker,
    `#!/usr/bin/env bash
set -euo pipefail

cd ${quote(root)}
clear
printf '\\033[1;35mCanary Temporal workers\\033[0m\\n'
printf 'workflow queue: canary-workflows\\n'
printf 'activity queue: canary-rust-activities\\n\\n'

exec ${quote(bin)} worker run \\
  --kind all \\
  --log-filter 'canary_workers=info,temporalio=warn,temporalio_sdk_core=warn'
`,
  );

  await script(showcase, showcaseScript());
  await script(
    attach,
    `#!/usr/bin/env bash
set -euo pipefail
cd ${quote(root)}
exec tmux attach -t ${quote(session)}
`,
  );
}

async function script(path: string, text: string) {
  await Deno.writeTextFile(path, text);
  await Deno.chmod(path, 0o755);
}

async function ghostty() {
  const args = ["-na", "Ghostty.app", "--args", `--command=${attach}`];
  const out = await new Deno.Command("open", {
    args,
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (out.code === 0) {
    return;
  }

  await step(["open", "-na", "Ghostty", "--args", `--command=${attach}`]);
}

async function step(cmd: string[], opts: StepOptions = {}) {
  const exe = cmd[0];
  if (!exe) {
    throw new Error("Empty command.");
  }
  const proc = new Deno.Command(exe, {
    args: cmd.slice(1),
    cwd: root,
    stdout: opts.stdout ?? "inherit",
    stderr: opts.stderr ?? "inherit",
  }).spawn();
  const out = await proc.status;
  const ok = opts.ok ?? [0];

  if (ok.includes(out.code)) {
    return out;
  }

  throw new Error(`Command failed: ${cmd.map(quote).join(" ")}`);
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function file(url: URL) {
  if (url.protocol !== "file:") {
    throw new Error(`Expected a file URL, got ${url.href}`);
  }
  return decodeURIComponent(url.pathname).replace(/\/$/, "");
}

function join(...parts: string[]) {
  const head = parts[0] ?? "";
  const path = head.startsWith("/") ? parts : [root, ...parts];
  return path
    .map((part, idx) =>
      idx === 0 ? part.replace(/\/+$/g, "") : part.replace(/^\/+|\/+$/g, "")
    )
    .filter((part) => part.length > 0)
    .join("/");
}

function showcaseScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

cd ${quote(root)}

BASE="http://127.0.0.1:8080"
CANARY=${quote(bin)}
CFG=${quote(cfg)}
TMP=${quote(tmp)}
ACTOR="demo-agent"
MCP_VERSION="2025-11-25"

mkdir -p "$TMP"

PACE="\${CANARY_DEMO_PACE_SECONDS:-1.5}"
AUTOPLAY="\${CANARY_DEMO_AUTOPLAY:-0}"

pause() {
  if [[ "$AUTOPLAY" == "1" ]]; then
    sleep "$PACE"
    return
  fi
  printf '\\n\\033[2mpress Enter to run this section...\\033[0m'
  IFS= read -r _ || true
  printf '\\n'
}

start() {
  if [[ "$AUTOPLAY" == "1" ]]; then
    sleep "$PACE"
    return
  fi
  printf '\\n\\033[1;33mpress Enter when you are ready to start the walkthrough\\033[0m'
  IFS= read -r _ || true
  printf '\\n'
}

title() {
  printf '\\n\\033[1;36m╭─ %s \\033[0m\\n' "$1"
  pause
}

note() {
  printf '\\033[2m%s\\033[0m\\n' "$1"
}

cmd() {
  printf '\\n\\033[1;33m$ %s\\033[0m\\n' "$*"
  sleep 0.35
}

wait_http() {
  for _ in {1..90}; do
    if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "server did not become healthy in time" >&2
  return 1
}

wait_temporal() {
  for _ in {1..90}; do
    if temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Temporal did not become healthy in time" >&2
  return 1
}

sse_json() {
  sed -n 's/^data: //p' "$1" | tail -n 1
}

json_curl() {
  curl -sS "$@" | jq -C
}

clear
printf '\\033[1;36mCanary capability demo\\033[0m\\n'
note 'Window 1 has the server and worker panes. This tab drives the walkthrough.'
note 'Human URLs are registered through Portless, while curl uses raw localhost for protocol clarity.'
note 'The walkthrough pauses before each section so you can watch it happen.'
note 'tmux: Ctrl-b 0 opens runtime, Ctrl-b 1 returns to this showcase.'
note 'Set CANARY_DEMO_AUTOPLAY=1 to run with timed pauses instead of Enter prompts.'
start
printf '\\n'

title '0. Wait for the runtime'
cmd 'curl -fsS http://127.0.0.1:8080/healthz'
wait_http
curl -fsS "$BASE/healthz" | jq -C

cmd 'temporal operator cluster health --address 127.0.0.1:7233'
wait_temporal
temporal operator cluster health --address 127.0.0.1:7233

title '1. Build identity'
cmd 'canary version --format json | jq'
"$CANARY" version --format json | jq -C '{version, revision, commit, build_channel, rust_version}'

title '2. Effective config, with secrets redacted'
cmd 'canary config show --format json | jq'
"$CANARY" config show --config "$CFG" --format json --log-filter off \\
  | jq -C '{server, files: {bucket: .files.bucket, endpoint: .files.endpoint, prefix: .files.prefix, credentials: .files.credentials}, workers}'

title '3. Health and readiness'
cmd 'curl /readyz | jq'
json_curl "$BASE/readyz"

title '4. RFC-style TODO problem response'
cmd 'curl /api/v1/collections | jq'
curl -sS "$BASE/api/v1/collections" | jq -C '{status, code, detail, request_id}'

title '5. Parser summary endpoint'
cmd 'curl --data-binary @demo.txt /api/v1/parse/document | jq'
cat > "$TMP/demo.txt" <<'TEXT'
Canary demo document

Article 1. Tiny demo signals may fan out into batches.
Article 2. Every batch must return home before the fan-in summary is trusted.
TEXT
curl -sS \\
  -H 'content-type: text/plain; charset=utf-8' \\
  --data-binary @"$TMP/demo.txt" \\
  "$BASE/api/v1/parse/document" \\
  | jq -C

title '6. MCP initialize and list tools'
cmd 'POST /mcp initialize'
curl -sS \\
  -D "$TMP/mcp.headers" \\
  -o "$TMP/mcp.init.sse" \\
  -X POST "$BASE/mcp" \\
  -H 'host: localhost' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'content-type: application/json' \\
  --data-binary @- <<JSON
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"$MCP_VERSION","capabilities":{},"clientInfo":{"name":"canary-demo","version":"0.1.0"}}}
JSON
sse_json "$TMP/mcp.init.sse" | jq -C '{server: .result.serverInfo, capabilities: (.result.capabilities | keys)}'

SESSION="$(awk -F': ' 'tolower($1) == "mcp-session-id" { gsub("\\r", "", $2); print $2 }' "$TMP/mcp.headers")"

cmd 'POST /mcp notifications/initialized'
curl -sS -o /dev/null -w 'status=%{http_code}\\n' \\
  -X POST "$BASE/mcp" \\
  -H 'host: localhost' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'content-type: application/json' \\
  -H "mcp-session-id: $SESSION" \\
  -H "mcp-protocol-version: $MCP_VERSION" \\
  --data-binary '{"jsonrpc":"2.0","method":"notifications/initialized"}'

cmd 'POST /mcp tools/list'
curl -sS \\
  -o "$TMP/mcp.tools.sse" \\
  -X POST "$BASE/mcp" \\
  -H 'host: localhost' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'content-type: application/json' \\
  -H "mcp-session-id: $SESSION" \\
  -H "mcp-protocol-version: $MCP_VERSION" \\
  --data-binary '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
sse_json "$TMP/mcp.tools.sse" \\
  | jq -C '{tools: [.result.tools[] | {name, description: ((.description // "") | split("\\n")[0])}]}'

cmd 'POST /mcp resources/templates/list'
curl -sS \\
  -o "$TMP/mcp.templates.sse" \\
  -X POST "$BASE/mcp" \\
  -H 'host: localhost' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'content-type: application/json' \\
  -H "mcp-session-id: $SESSION" \\
  -H "mcp-protocol-version: $MCP_VERSION" \\
  --data-binary '{"jsonrpc":"2.0","id":3,"method":"resources/templates/list"}'
sse_json "$TMP/mcp.templates.sse" \\
  | jq -C '{templates: [.result.resourceTemplates[] | {name, uriTemplate}]}'

title '7. Direct-to-object-storage upload'
cat > "$TMP/tiny-scroll.txt" <<'TEXT'
Canary carried this tiny scroll through a presigned RustFS upload.
TEXT
SIZE="$(wc -c < "$TMP/tiny-scroll.txt" | tr -d ' ')"
SHA="$(shasum -a 256 "$TMP/tiny-scroll.txt" | awk '{print $1}')"
BODY="$(jq -cn --arg sha "$SHA" --argjson size "$SIZE" '{name:"tiny-scroll.txt", content_type:"text/plain", size_bytes:$size, sha256:$sha, purpose:"attachment"}')"

cmd 'POST /api/v1/files/uploads'
curl -sS \\
  -X POST "$BASE/api/v1/files/uploads" \\
  -H 'content-type: application/json' \\
  -H "x-canary-actor-id: $ACTOR" \\
  --data-binary "$BODY" \\
  | tee "$TMP/upload.created.json" \\
  | jq -C

URL="$(jq -r '.upload.url' "$TMP/upload.created.json")"
ID="$(jq -r '.id' "$TMP/upload.created.json")"
ARGS=()
while IFS=$'\\t' read -r NAME VALUE; do
  ARGS+=(-H "$NAME: $VALUE")
done < <(jq -r '.upload.headers[] | [.name, .value] | @tsv' "$TMP/upload.created.json")

cmd 'PUT presigned RustFS URL'
curl -sS -X PUT "\${ARGS[@]}" --data-binary @"$TMP/tiny-scroll.txt" "$URL" -o /dev/null -w 'status=%{http_code}\\n'

cmd 'POST /api/v1/files/uploads/{id}/complete'
curl -sS \\
  -X POST "$BASE/api/v1/files/uploads/$ID/complete" \\
  -H 'content-type: application/json' \\
  -H "x-canary-actor-id: $ACTOR" \\
  --data-binary '{}' \\
  | tee "$TMP/upload.completed.json" \\
  | jq -C

cmd 'GET /api/v1/files?limit=5'
json_curl "$BASE/api/v1/files?limit=5"

title '8. Temporal fan-out/fan-in distributed math workflow'
WORKFLOW="canary-demo-$(date +%H%M%S)"
INPUT="$(jq -cn '{terms: 100000000, shard_size: 1000000, lookahead: 8, rust_activity_task_queue:"canary-rust-activities"}')"
note 'This computes 100,000,000 Leibniz π terms as 100 child workflows with lookahead=8.'
note 'It is toy math, but the orchestration is the real thing: fan-out, activities, fan-in, ordered result.'
note 'This step starts the workflow, follows the Temporal event history live, then prints the decoded result.'
note 'Switch to tmux window 0 too if you want to watch the worker pane log shard completions.'
pause
cmd 'temporal workflow start --type DistributedPiWorkflow'
temporal workflow start \\
  --address 127.0.0.1:7233 \\
  --namespace default \\
  --workflow-id "$WORKFLOW" \\
  --task-queue canary-workflows \\
  --type DistributedPiWorkflow \\
  --input "$INPUT" \\
  --output json \\
  | tee "$TMP/workflow.started.json" \\
  | jq -C '{workflowId: (.workflowId // .workflowExecution.workflowId // .execution.workflowId // "'$WORKFLOW'"), runId: (.runId // .workflowExecution.runId // .execution.runId)}'

cmd 'temporal workflow show --follow'
temporal workflow show \\
  --address 127.0.0.1:7233 \\
  --namespace default \\
  --workflow-id "$WORKFLOW" \\
  --follow \\
  --command-timeout 180s \\
  --color always \\
  | tee "$TMP/workflow.history.txt"

cmd 'temporal workflow result --output json | jq'
temporal workflow result \\
  --address 127.0.0.1:7233 \\
  --namespace default \\
  --workflow-id "$WORKFLOW" \\
  --output json \\
  | tee "$TMP/workflow.json" \\
  | jq -C '(.result // .) as $result | {
      workflowId: (.workflowId // .workflowExecution.workflowId // .execution.workflowId // "'$WORKFLOW'"),
      runId: (.runId // .workflowExecution.runId // .execution.runId),
      status: (.status // "completed"),
      terms: $result.terms,
      shard_count: $result.shard_count,
      estimate: $result.estimate,
      error: $result.error,
      note: $result.note,
      first_shards: [$result.shards[:3][] | {range, terms, partial, note}],
      last_shards: [$result.shards[-3:][] | {range, terms, partial, note}]
    }'

title 'Done'
note 'Runtime panes are still running in the first tmux window.'
note 'Useful cleanup: tmux kill-session -t canary-demo && just dev-stop'
printf '\\n'
exec bash -l
`;
}
