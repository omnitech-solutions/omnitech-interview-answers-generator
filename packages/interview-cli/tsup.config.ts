import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  tsconfig: "tsconfig.types.json",
  noExternal: [
    "@omnitech/interview-api-client",
    "@omnitech/interview-contracts",
    "@omnitech/interview-playground-control",
  ],
});
