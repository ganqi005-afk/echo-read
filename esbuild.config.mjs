import esbuild from "esbuild";
import process from "node:process";

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  format: "cjs",
  // 默认的 ascii 会把中文全部转义成 \uXXXX，产物又大又不可搜索
  charset: "utf8",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
