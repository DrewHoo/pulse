import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// The repo name is the URL path under drewhoover.com, so the base path derives
// from it. In dev, the worker runs beside Vite (`npm run dev:worker`) and the
// proxy keeps the API same-origin, as it is in production.
export default defineConfig({
  base: `/${pkg.name}/`,
  server: { proxy: { [`/${pkg.name}/api`]: 'http://localhost:8787' } },
  build: { target: 'es2022' },
});
