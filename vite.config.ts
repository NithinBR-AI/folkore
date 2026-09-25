import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT = process.env.INPUT;
if (!INPUT) {
  throw new Error("INPUT environment variable is not set");
}

const isDevelopment = process.env.NODE_ENV === "development";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: path.resolve(__dirname, "src/client"),
  build: {
    sourcemap: isDevelopment ? "inline" : undefined,
    cssMinify: !isDevelopment,
    minify: !isDevelopment,
    rollupOptions: {
      input: path.resolve(__dirname, "src/client", INPUT),
    },
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: false,
  },
});
