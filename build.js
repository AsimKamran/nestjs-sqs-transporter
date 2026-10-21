// build.js — production bundle
const esbuild = require("esbuild");
const { baseOptions } = require("./build.config");

async function build() {
  console.log("⚡ Bundling with esbuild + SWC decorators...");
  await esbuild.build({
    ...baseOptions,
    entryPoints: ["src/main.ts"],
    minify: true,
    outfile: "dist/main.js",
  });
  console.log("✅ Bundle complete: dist/main.js");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
