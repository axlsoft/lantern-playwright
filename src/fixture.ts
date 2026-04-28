import { test as base } from "@playwright/test";

import { LANTERN_ANNOTATION } from "./reporter.js";

interface LanternMeta {
  testId: string;
  traceparent: string;
  headerName: string;
  testName: string;
  suite: string;
}

function readLanternMeta(
  annotations: readonly { type: string; description?: string }[]
): LanternMeta | null {
  for (const a of annotations) {
    if (a.type === LANTERN_ANNOTATION && a.description) {
      try {
        return JSON.parse(a.description) as LanternMeta;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function baggageFor(meta: LanternMeta): string {
  return [
    `lantern.test_id=${encodeURIComponent(meta.testId)}`,
    `lantern.test_name=${encodeURIComponent(meta.testName)}`,
    meta.suite ? `lantern.suite=${encodeURIComponent(meta.suite)}` : null,
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * Lantern Playwright fixture.
 *
 * Extends Playwright's base `test` so every browser context and `request`
 * fixture automatically carries the per-test traceparent + lantern baggage
 * headers expected by instrumented services.
 *
 * Usage:
 *   import { test } from "@lantern/playwright/fixture";
 *   test("places order", async ({ page }) => { ... });
 *
 * Limitation: requests issued from contexts created manually via
 * `browser.newContext()` bypass the auto-injected `extraHTTPHeaders` and
 * must add the headers themselves (use `lanternHeaders()`).
 */
export const test = base.extend<NonNullable<unknown>>({
  context: async ({ context }, use, testInfo) => {
    const meta = readLanternMeta(testInfo.annotations);
    if (meta) {
      await context.setExtraHTTPHeaders({
        [meta.headerName]: meta.traceparent,
        baggage: baggageFor(meta),
      });
    }
    await use(context);
  },

  request: async ({ playwright }, use, testInfo) => {
    const meta = readLanternMeta(testInfo.annotations);
    const headers: Record<string, string> = meta
      ? { [meta.headerName]: meta.traceparent, baggage: baggageFor(meta) }
      : {};
    const ctx = await playwright.request.newContext({ extraHTTPHeaders: headers });
    await use(ctx);
    await ctx.dispose();
  },
});

/**
 * Returns the headers Lantern would inject for the current test, useful when
 * you create a context manually via `browser.newContext()` and need to add
 * them yourself:
 *
 *   const ctx = await browser.newContext({
 *     extraHTTPHeaders: lanternHeaders(testInfo),
 *   });
 */
export function lanternHeaders(testInfo: {
  annotations: readonly { type: string; description?: string }[];
}): Record<string, string> {
  const meta = readLanternMeta(testInfo.annotations);
  if (!meta) return {};
  return {
    [meta.headerName]: meta.traceparent,
    baggage: baggageFor(meta),
  };
}

export { expect } from "@playwright/test";
