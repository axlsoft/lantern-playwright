import { execSync } from "node:child_process";

/**
 * Run-level metadata describing the build under test. Phase 1.3 auto-detects
 * these from common CI environment variables; users may pass overrides via
 * reporter options.
 */
export interface RunMetadata {
  branch?: string;
  commitSha?: string;
  ciRunId?: string;
  prNumber?: number;
}

function tryGitCommit(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .toLowerCase();
  } catch {
    return undefined;
  }
}

function tryGitBranch(): string | undefined {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function parseInteger(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Auto-detects run metadata from CI environment variables, falling back to
 * the local git repository state. Order of precedence: explicit overrides,
 * GitHub Actions, Jenkins, GitLab, local git.
 */
export function detectRunMetadata(
  override: RunMetadata = {},
  env: NodeJS.ProcessEnv = process.env
): RunMetadata {
  const out: RunMetadata = { ...override };

  if (!out.commitSha) {
    out.commitSha = env.GITHUB_SHA || env.GIT_COMMIT || env.CI_COMMIT_SHA || tryGitCommit();
  }

  if (!out.branch) {
    // GITHUB_REF for pull_request events looks like "refs/pull/N/merge"; for
    // pushes it's "refs/heads/<branch>". GITHUB_HEAD_REF holds the source
    // branch on PRs. Prefer it when present.
    const ghRef = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GITHUB_REF;
    out.branch = ghRef || env.GIT_BRANCH || env.CI_COMMIT_REF_NAME || tryGitBranch();
    if (out.branch?.startsWith("refs/heads/")) {
      out.branch = out.branch.slice("refs/heads/".length);
    }
  }

  if (!out.ciRunId) {
    out.ciRunId = env.GITHUB_RUN_ID || env.BUILD_NUMBER || env.CI_PIPELINE_ID;
  }

  if (out.prNumber === undefined) {
    out.prNumber =
      parseInteger(env.GITHUB_PR_NUMBER) ??
      parseInteger(env.PR_NUMBER) ??
      parseInteger(env.CHANGE_ID);
  }

  return out;
}
