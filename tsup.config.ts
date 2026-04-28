import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    fixture: "src/fixture.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  outDir: "dist",
});
