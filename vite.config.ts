import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    watch: {
      // data/ holds ~111k extracted dataset files; watching them stalls startup
      ignored: ["**/data/**", "**/db/**", "**/server/**"],
    },
    proxy: {
      // Kept in lockstep with the API port in server-node/index.js (API_PORT, default 8000).
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT || 8000}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
