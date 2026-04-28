import { v7 as uuidv7 } from "uuid";

/**
 * Generates a new UUID v7 and returns it as a 32-character lowercase hex string
 * (no dashes) suitable for use as a W3C traceparent trace-id.
 */
export function generateTraceId(): string {
  return uuidv7().replace(/-/g, "");
}

/**
 * Generates a random 16-character lowercase hex string for use as a
 * W3C traceparent span-id.
 */
export function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Formats a W3C traceparent header value.
 *
 * @param traceId  32-char lowercase hex (no dashes) — must be the test's UUID v7 hex.
 * @param spanId   16-char lowercase hex (no dashes).
 * @param sampled  Whether the trace is sampled (default: true).
 */
export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  const flags = sampled ? "01" : "00";
  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Creates a new traceparent whose trace-id encodes a UUID v7 test ID.
 * Returns both the header value and the raw test_id (with dashes) for use
 * as the Lantern test identifier.
 */
export function newTestTraceparent(): { testId: string; traceparent: string; spanId: string } {
  const raw = uuidv7();
  const traceId = raw.replace(/-/g, "");
  const spanId = generateSpanId();
  return {
    testId: raw,
    traceparent: formatTraceparent(traceId, spanId),
    spanId,
  };
}
