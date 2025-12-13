import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  server: {
    watch: {
      ignored: ["**/repos/**", "**/node_modules/**"],
    },
  },
  build: {
    rollupOptions: {
      external: [/^repos\//],
    },
  },
  optimizeDeps: {
    exclude: ["repos"],
  },
});
