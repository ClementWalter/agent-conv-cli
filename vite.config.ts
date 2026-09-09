/** Serve a single-origin production application so sessions need no cross-origin exceptions. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/public", emptyOutDir: true },
});
