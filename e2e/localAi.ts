import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const FAKE_SDK = fileURLToPath(new URL('./fakes/fake-webllm.js', import.meta.url));

export interface FakeLocalAiOptions {
  /** `false`: the browser offers no WebGPU, so local AI is unsupported. */
  gpu?: boolean;
  /** Loading fails with this message. */
  failLoad?: string;
  /** Loading never finishes, so it can be stopped. */
  holdLoad?: boolean;
  /** Delay before each streamed piece of a reply. */
  replyDelayMs?: number;
}

export interface FakeLocalAiCalls {
  loads: number;
  generations: number;
  interrupts: number;
  unloads: number;
  deletes: number;
}

/**
 * Replaces the WebLLM SDK and worker chunks with a stand-in, and gives the
 * page a pretend WebGPU adapter and plenty of storage. This tests the app's
 * handling of the local AI adapter; it is not a test of a model.
 */
export async function useFakeLocalAi(page: Page, options: FakeLocalAiOptions = {}) {
  await page.addInitScript((opts) => {
    const state = {
      gpu: opts.gpu ?? true,
      failLoad: opts.failLoad ?? null,
      holdLoad: opts.holdLoad ?? false,
      replyDelayMs: opts.replyDelayMs ?? 5,
      calls: { loads: 0, generations: 0, interrupts: 0, unloads: 0, deletes: 0 },
    };
    Object.assign(window, { __fakeLocalAi: state });
    const adapter = {
      features: new Set(['shader-f16']),
      limits: {},
      info: { vendor: 'stand-in', architecture: 'test', description: '' },
    };
    const gpu = state.gpu
      ? { requestAdapter: () => Promise.resolve(adapter) }
      : undefined;
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => gpu,
    });
    Object.defineProperty(StorageManager.prototype, 'estimate', {
      configurable: true,
      value: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }),
    });
  }, options);
  await page.route('**/assets/lib-*.js', (route) =>
    route.fulfill({ path: FAKE_SDK, contentType: 'text/javascript' }),
  );
  await page.route('**/assets/worker-*.js', (route) =>
    route.fulfill({
      body: '// Stand-in worker: the stand-in SDK never uses it.\n',
      contentType: 'text/javascript',
    }),
  );
  await page.route('https://huggingface.co/**/ndarray-cache.json', (route) =>
    route.fulfill({
      json: { records: [{ nbytes: 500_000_000 }, { nbytes: 368_547_584 }] },
    }),
  );
}

export function fakeCalls(page: Page): Promise<FakeLocalAiCalls> {
  return page.evaluate(
    () =>
      (window as unknown as { __fakeLocalAi: { calls: FakeLocalAiCalls } }).__fakeLocalAi
        .calls,
  );
}
