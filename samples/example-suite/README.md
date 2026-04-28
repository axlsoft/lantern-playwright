# Lantern Playwright — example-suite

End-to-end sample wiring the `@lantern/playwright` reporter and fixture against
the .NET SDK's `SampleApi`. Functions both as documentation and as a CI smoke
test for the Phase 1.3 plugin.

## What it does

1. Brings up Postgres, the Lantern collector, and the .NET `SampleApi` via
   `docker compose`.
2. Runs `scripts/bootstrap.sh` to seed an organization, project, and API key
   into the collector and write the credentials to `.env`.
3. Executes a small Playwright suite that exercises the `SampleApi`'s endpoints.
4. Verifies that per-test coverage events show up in the collector, attributed
   to the correct test_id.

## Quick start

```bash
cd repos/lantern-playwright/samples/example-suite
docker compose up -d --wait
./scripts/bootstrap.sh
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test --workers=1
```

## Files

| Path                       | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `compose.yaml`             | Postgres + collector + sample API + MailHog.  |
| `playwright.config.ts`     | Wires the Lantern reporter to the collector.  |
| `tests/`                   | Six example tests (API + browser flows).      |
| `scripts/bootstrap.sh`     | Seeds org/project/API key, writes `.env`.     |
| `package.json`             | Pnpm workspace project for the sample.        |

## Single-worker recommendation

Until Phase 2's worker-pinned attribution lands, use `--workers=1` for clean
per-test attribution. Parallel runs still work (events still arrive at the
collector) but coverage attribution between concurrent tests is interleaved.
