# @lantern/playwright

Playwright reporter and fixture for [Lantern](https://github.com/axlsoft/lantern)
functional test coverage.

The plugin generates a unique `test_id` for every test, signals each
instrumented service to scope its coverage to that test, injects a W3C
`traceparent` header so server-side coverage is attributable, and reports
results to the Lantern collector.

## Install

```bash
pnpm add -D @lantern/playwright
```

`@playwright/test >= 1.40` is a peer dependency. Node 20+ is required.

## Quickstart

In `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    [
      "@lantern/playwright",
      {
        collectorEndpoint: process.env.LANTERN_COLLECTOR_ENDPOINT!,
        apiKey:            process.env.LANTERN_API_KEY!,
        projectId:         process.env.LANTERN_PROJECT_ID!,
        targetServices: [
          { name: "checkout-api", url: "http://localhost:5080" },
          { name: "orders-api",   url: "http://localhost:5081" },
        ],
      },
    ],
  ],
});
```

In your test files, import `test` from the plugin's fixture entry point:

```ts
import { test, expect } from "@lantern/playwright/fixture";

test("my test", async ({ page, request }) => {
  // every request from `page` and `request` carries the
  // per-test traceparent automatically.
});
```

## How it works

1. **`onBegin`** — registers a run with the collector.
2. **`onTestBegin`** — generates a UUID v7 `test_id`, signals every target
   service via `POST /_lantern/test/start`, registers the test with the
   collector, and pushes the traceparent onto a Playwright annotation.
3. **Fixture** — reads the annotation in the worker process and applies
   `extraHTTPHeaders` to the test's `context` and `request` fixtures.
4. **`onTestEnd`** — signals each target via `POST /_lantern/test/stop` and
   reports the test outcome to the collector.
5. **`onEnd`** — finalises the run.

All collector and SDK calls are **fail-open**: a failed signal logs a warning
but never fails the test.

## Configuration

| Option                   | Required | Default        | Description                                              |
| ------------------------ | -------- | -------------- | -------------------------------------------------------- |
| `collectorEndpoint`      | yes      |                | Base URL of the Lantern collector.                       |
| `apiKey`                 | yes      |                | Project-scoped API key.                                  |
| `projectId`              | yes      |                | Lantern project UUID.                                    |
| `targetServices`         | yes      |                | `[{name, url}]` — instrumented apps to signal per test.  |
| `traceparentHeaderName`  | no       | `traceparent`  | Header name used to propagate the traceparent.           |
| `runMetadata`            | no       | auto-detected  | Override commit/branch/CI metadata.                      |
| `disabled`               | no       | `false`        | Short-circuit the reporter (useful for local dev).       |

## Sample

A complete end-to-end sample lives in
[`samples/example-suite/`](./samples/example-suite/README.md). It brings up
Postgres, the Lantern collector, and a .NET sample API via `docker compose`
and runs a small Playwright suite end to end.

## Specifications

- [`docs/SPEC.md`](./docs/SPEC.md) — wire protocol & ID formats.
- [`docs/adr/`](./docs/adr/) — design decisions.

## Quickstart for contributors

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```
