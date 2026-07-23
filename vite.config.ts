import devServer from "@hono/vite-dev-server"
import path from "path"
import fs from "fs"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

/* The marketing site lives in public/ and is served from source by the Hono
   server (see api/boot.ts) — no build-time copy. Vite's publicDir copy races on
   this filesystem (EEXIST / dropped files), so dist/public holds ONLY the SPA
   bundle (portal.html + assets). We do write one tiny file: index.html (the
   branded 404 page) which the server's notFound fallback serves. */
const writeNotFoundPage = () => ({
  name: "write-notfound-page",
  apply: "build" as const,
  closeBundle() {
    const src = path.resolve(__dirname, "public/404.html");
    const dest = path.resolve(__dirname, "dist/public/index.html");
    fs.copyFileSync(src, dest);
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react(), writeNotFoundPage()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    copyPublicDir: false, // handled by copyPublicDir() plugin above (mount-safe)
    rollupOptions: {
      input: { portal: path.resolve(__dirname, "portal.html") },
    },
  },
});
