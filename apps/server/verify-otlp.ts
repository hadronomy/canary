#!/usr/bin/env bun
/**
 * OTLP Verification Tool
 *
 * Verifies that the canary server sends traces and logs to Axiom OTLP endpoints.
 * Starts a mock Axiom server, runs the actual application, and reports results.
 *
 * Usage:
 *   bun run verify-otlp.ts
 *   bun run verify-otlp.ts --timeout 30000
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { parseArgs } from "util";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_TS_PATH = resolve(SCRIPT_DIR, "./src/index.ts");

interface CapturedRequest {
  path: string;
  body: Uint8Array;
  timestamp: number;
}

const OPTIONS = {
  timeout: {
    type: "string",
    short: "t",
    default: "30000",
  },
  verbose: {
    type: "boolean",
    short: "v",
    default: false,
  },
} as const;

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: OPTIONS,
  allowPositionals: false,
});

const TIMEOUT = Number.parseInt(args.timeout ?? "30000", 10);
const VERBOSE = args.verbose ?? false;

class Verifier {
  private requests: Array<CapturedRequest> = [];
  private server: ReturnType<typeof Bun.serve> | null = null;
  private port = 0;

  async start(): Promise<void> {
    console.log("🔍 OTLP Verification Tool\n");

    this.server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        const body = new Uint8Array(await req.arrayBuffer());
        this.requests.push({
          path: url.pathname,
          body,
          timestamp: Date.now(),
        });

        if (VERBOSE) {
          console.log(`[Mock Axiom] ${req.method} ${url.pathname} (${body.length} bytes)`);
        }

        return new Response(JSON.stringify({ partialSuccess: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    this.port = this.server.port as number;
    console.log(`✓ Mock server listening on port ${this.port}\n`);
  }

  stop(): void {
    this.server?.stop();
  }

  getEnv(): Record<string, string> {
    return {
      ...process.env,
      AXIOM_URL: `http://localhost:${this.port}`,
      AXIOM_API_TOKEN: "test-token-verification",
      AXIOM_DATASET: "verification-dataset",
      AXIOM_TRACES_DATASET: "verification-traces",
      AXIOM_LOGS_DATASET: "verification-logs",
      AXIOM_SERVICE_NAME: "canary-verification",
      AXIOM_ENVIRONMENT: "verification",
      AXIOM_SHUTDOWN_TIMEOUT_MS: "1000",
      AXIOM_BATCH_TIMEOUT_MS: "100",
    };
  }

  async runApp(): Promise<number> {
    console.log("🚀 Starting application...\n");

    const startTime = Date.now();
    const proc = spawn("bun", ["run", INDEX_TS_PATH], {
      cwd: SCRIPT_DIR,
      env: this.getEnv(),
      stdio: VERBOSE ? "inherit" : ["ignore", "ignore", "inherit"],
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("⏱️  Timeout reached, stopping application...");
        proc.kill();
      }, TIMEOUT);

      proc.on("exit", (_code) => {
        clearTimeout(timeout);
        resolve(Date.now() - startTime);
      });
    });
  }

  printResults(duration: number): void {
    console.log(`\n⏱️  Duration: ${duration}ms\n`);

    const traces = this.requests.filter((r) => r.path === "/v1/traces");
    const logs = this.requests.filter((r) => r.path === "/v1/logs");

    console.log("═".repeat(60));
    console.log("VERIFICATION RESULTS");
    console.log("═".repeat(60));
    console.log();

    if (this.requests.length === 0) {
      console.log("❌ No OTLP requests captured\n");
      return;
    }

    console.log(`Total requests: ${this.requests.length}\n`);

    for (const req of this.requests) {
      const icon = req.path === "/v1/traces" ? "📊" : req.path === "/v1/logs" ? "📝" : "📦";
      console.log(`  ${icon} ${req.path}: ${req.body.length} bytes`);
    }

    console.log();
    console.log("─".repeat(60));
    console.log(`Traces: ${traces.length > 0 ? "✅ YES" : "❌ NO"} (${traces.length})`);
    console.log(`Logs:   ${logs.length > 0 ? "✅ YES" : "❌ NO"} (${logs.length})`);
    console.log("─".repeat(60));
    console.log();

    if (traces.length > 0 && logs.length > 0) {
      console.log("✅ SUCCESS: OTLP export working correctly!\n");
    } else {
      console.log("❌ FAIL: Missing OTLP exports\n");
      if (traces.length === 0) console.log("   → No traces received");
      if (logs.length === 0) console.log("   → No logs received");
      console.log();
    }
  }

  get exitCode(): number {
    const traces = this.requests.filter((r) => r.path === "/v1/traces").length;
    const logs = this.requests.filter((r) => r.path === "/v1/logs").length;
    return traces > 0 && logs > 0 ? 0 : 1;
  }
}

async function main(): Promise<void> {
  const verifier = new Verifier();

  try {
    await verifier.start();
    const duration = await verifier.runApp();
    verifier.printResults(duration);
    process.exit(verifier.exitCode);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    verifier.stop();
  }
}

main();
