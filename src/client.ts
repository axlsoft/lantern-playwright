/**
 * HTTP clients for talking to:
 *  - Lantern collector REST API (run + test lifecycle)
 *  - Instrumented application SDK control planes (test start/stop)
 *
 * All operations are fail-open with bounded retries: if the network is
 * unreachable we log a warning rather than failing the test suite.
 */

export interface RetryOptions {
  /** Max total time to spend on retries, including the initial attempt. */
  maxTotalMs?: number;
  /** Initial backoff delay in ms (default 100ms). */
  initialDelayMs?: number;
  /** Max single-attempt delay in ms (default 5000ms). */
  maxDelayMs?: number;
  /** Per-attempt request timeout in ms (default 10000ms). */
  attemptTimeoutMs?: number;
}

export interface Logger {
  warn: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

export const defaultLogger: Logger = {
  warn: (m, ...a) => console.warn(`[lantern] ${m}`, ...a),
  info: (m, ...a) => console.info(`[lantern] ${m}`, ...a),
  error: (m, ...a) => console.error(`[lantern] ${m}`, ...a),
};

const DEFAULTS: Required<RetryOptions> = {
  maxTotalMs: 30_000,
  initialDelayMs: 100,
  maxDelayMs: 5_000,
  attemptTimeoutMs: 10_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Issues an HTTP request with exponential backoff + jitter on 5xx and network
 * errors. 4xx responses are returned without retry. Throws on bounded-retry
 * exhaustion.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retry: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULTS, ...retry };
  const start = Date.now();
  let attempt = 0;
  let lastErr: unknown;

  while (Date.now() - start < opts.maxTotalMs) {
    attempt++;
    try {
      const res = await fetchWithTimeout(url, init, opts.attemptTimeoutMs);
      if (res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }

    const delay = Math.min(opts.maxDelayMs, opts.initialDelayMs * Math.pow(2, attempt - 1));
    const jittered = delay * (0.5 + Math.random() * 0.5);
    if (Date.now() - start + jittered >= opts.maxTotalMs) break;
    await sleep(jittered);
  }

  throw lastErr ?? new Error("retry exhausted");
}

// ────────────────────────────────────────────────────────────────────────────
// SDK control plane client
// ────────────────────────────────────────────────────────────────────────────

export interface TargetService {
  /** Friendly name used only in logs. */
  name: string;
  /** Base URL of the instrumented application, e.g. http://localhost:5000 */
  url: string;
  /** Override for the control plane base path (default: /_lantern). */
  controlPlanePath?: string;
}

export class SdkControlClient {
  constructor(
    private readonly targets: TargetService[],
    private readonly logger: Logger = defaultLogger,
    private readonly retry: RetryOptions = { maxTotalMs: 5_000 }
  ) {}

  /** Calls POST /_lantern/test/start on every configured target. Fail-open. */
  async startTest(testId: string, testName: string): Promise<void> {
    await Promise.all(this.targets.map((t) => this.signal(t, "/test/start", testId, testName)));
  }

  /** Calls POST /_lantern/test/stop on every configured target. Fail-open. */
  async stopTest(testId: string, testName: string): Promise<void> {
    await Promise.all(this.targets.map((t) => this.signal(t, "/test/stop", testId, testName)));
  }

  private async signal(
    target: TargetService,
    path: string,
    testId: string,
    testName: string
  ): Promise<void> {
    const base = target.controlPlanePath ?? "/_lantern";
    const url = `${target.url.replace(/\/+$/, "")}${base}${path}?test_id=${encodeURIComponent(
      testId
    )}&test_name=${encodeURIComponent(testName)}`;
    try {
      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lantern-test-id": testId,
          },
        },
        this.retry
      );
      if (!res.ok) {
        this.logger.warn(`target ${target.name} (${url}) returned ${res.status} for ${path}`);
      }
    } catch (err) {
      this.logger.warn(
        `target ${target.name} (${url}) unreachable for ${path}: ${(err as Error).message}`
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Collector client
// ────────────────────────────────────────────────────────────────────────────

export interface CollectorClientOptions {
  endpoint: string;
  apiKey: string;
  logger?: Logger;
  retry?: RetryOptions;
}

export interface CreateRunInput {
  projectId: string;
  commitSha: string;
  branch?: string;
  ciRunId?: string;
  githubPrNumber?: number;
  attributionMode?: "serialized" | "worker_pinned";
}

export interface RegisteredRun {
  id: string;
  project_id: string;
  commit_sha: string;
}

export interface RegisterTestInput {
  testExternalId: string;
  name: string;
  suite: string;
  filePath: string;
}

export interface RegisteredTest {
  id: string;
  test_external_id: string;
}

export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type RunStatus = "pending" | "running" | "completed" | "failed";

export class CollectorClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly logger: Logger;
  private readonly retry: RetryOptions;

  constructor(opts: CollectorClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.logger = opts.logger ?? defaultLogger;
    this.retry = opts.retry ?? {};
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  async createRun(input: CreateRunInput): Promise<RegisteredRun | null> {
    const body = {
      project_id: input.projectId,
      commit_sha: input.commitSha,
      branch: input.branch ?? "",
      ci_run_id: input.ciRunId ?? "",
      github_pr_number: input.githubPrNumber ?? null,
      attribution_mode: input.attributionMode ?? "serialized",
    };
    try {
      const res = await fetchWithRetry(
        `${this.endpoint}/v1/runs`,
        { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
        this.retry
      );
      if (!res.ok) {
        this.logger.error(`collector createRun failed: HTTP ${res.status} ${await res.text()}`);
        return null;
      }
      const json = (await res.json()) as { data: RegisteredRun };
      return json.data;
    } catch (err) {
      this.logger.error(`collector createRun error: ${(err as Error).message}`);
      return null;
    }
  }

  async updateRun(
    runId: string,
    status: RunStatus,
    counts: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
    }
  ): Promise<void> {
    const body = {
      status,
      total_tests: counts.total,
      passed_tests: counts.passed,
      failed_tests: counts.failed,
      skipped_tests: counts.skipped,
    };
    try {
      const res = await fetchWithRetry(
        `${this.endpoint}/v1/runs/${runId}`,
        { method: "PATCH", headers: this.headers(), body: JSON.stringify(body) },
        this.retry
      );
      if (!res.ok) {
        this.logger.error(`collector updateRun failed: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`collector updateRun error: ${(err as Error).message}`);
    }
  }

  async registerTests(runId: string, tests: RegisterTestInput[]): Promise<RegisteredTest[]> {
    const body = {
      tests: tests.map((t) => ({
        test_external_id: t.testExternalId,
        name: t.name,
        suite: t.suite,
        file_path: t.filePath,
      })),
    };
    try {
      const res = await fetchWithRetry(
        `${this.endpoint}/v1/runs/${runId}/tests`,
        { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
        this.retry
      );
      if (!res.ok) {
        this.logger.error(`collector registerTests failed: HTTP ${res.status} ${await res.text()}`);
        return [];
      }
      const json = (await res.json()) as { data: RegisteredTest[] };
      return json.data ?? [];
    } catch (err) {
      this.logger.error(`collector registerTests error: ${(err as Error).message}`);
      return [];
    }
  }

  async updateTest(
    runId: string,
    testId: string,
    status: TestStatus,
    durationMs?: number
  ): Promise<void> {
    const body = {
      status,
      duration_ms: durationMs ?? null,
    };
    try {
      const res = await fetchWithRetry(
        `${this.endpoint}/v1/runs/${runId}/tests/${testId}`,
        { method: "PATCH", headers: this.headers(), body: JSON.stringify(body) },
        this.retry
      );
      if (!res.ok) {
        this.logger.error(`collector updateTest failed: HTTP ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`collector updateTest error: ${(err as Error).message}`);
    }
  }
}
