import { describe, expect, it } from "vitest";

import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  newTestTraceparent,
} from "../src/traceparent.js";

describe("traceparent", () => {
  it("generates 32-char lowercase hex trace IDs", () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates 16-char lowercase hex span IDs", () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("formats traceparent in W3C version-00 form", () => {
    const tp = formatTraceparent("a".repeat(32), "b".repeat(16));
    expect(tp).toBe(`00-${"a".repeat(32)}-${"b".repeat(16)}-01`);
  });

  it("emits unsampled flag when sampled=false", () => {
    const tp = formatTraceparent("a".repeat(32), "b".repeat(16), false);
    expect(tp.endsWith("-00")).toBe(true);
  });

  it("newTestTraceparent ties test_id to trace-id", () => {
    const { testId, traceparent } = newTestTraceparent();
    const traceId = testId.replace(/-/g, "");
    expect(traceparent).toContain(`-${traceId}-`);
    expect(testId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
