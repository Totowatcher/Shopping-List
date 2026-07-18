import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

let apiProxyHelpPrinted = false;

export default defineConfig({
  base: "/shop/",
  plugins: [react()],
  server: {
    port: 5175,
    host: true,
    allowedHosts: true,
    proxy: {
      "/shop/api": {
        target: "http://127.0.0.1:8004",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/shop/, ""),
        configure(proxy) {
          proxy.on("error", () => {
            if (apiProxyHelpPrinted) return;
            apiProxyHelpPrinted = true;
            console.warn(
              "\n[Vite] /shop/api proxy cannot reach http://127.0.0.1:8004 " +
                "— is the backend running? (cd web/backend && uvicorn app.main:app --port 8004)\n"
            );
          });
        },
      },
    },
  },
});
