import "dotenv/config";
import { defineConfig } from "@playwright/test";

const collectorEndpoint = process.env.LANTERN_COLLECTOR_ENDPOINT ?? "http://localhost:8080";
const apiKey = process.env.LANTERN_API_KEY ?? "";
const projectId = process.env.LANTERN_PROJECT_ID ?? "";
const sampleApiUrl = process.env.SAMPLE_API_URL ?? "http://localhost:5080";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "@lantern/playwright",
      {
        collectorEndpoint,
        apiKey,
        projectId,
        targetServices: [{ name: "sample-api", url: sampleApiUrl }],
      },
    ],
  ],
  use: {
    baseURL: sampleApiUrl,
  },
});
