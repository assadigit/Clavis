/**
 * CLAVIS — dev harness build config (v1.12.0, DECISIONS §53).
 *
 * Builds dev-harness.html — the real Manager running in a plain browser
 * against an in-memory fake store and the mocked Wails runtime — so UI
 * work can be verified visually on machines without Windows/Wails.
 *
 *   bunx vite --config vite.harness.config.ts            # dev server
 *   bunx vite build --config vite.harness.config.ts      # static build → dist-harness/
 *
 * The production build (vite.config.ts) never references any of this.
 * Fake data only — no real secrets, ever.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@wailsio/runtime": fileURLToPath(new URL("./dev-harness/wails-runtime-mock.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-harness",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        harness: fileURLToPath(new URL("./dev-harness.html", import.meta.url)),
      },
    },
    target: "chrome110",
    cssCodeSplit: false,
  },
});
