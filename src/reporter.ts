import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import {
  CollectorClient,
  SdkControlClient,
  type Logger,
  type TargetService,
  type TestStatus,
  defaultLogger,
} from "./client.js";
import { detectRunMetadata, type RunMetadata } from "./metadata.js";
import { newTestTraceparent } from "./traceparent.js";

/**
 * Annotation type used to surface the per-test traceparent + test_id from the
 * reporter to the fixture (which runs in a separate worker process). The
 * annotation is set on `testInfo.annotations` from a `testCase.annotations`
 * mutation in onTestBegin; the fixture reads it at the start of each test.
 */
export const LANTERN_ANNOTATION = "lantern";

export interface LanternReporterOptions {
  collectorEndpoint: string;
  apiKey: string;
  projectId: string;
  /**
   * Instrumented services that should be signaled at test start/stop. Each
   * service must have its Lantern SDK control plane enabled.
   */
  targetServices?: TargetService[];
  /**
   * Override of run metadata. Any unset fields are auto-detected from CI
   * environment variables / local git state.
   */
  runMetadata?: RunMetadata;
  /**
   * Header name to use for the W3C traceparent. Defaults to "traceparent".
   * Override only if you have a custom propagator on the server side.
   */
  traceparentHeaderName?: string;
  /**
   * Optional logger override (default writes to console with [lantern] prefix).
   */
  logger?: Logger;
  /**
   * Disable the reporter entirely. Useful in unit tests / local dev when the
   * collector is not available.
   */
  disabled?: boolean;
}

interface PerTest {
  testId: string; // UUID v7 with dashes
  traceparent: string;
  startedAt: number;
  /** Collector-assigned UUID, distinct from our externally-generated test_id. */
  collectorTestId?: string;
  status?: TestStatus;
  durationMs?: number;
}

/**
 * Lantern Playwright reporter.
 *
 * Implements the lifecycle defined in phase-1.3:
 *   onBegin       → POST /v1/runs
 *   onTestBegin   → generate test_id, signal SDK target services, register
 *                   test in collector, surface metadata to the fixture via
 *                   testCase.annotations
 *   onTestEnd     → signal SDK stop, PATCH /v1/runs/:run_id/tests/:test_id
 *   onEnd         → PATCH /v1/runs/:run_id with aggregate counts
 */
export class LanternReporter implements Reporter {
  private readonly opts: LanternReporterOptions;
  private readonly logger: Logger;
  private readonly collector: CollectorClient;
  private readonly sdk: SdkControlClient;
  private readonly perTest = new Map<string, PerTest>();
  private runId: string | null = null;
  private totals = { total: 0, passed: 0, failed: 0, skipped: 0 };

  constructor(opts: LanternReporterOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? defaultLogger;
    this.collector = new CollectorClient({
      endpoint: opts.collectorEndpoint,
      apiKey: opts.apiKey,
      logger: this.logger,
    });
    this.sdk = new SdkControlClient(opts.targetServices ?? [], this.logger);
  }

  printsToStdio(): boolean {
    return false;
  }

  async onBegin(_config: FullConfig): Promise<void> {
    if (this.opts.disabled) return;
    const meta = detectRunMetadata(this.opts.runMetadata);
    if (!meta.commitSha) {
      this.logger.error(
        "could not detect commit SHA from environment or local git; skipping run creation"
      );
      return;
    }

    const run = await this.collector.createRun({
      projectId: this.opts.projectId,
      commitSha: meta.commitSha,
      branch: meta.branch,
      ciRunId: meta.ciRunId,
      githubPrNumber: meta.prNumber,
      attributionMode: "serialized",
    });

    if (run) {
      this.runId = run.id;
      this.logger.info(
        `lantern run created: id=${run.id} commit=${meta.commitSha} branch=${meta.branch ?? "(unknown)"}`
      );
    }
  }

  onTestBegin(test: TestCase, _result: TestResult): void {
    if (this.opts.disabled) return;
    const key = test.id;
    const { testId, traceparent } = newTestTraceparent();
    const headerName = this.opts.traceparentHeaderName ?? "traceparent";
    this.perTest.set(key, {
      testId,
      traceparent,
      startedAt: Date.now(),
    });

    // Surface metadata to the fixture. The fixture reads
    // testInfo.annotations to retrieve the test_id and traceparent.
    test.annotations.push({
      type: LANTERN_ANNOTATION,
      description: JSON.stringify({
        testId,
        traceparent,
        headerName,
        testName: test.title,
        suite: titleSuite(test),
      }),
    });

    // Fire-and-forget the SDK signal and collector registration. We don't
    // block the test from starting; the SDK clients are fail-open.
    void this.startTestAsync(test, testId);
  }

  private async startTestAsync(test: TestCase, testId: string): Promise<void> {
    await this.sdk.startTest(testId, test.title);
    if (this.runId) {
      const registered = await this.collector.registerTests(this.runId, [
        {
          testExternalId: testId,
          name: test.title,
          suite: titleSuite(test),
          filePath: relPath(test.location?.file ?? ""),
        },
      ]);
      const collectorTestId = registered[0]?.id;
      const entry = this.perTest.get(test.id);
      if (entry && collectorTestId) {
        entry.collectorTestId = collectorTestId;
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.opts.disabled) return;
    const entry = this.perTest.get(test.id);
    if (!entry) return;

    entry.durationMs = Date.now() - entry.startedAt;
    entry.status = mapStatus(result.status);
    this.totals.total++;
    if (entry.status === "passed") this.totals.passed++;
    else if (entry.status === "failed") this.totals.failed++;
    else if (entry.status === "skipped") this.totals.skipped++;

    void this.endTestAsync(test, entry);
  }

  private async endTestAsync(test: TestCase, entry: PerTest): Promise<void> {
    await this.sdk.stopTest(entry.testId, test.title);
    if (this.runId && entry.collectorTestId && entry.status) {
      await this.collector.updateTest(
        this.runId,
        entry.collectorTestId,
        entry.status,
        entry.durationMs
      );
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.opts.disabled || !this.runId) return;
    const status =
      result.status === "passed"
        ? "completed"
        : result.status === "failed" || result.status === "timedout"
          ? "failed"
          : "completed";
    await this.collector.updateRun(this.runId, status, this.totals);
    this.logger.info(
      `lantern run ${this.runId} finalized: total=${this.totals.total} passed=${this.totals.passed} failed=${this.totals.failed} skipped=${this.totals.skipped}`
    );
  }
}

function mapStatus(s: TestResult["status"]): TestStatus {
  switch (s) {
    case "passed":
      return "passed";
    case "failed":
    case "timedOut":
    case "interrupted":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      return "failed";
  }
}

function titleSuite(test: TestCase): string {
  // Playwright TestCase.titlePath() returns [project, file, ...describes, title].
  // Drop the project name and the test's own title to yield a "suite path".
  const path = test.titlePath();
  if (path.length <= 2) return "";
  return path.slice(1, -1).join(" > ");
}

function relPath(absPath: string): string {
  if (!absPath) return "";
  const cwd = process.cwd();
  return absPath.startsWith(cwd) ? absPath.slice(cwd.length + 1) : absPath;
}

export default LanternReporter;
