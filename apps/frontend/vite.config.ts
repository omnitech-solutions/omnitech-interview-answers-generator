import { defineConfig } from "vite";
export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' blob:",
    },
    proxy: {
      "/api": {
        target: process.env["ASSISTANT_API_ORIGIN"] ?? "http://127.0.0.1:8791",
        changeOrigin: false,
      },
    },
  },
  build: { target: "es2022" },
});
