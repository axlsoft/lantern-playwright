# Lantern SDK Wire Specification

**Status:** v1 — locked as of Phase 1.3.

This document defines the wire-level contract between the Lantern Playwright
plugin (and any other test runner integration) and Lantern SDKs running inside
instrumented applications. **All SDKs MUST implement the formats and endpoints
defined here.**

---

## 1. Test identifier

Each test execution is uniquely identified by a **test_id**.

- **Format:** UUID v7, lowercase, with dashes (8-4-4-4-12), e.g.
  `0192fd31-7b8b-7c00-9d3e-4a2b6c1d8e90`.
- **Source of truth:** the test runner (Playwright reporter generates it on
  `onTestBegin`).
- **Stability:** the test_id is constant for the lifetime of a single test
  execution; it changes for retries.
- **In transit:**
  - Used as the test_external_id when registering tests with the collector.
  - Used as the trace-id source for the W3C traceparent header (see §2).
  - Sent as the `x-lantern-test-id` header and `?test_id=` query param to SDK
    control plane endpoints (see §3).

## 2. W3C traceparent header

Lantern uses the W3C Trace Context `traceparent` header to propagate test
identity from the test runner to the application.

- **Header name:** `traceparent` (configurable; default matches spec).
- **Format:** `00-<trace-id>-<span-id>-<flags>` per
  [W3C Trace Context Level 1](https://www.w3.org/TR/trace-context/).
- **trace-id (32 hex chars):** the test_id with dashes removed and lowercased.
  Example: test_id `0192fd31-7b8b-7c00-9d3e-4a2b6c1d8e90` →
  trace-id `0192fd317b8b7c009d3e4a2b6c1d8e90`.
- **span-id (16 hex chars):** randomly generated per test; not reused.
- **flags:** `01` (sampled) for all Lantern test traffic.

> **Why UUID v7?** Time-ordered for debugging and partition friendliness, plus
> compatibility with the trace-id 32-char requirement.

### 2.1 Baggage header (optional but recommended)

A companion `baggage` header carries human-readable context:

```
baggage: lantern.test_id=<uuid>,lantern.test_name=<urlencoded name>,lantern.suite=<urlencoded suite>
```

SDKs SHOULD log the baggage values when emitting coverage events but MUST NOT
require the baggage header to be present.

## 3. SDK control plane HTTP endpoints

Every SDK MUST expose a control plane under a configurable base path
(default `/_lantern`) that the test runner can call to start/stop test
attribution windows. This is the primary attribution mechanism, complementary
to traceparent extraction from inbound requests.

### 3.1 `GET /_lantern/health`

- **Purpose:** liveness probe.
- **Response:** `200 OK` with body `{"status":"ok"}`.

### 3.2 `POST /_lantern/test/start`

- **Purpose:** signal that a test execution window is beginning. The SDK
  should snapshot coverage state and bind subsequent attribution to the
  provided test_id.
- **Query params:**
  - `test_id` (required) — UUID v7 of the test.
  - `test_name` (optional) — human-readable test name for logs.
- **Headers:**
  - `x-lantern-test-id` (recommended) — same as `test_id` query param;
    SDKs MAY accept the header in lieu of the query param.
- **Body:** none required (SDKs MAY accept JSON for forward compatibility).
- **Response:** `200 OK` with body `{"test_id":"<uuid>"}`.
- **Errors:** `400 Bad Request` if `test_id` is missing, `{"error":"..."}`.

### 3.3 `POST /_lantern/test/stop`

- **Purpose:** signal that the test execution window is ending. The SDK
  should diff coverage state, emit coverage events to the collector
  attributed to the current test_id, and clear the bound scope.
- **Query params:** `test_id` (optional — defaults to currently bound test);
  `test_name` (optional).
- **Headers:** `x-lantern-test-id` (optional).
- **Response:** `200 OK` with `{"test_id":"<uuid>"}`.

### 3.4 Authentication

The control plane is unauthenticated by default and MUST only be enabled in
non-Production environments. SDKs SHOULD log a warning if enabled in
Production. Operators who need control plane access in a hardened environment
should bind the listener to a private network or front it with auth.

## 4. Collector ingestion API

The Playwright plugin (or any test runner) reports the run lifecycle to the
collector. These endpoints are versioned and authenticated with a bearer API
key obtained via the management UI.

| Method | Path                                 | Purpose                              |
| ------ | ------------------------------------ | ------------------------------------ |
| POST   | `/v1/runs`                           | Create a run for a project/commit.   |
| PATCH  | `/v1/runs/:run_id`                   | Update aggregate counts + status.    |
| POST   | `/v1/runs/:run_id/tests`             | Register one or more tests.          |
| PATCH  | `/v1/runs/:run_id/tests/:test_id`    | Update a single test's status.       |
| POST   | `/v1/coverage`                       | (SDK) ingest coverage event batches. |

All requests use:
- `Authorization: Bearer <api_key>`
- `Content-Type: application/json` (JSON) or `application/x-protobuf`
  (preferred for `/v1/coverage` payload-heavy traffic).

### 4.1 Run schema

```json
{
  "project_id": "uuid",
  "commit_sha": "string",
  "branch": "string",
  "ci_run_id": "string",
  "github_pr_number": 123,
  "attribution_mode": "serialized" | "worker_pinned"
}
```

`attribution_mode` defaults to `serialized`. `worker_pinned` is reserved for
Phase 2.

### 4.2 Test registration schema

```json
{
  "tests": [
    {
      "test_external_id": "uuid v7 (the test_id)",
      "name": "places order",
      "suite": "checkout > orders",
      "file_path": "tests/checkout.spec.ts"
    }
  ]
}
```

### 4.3 Test status update schema

```json
{
  "status": "passed" | "failed" | "skipped",
  "duration_ms": 1234
}
```

## 5. Versioning

This SPEC version is **1**. Coverage event payloads carry an explicit
`schema_version` field (currently `"1"`). Wire-incompatible changes to control
plane endpoints, header semantics, or REST API contracts require a new SPEC
version and an SDK release bump.
