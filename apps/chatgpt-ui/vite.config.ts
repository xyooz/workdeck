import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: appRoot,
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
  build: {
    emptyOutDir: true,
    outDir: "dist",
    lib: {
      entry: "src/component.ts",
      formats: ["es"],
      fileName: () => "component.js",
    },
  },
});
