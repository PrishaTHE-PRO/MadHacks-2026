// Bundles the extension into dist/. `node build.mjs --watch` rebuilds on save.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });

const options = {
  entryPoints: {
    background: "src/background.ts",
    "content-poshmark": "src/content/poshmark.ts",
    sidepanel: "src/sidepanel/main.tsx",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching… reload the extension in chrome://extensions after changes.");
} else {
  await esbuild.build(options);
}
