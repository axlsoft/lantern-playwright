import { describe, expect, it } from "vitest";

import { detectRunMetadata } from "../src/metadata.js";

describe("detectRunMetadata", () => {
  it("prefers explicit overrides", () => {
    const meta = detectRunMetadata(
      { commitSha: "abc", branch: "main", ciRunId: "42", prNumber: 7 },
      { GITHUB_SHA: "ignored" } as NodeJS.ProcessEnv
    );
    expect(meta).toEqual({
      commitSha: "abc",
      branch: "main",
      ciRunId: "42",
      prNumber: 7,
    });
  });

  it("reads GitHub Actions environment variables", () => {
    const meta = detectRunMetadata({}, {
      GITHUB_SHA: "deadbeef",
      GITHUB_REF_NAME: "feature/x",
      GITHUB_RUN_ID: "1234",
      GITHUB_PR_NUMBER: "9",
    } as NodeJS.ProcessEnv);
    expect(meta.commitSha).toBe("deadbeef");
    expect(meta.branch).toBe("feature/x");
    expect(meta.ciRunId).toBe("1234");
    expect(meta.prNumber).toBe(9);
  });

  it("falls back to GIT_COMMIT/GIT_BRANCH (Jenkins)", () => {
    const meta = detectRunMetadata({}, {
      GIT_COMMIT: "cafebabe",
      GIT_BRANCH: "develop",
      BUILD_NUMBER: "55",
    } as NodeJS.ProcessEnv);
    expect(meta.commitSha).toBe("cafebabe");
    expect(meta.branch).toBe("develop");
    expect(meta.ciRunId).toBe("55");
  });

  it("strips refs/heads/ prefix from GITHUB_REF", () => {
    const meta = detectRunMetadata({}, {
      GITHUB_SHA: "x",
      GITHUB_REF: "refs/heads/main",
    } as NodeJS.ProcessEnv);
    expect(meta.branch).toBe("main");
  });
});
