import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs keep the same build portable between localhost and
  // this repository's GitHub Pages subdirectory.
  base: "./",
  build: {
    // The lazily loaded Three.js scene is ~522 kB minified (~134 kB gzip).
    // Keep the warning threshold just above that audited vendor-heavy chunk.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        map: resolve(import.meta.dirname, "map.html"),
      },
    },
  },
});
