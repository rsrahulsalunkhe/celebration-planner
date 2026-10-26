import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Where the built app is served from.
 *
 * The default `./` makes asset URLs relative, so the build works from any
 * folder. With HashRouter all routing lives after the `#`, so no server
 * rewrites are needed either. For a repository subpath such as GitHub Pages
 * project sites, set it explicitly, which also makes asset URLs absolute:
 *
 *   BASE_PATH=/celebration-planner/ npm run build
 */
const base = process.env.BASE_PATH ?? './';
if (!/^(\.\/|\/([\w.-]+\/)*)$/.test(base)) {
  throw new Error(`BASE_PATH must be "./" or a path like "/repo-name/", got "${base}"`);
}

export default defineConfig({
  base,
  plugins: [react()],
  // The local AI worker is an ES module that imports WebLLM.
  worker: { format: 'es' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Page tests type into many fields with user-event; under a full parallel run
    // on a laptop they can pass the 5 s default without anything being wrong.
    testTimeout: 20_000,
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
