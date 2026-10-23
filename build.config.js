// Shared esbuild settings for production (build.js) and local runs (scripts/run-local.js)
const swc = require("@swc/core");
const fs = require("node:fs/promises");

/** Transforms .ts with SWC so legacy decorators + design:paramtypes metadata work (needed by Nest DI). */
const swcDecorators = {
  name: "swc-decorators",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      if (args.path.includes("node_modules")) return undefined;
      const source = await fs.readFile(args.path, "utf8");
      const { code } = await swc.transform(source, {
        filename: args.path,
        sourceMaps: "inline",
        jsc: {
          target: "es2022",
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          keepClassNames: true,
        },
        module: { type: "es6" },
      });
      return { contents: code, loader: "js" };
    });
  },
};

/**
 * Nest lazily requires optional transports (nats, kafka, mqtt...). When one of them is not
 * installed, mark it external instead of failing the bundle. It is only loaded at runtime if
 * that transport is actually used. Unresolved imports in YOUR code still fail the build.
 */
const optionalNestDeps = {
  name: "optional-nest-deps",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.pluginData?.skipOptional) return undefined;
      if (!/node_modules[\\/]@nestjs[\\/]/.test(args.importer))
        return undefined;
      const r = await build.resolve(args.path, {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind,
        pluginData: { skipOptional: true },
      });
      if (r.errors.length) return { path: args.path, external: true };
      if (r.external) return { path: r.path, external: true }; // Node built-ins (stream, fs...) and listed externals
      return {
        path: r.path,
        namespace: r.namespace,
        sideEffects: r.sideEffects,
        suffix: r.suffix,
      };
    });
  },
};

const external = [
  // AWS SDK v3 ships with the Lambda Node 18+ runtime
  "@aws-sdk/*",
  // Optional Nest transports / adapters that are lazily required and unused
  "@nestjs/websockets",
  "@nestjs/microservices/microservices-module",
  "@nestjs/platform-express",
  "fastify",
  "amqplib",
  "amqp-connection-manager",
  "kafkajs",
  "mqtt",
  "nats",
  "@nats-io/*",
  "redis",
  "ioredis",
  "grpc",
  "@grpc/grpc-js",
  "@grpc/proto-loader",
];

// Output is CommonJS: esbuild converts ESM-only dependencies (like Nest 12) while bundling.
const baseOptions = {
  bundle: true,
  keepNames: true,
  sourcemap: true,
  legalComments: "none",
  platform: "node",
  format: "cjs",
  target: "node22",
  plugins: [optionalNestDeps, swcDecorators],
  external,
};

module.exports = { baseOptions };
