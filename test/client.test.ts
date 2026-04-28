import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectorClient, SdkControlClient, fetchWithRetry, type Logger } from "../src/client.js";

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

interface MockServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

async function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void
): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(",") : (v ?? ""),
          ])
        ),
      });
      handler(req, res, body);
    });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || !addr) throw new Error("no address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const silentLogger: Logger = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

describe("fetchWithRetry", () => {
  let server: MockServer | null = null;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it("returns 4xx without retry", async () => {
    let calls = 0;
    server = await startMockServer((_req, res) => {
      calls++;
      res.statusCode = 404;
      res.end();
    });
    const res = await fetchWithRetry(server.url, { method: "GET" }, { maxTotalMs: 1000 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    let calls = 0;
    server = await startMockServer((_req, res) => {
      calls++;
      if (calls < 3) {
        res.statusCode = 503;
      } else {
        res.statusCode = 200;
      }
      res.end();
    });
    const res = await fetchWithRetry(
      server.url,
      { method: "GET" },
      { maxTotalMs: 5000, initialDelayMs: 5, maxDelayMs: 10 }
    );
    expect(res.status).toBe(200);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("throws when retry budget exhausted", async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    await expect(
      fetchWithRetry(
        server.url,
        { method: "GET" },
        { maxTotalMs: 200, initialDelayMs: 50, maxDelayMs: 50 }
      )
    ).rejects.toThrow();
  });
});

describe("SdkControlClient", () => {
  let server: MockServer | null = null;
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it("calls /test/start on every target", async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 200;
      res.end("{}");
    });
    const client = new SdkControlClient(
      [
        { name: "a", url: server.url },
        { name: "b", url: server.url },
      ],
      silentLogger,
      { maxTotalMs: 500 }
    );
    await client.startTest("test-1", "places order");
    expect(server.requests.length).toBe(2);
    expect(server.requests[0].url).toContain("/_lantern/test/start");
    expect(server.requests[0].url).toContain("test_id=test-1");
    expect(server.requests[0].headers["x-lantern-test-id"]).toBe("test-1");
  });

  it("fail-open: unreachable target does not throw", async () => {
    const client = new SdkControlClient(
      [{ name: "dead", url: "http://127.0.0.1:1" }],
      silentLogger,
      { maxTotalMs: 100, initialDelayMs: 10, maxDelayMs: 10, attemptTimeoutMs: 50 }
    );
    await expect(client.startTest("t", "n")).resolves.toBeUndefined();
  });
});

describe("CollectorClient", () => {
  let server: MockServer | null = null;
  beforeEach(() => {
    silentLogger.error = vi.fn();
  });
  afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  it("createRun POSTs the expected payload", async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { id: "run-1", project_id: "p", commit_sha: "c" } }));
    });
    const c = new CollectorClient({
      endpoint: server.url,
      apiKey: "key",
      logger: silentLogger,
    });
    const run = await c.createRun({
      projectId: "p",
      commitSha: "c",
      branch: "main",
      attributionMode: "serialized",
    });
    expect(run?.id).toBe("run-1");
    const req = server.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/v1/runs");
    expect(req.headers["authorization"]).toBe("Bearer key");
    const body = JSON.parse(req.body);
    expect(body.project_id).toBe("p");
    expect(body.attribution_mode).toBe("serialized");
  });

  it("registerTests returns the array from the response", async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: [{ id: "t-1", test_external_id: "ext-1" }],
        })
      );
    });
    const c = new CollectorClient({
      endpoint: server.url,
      apiKey: "key",
      logger: silentLogger,
    });
    const out = await c.registerTests("run-1", [
      { testExternalId: "ext-1", name: "n", suite: "s", filePath: "f" },
    ]);
    expect(out).toEqual([{ id: "t-1", test_external_id: "ext-1" }]);
  });

  it("createRun returns null on 4xx without throwing", async () => {
    server = await startMockServer((_req, res) => {
      res.statusCode = 400;
      res.end("bad");
    });
    const c = new CollectorClient({
      endpoint: server.url,
      apiKey: "key",
      logger: silentLogger,
    });
    const run = await c.createRun({ projectId: "p", commitSha: "c" });
    expect(run).toBeNull();
  });
});
