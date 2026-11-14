import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  base: "./",
  plugins: [
    viteSingleFile(),
    {
      name: "serve-source-index",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const raw = req.url ?? "/";
          const q = raw.indexOf("?");
          const path = q === -1 ? raw : raw.slice(0, q);
          const search = q === -1 ? "" : raw.slice(q);
          if (path === "/" || path === "/index.html") req.url = `/index.source.html${search}`;
          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: { index: resolve("index.source.html") },
    },
  },
  server: { host: "127.0.0.1", port: 43127, strictPort: true },
  preview: { host: "127.0.0.1", port: 43127, strictPort: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 90_000,
  },
});
