import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Clavis frontend build: two entries (popup, manager) sharing everything.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./popup.html", import.meta.url)),
        manager: fileURLToPath(new URL("./manager.html", import.meta.url)),
      },
    },
    target: "chrome110", // WebView2 (Evergreen) baseline
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // fonts inline: fully offline single origin
  },
});
