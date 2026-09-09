import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: ".",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4100",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
