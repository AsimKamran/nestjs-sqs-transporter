// Runs a TypeScript script from /scripts through the same esbuild + SWC pipeline as production.
//   node scripts/run-local.js local-sqs --watch   -> emulator with auto-reload
//   node scripts/run-local.js test-local          -> one-shot test
const esbuild = require("esbuild");
const { spawn } = require("node:child_process");
const { baseOptions } = require("../build.config");

const [entry, flag] = process.argv.slice(2);
if (!entry) {
  console.error("Usage: node scripts/run-local.js <local-sqs|test-local> [--watch]");
  process.exit(1);
}
const watch = flag === "--watch";
const outfile = `.dev/${entry}.js`;
let child;

function run() {
  if (child) child.kill();
  child = spawn(process.execPath, ["--enable-source-maps", "--env-file=.env", outfile], { stdio: "inherit" });
  child.on("exit", (code) => {
    if (!watch) process.exit(code ?? 0);
  });
}

const restart = {
  name: "restart",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      if (watch) console.log("🔄 Rebuilt, restarting...");
      run();
    });
  },
};

process.on("SIGINT", () => {
  if (child) child.kill();
  process.exit(0);
});

(async () => {
  const ctx = await esbuild.context({
    ...baseOptions,
    entryPoints: [`scripts/${entry}.ts`],
    outfile,
    minify: false,
    plugins: [...baseOptions.plugins, restart],
  });
  if (watch) {
    await ctx.watch();
    console.log("👀 Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});