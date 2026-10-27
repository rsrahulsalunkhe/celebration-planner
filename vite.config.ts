import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
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

/**
 * Content-Security-Policy for the built app (the dev server needs inline
 * scripts, so it is added to the build only). Scripts come only from this
 * site; 'wasm-unsafe-eval' lets the local AI compile its WebAssembly; network
 * requests may go only to this site and the fixed model hosts. The model
 * worker's own downloads follow the policy of the worker's response headers.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://raw.githubusercontent.com",
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: CONTENT_SECURITY_POLICY,
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  base,
  plugins: [react(), contentSecurityPolicy],
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
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      // The project's own goal for the core planning logic (not an external requirement).
      thresholds: { 'src/domain/planning/**': { branches: 85 } },
    },
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
