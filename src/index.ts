/**
 * Public entry point for `@lantern/playwright`.
 *
 * Exports the reporter (default + named), supporting types, and the lower-level
 * HTTP clients for advanced users who want to talk to the collector directly.
 */
export { LanternReporter, LANTERN_ANNOTATION, type LanternReporterOptions } from "./reporter.js";

export {
  CollectorClient,
  SdkControlClient,
  fetchWithRetry,
  defaultLogger,
  type CollectorClientOptions,
  type CreateRunInput,
  type Logger,
  type RegisterTestInput,
  type RegisteredRun,
  type RegisteredTest,
  type RetryOptions,
  type RunStatus,
  type TargetService,
  type TestStatus,
} from "./client.js";

export {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  newTestTraceparent,
} from "./traceparent.js";

export { detectRunMetadata, type RunMetadata } from "./metadata.js";

// Re-export the reporter as the default export so users can write:
//   reporter: [["@lantern/playwright", { ... }]]
// in their playwright.config.ts.
export { LanternReporter as default } from "./reporter.js";
