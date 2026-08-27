import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend at the project root. In local dev, /api is proxied to the Express
// dev server (npm run dev:api on :4000). In production on Vercel, /api is served
// by the serverless function in api/ — no proxy involved.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
