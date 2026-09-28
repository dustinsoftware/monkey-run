import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this project site under /<repo>/, so builds set there
  // via PAGES_BASE (see .github/workflows/deploy.yml). Local dev stays at /.
  base: process.env.PAGES_BASE ?? '/',
  server: { port: 5173, strictPort: true },
});
