import { defineConfig } from "vitest/config";
import { kleioVersionDefine } from "./kleio-version.ts";

export default defineConfig({
  define: kleioVersionDefine(),
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
