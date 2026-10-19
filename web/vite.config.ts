// The browser frontend: vp dev serves it on http://localhost:5173 and sends /api to the app on 8080
// (npm run dev in the repository root); vp build writes it to ../public, which the app serves at /.
// vp check formats, lints and type-checks it (the image build runs it).
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: { outDir: "../public", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8080" } },
  lint: { options: { typeAware: true, typeCheck: true } },
});
