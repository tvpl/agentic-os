import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev only: the API server injects the local token into index.html when it
 * serves the built app. `vite dev` serves index.html itself, so inject the
 * token from <repo>/config/token here to avoid 401s through the proxy.
 */
function devToken(): Plugin {
  return {
    name: "mordomo-dev-token",
    apply: "serve",
    transformIndexHtml(html) {
      try {
        const token = readFileSync(path.resolve(here, "../../config/token"), "utf8").trim();
        if (!token) return html;
        return html.replace(
          /<meta name="mordomo-token" content=""\s*\/?>/,
          `<meta name="mordomo-token" content="${token}" />`,
        );
      } catch {
        return html; // no token yet (setup not run): leave the tag empty
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), devToken()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4777", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rolldownOptions: {
      // Two pages: the Command Centre and the component gallery (visual-regression surface).
      input: { main: path.resolve(here, "index.html"), gallery: path.resolve(here, "gallery.html") },
      output: {
        // One long-lived vendor chunk; routes are lazy so the main chunk stays small.
        codeSplitting: {
          groups: [
            {
              name: "vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@tanstack)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
