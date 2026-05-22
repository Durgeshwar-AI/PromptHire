import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars so the dev proxy target can be configured via .env.* files
  const env = loadEnv(mode, process.cwd(), "");
  const devBackend = env.VITE_DEV_BACKEND || "http://localhost:5000";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: devBackend,
          changeOrigin: true,
        },
      },
    },
  };
});
