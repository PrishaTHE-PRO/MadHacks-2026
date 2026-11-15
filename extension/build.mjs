// Bundles the extension into dist/. `node build.mjs --watch` rebuilds on save.
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });

// Photo privacy runs fully on the device, and extensions can't load code from
// the internet, so the WASM engines and model data ship inside the extension.
// Find a package folder in node_modules (some packages don't export package.json).
const pkgDir = (name) => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) throw new Error(`Can't find ${name}. Run npm install.`);
  }
};
const copy = (from, to) => {
  mkdirSync(dirname(join("dist", to)), { recursive: true });
  cpSync(from, join("dist", to));
};
const mediapipe = join(pkgDir("@mediapipe/tasks-vision"), "wasm");
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
  copy(join(mediapipe, f), `vendor/mediapipe/${f}`);
copy(join(pkgDir("tesseract.js"), "dist/worker.min.js"), "vendor/tesseract/worker.min.js");
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"])
  copy(join(pkgDir("tesseract.js-core"), f), `vendor/tesseract-core/${f}`);
copy(join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"), "vendor/tessdata/eng.traineddata.gz");

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/main.ts",
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
