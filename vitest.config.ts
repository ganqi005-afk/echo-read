import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify("test-build") },
  resolve: {
    alias: {
      // 单元测试里不需要真实的 Obsidian 运行时，用最小桩替代即可
      obsidian: fileURLToPath(new URL("./tests/stubs/obsidian.ts", import.meta.url)),
    },
  },
});
