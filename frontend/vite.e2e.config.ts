/**
 * CLAVIS — vite config for the browser e2e bundle (dev tool, not shipped).
 *
 * Same build as the desktop frontend, except @wailsio/runtime is aliased to
 * the fetch shim (e2e-shim.ts) so the bundle can run in a plain browser
 * against the Go e2e bridge (tools/e2e-bridge). Build:
 *
 *   cd frontend && bunx vite build --config vite.e2e.config.ts
 *   go run ./tools/e2e-bridge        # serves dist-e2e + the real store on :8093
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
      // The ONLY difference from the desktop build: the Wails runtime
      // becomes a same-origin fetch shim.
      "@wailsio/runtime": fileURLToPath(new URL("./e2e-shim.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-e2e",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./popup.html", import.meta.url)),
        manager: fileURLToPath(new URL("./manager.html", import.meta.url)),
      },
    },
    target: "chrome110",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
