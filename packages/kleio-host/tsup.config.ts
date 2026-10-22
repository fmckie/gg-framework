import { defineConfig } from "tsup";
import { kleioVersionDefine } from "./kleio-version.ts";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: { entry: "src/index.ts" },
  clean: true,
  sourcemap: true,
  target: "node22",
  define: kleioVersionDefine(),
});
