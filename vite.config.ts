import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import pkg from './package.json' with { type: 'json' };

// The repo name is the URL path under drewhoover.com, so the base path derives
// from it. In dev, Vite's proxy keeps the API same-origin, as it is in
// production, and sends the worker's token itself, so a local page needs no
// ?k=:
//
//   npm run dev       the worker running beside Vite (`npm run dev:worker`),
//                     with the token in worker/.dev.vars
//   npm run dev:live  the deployed worker at drewhoover.com, with the token in
//                     .env's PULSE_URL. It reads the live worker's cache, so it
//                     spends no Mixpanel calls of its own.
const devVarsToken = () => {
  try {
    return /^PULSE_TOKEN=(.*)$/m.exec(readFileSync('worker/.dev.vars', 'utf8'))?.[1]?.trim().replace(/^"|"$/g, '');
  } catch {
    return undefined;
  }
};
const liveToken = (mode: string) => {
  const url = loadEnv(mode, process.cwd(), '').PULSE_URL;
  return url ? new URL(url).searchParams.get('k') ?? undefined : undefined;
};

export default defineConfig(({ mode }) => {
  const live = mode === 'live';
  const token = live ? liveToken(mode) : devVarsToken();
  return {
    base: `/${pkg.name}/`,
    server: {
      proxy: {
        [`/${pkg.name}/api`]: {
          target: live ? 'https://drewhoover.com' : 'http://localhost:8787',
          changeOrigin: true,
          headers: token ? { authorization: `Bearer ${token}` } : {},
        },
      },
    },
    build: { target: 'es2022' },
  };
});
