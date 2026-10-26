import type { InitProgressReport } from '@mlc-ai/web-llm';
import { describe, expect, it, vi } from 'vitest';
import { PLANNING_CONFIGURATION } from '@/data/planning/index.ts';
import { applyOperations } from '@/domain/editEvent.ts';
import { startingBudgetOperations } from '@/domain/planning/budget.ts';
import { startingTimelineOperations } from '@/domain/planning/timeline.ts';
import type { EventRecord } from '@/domain/types.ts';
import { TODAY, presetEvent } from '@/test/helpers.ts';
import packageJson from '../../../../package.json';
import type { AssistantRequest } from '../assistant.ts';
import { buildContextSnapshot } from '../context.ts';
import { checkCapability, type CapabilityEnvironment } from './capability.ts';
import {
  LocalModelController,
  type EngineLike,
  type LocalModelDependencies,
  type WebLlmSdk,
} from './localModel.ts';
import { LocalAIProvider, classifyForModel } from './localProvider.ts';
import { CONTEXT_WINDOW_TOKENS, LOCAL_MODEL, WEBLLM_SDK_VERSION } from './model.ts';
import {
  MAX_PROMPT_CHARS,
  cleanInvitation,
  ideasPrompt,
  parseIdeas,
  ungroundedFigures,
} from './prompts.ts';

/*
 * These tests use a fake SDK and engine. They check the lifecycle, routing
 * and validation logic. They do NOT show that real inference works; that was
 * checked separately in a browser (see docs/BUILD_PROGRESS.md).
 */

const CONFIG = PLANNING_CONFIGURATION;

function planned(id: 'wedding' | 'birthday' | 'community' = 'wedding'): EventRecord {
  const record = presetEvent(id);
  const a = applyOperations(record, startingBudgetOperations(record, CONFIG, TODAY));
  if (!a) throw new Error('fixture');
  const b = applyOperations(a, startingTimelineOperations(a, CONFIG, TODAY));
  if (!b) throw new Error('fixture');
  return b;
}

function env(overrides: Partial<CapabilityEnvironment> = {}): CapabilityEnvironment {
  return {
    isSecureContext: true,
    hasWorker: true,
    gpu: {
      requestAdapter: () =>
        Promise.resolve({
          features: new Set(['shader-f16']),
          limits: {},
          info: { vendor: 'test-vendor', architecture: 'test-arch' },
        }),
    },
    deviceMemoryGb: 8,
    storageEstimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }),
    ...overrides,
  };
}

interface Chunk {
  choices: { delta: { content?: string | null }; finish_reason?: string | null }[];
}

function streamOf(parts: string[], interrupted?: () => boolean): AsyncIterable<Chunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        await Promise.resolve();
        if (interrupted?.()) {
          yield { choices: [{ delta: {}, finish_reason: 'abort' }] };
          return;
        }
        yield { choices: [{ delta: { content: part } }] };
      }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    },
  };
}

class FakeWorker {
  terminated = false;
  terminate() {
    this.terminated = true;
  }
}

function harness(
  options: {
    environment?: CapabilityEnvironment;
    load?: () => Promise<void>;
    reply?: (request: { max_tokens: number }) => string[];
    failGenerate?: Error;
  } = {},
) {
  let interrupted = false;
  const engine: EngineLike = {
    interruptGenerate: vi.fn(() => {
      interrupted = true;
    }),
    unload: vi.fn(() => Promise.resolve()),
    chatCompletion: vi.fn((request: { max_tokens: number }) => {
      interrupted = false;
      if (options.failGenerate) return Promise.reject(options.failGenerate);
      return Promise.resolve(
        streamOf(options.reply?.(request) ?? ['Hello', ' there'], () => interrupted),
      );
    }),
  };
  const workers: FakeWorker[] = [];
  const sdk: WebLlmSdk = {
    CreateWebWorkerMLCEngine: vi.fn(
      async (
        _worker: Worker,
        _id: string,
        config: { initProgressCallback: (report: InitProgressReport) => void },
      ) => {
        config.initProgressCallback({
          progress: 0.42,
          text: 'Fetching param cache',
          timeElapsed: 3,
        });
        await (options.load?.() ?? Promise.resolve());
        return engine;
      },
    ),
    hasModelInCache: vi.fn(() => Promise.resolve(false)),
    deleteModelAllInfoInCache: vi.fn(() => Promise.resolve()),
    prebuiltAppConfig: {
      model_list: [
        {
          model_id: LOCAL_MODEL.ids.f16,
          model: 'https://huggingface.co/mlc-ai/test-f16',
        },
        {
          model_id: LOCAL_MODEL.ids.f32,
          model: 'https://huggingface.co/mlc-ai/test-f32',
        },
      ],
    },
  };
  const deps: LocalModelDependencies = {
    loadSdk: vi.fn(() => Promise.resolve(sdk)),
    createWorker: vi.fn(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }),
    environment: () => options.environment ?? env(),
    fetchJson: vi.fn(() =>
      Promise.resolve({ records: [{ nbytes: 500_000_000 }, { nbytes: 368_547_584 }] }),
    ),
  };
  return { controller: new LocalModelController(deps), deps, sdk, engine, workers };
}

describe('the chosen model and SDK', () => {
  it('pins the SDK version that is installed', () => {
    expect(packageJson.dependencies['@mlc-ai/web-llm']).toBe(WEBLLM_SDK_VERSION);
  });

  it('uses model IDs that exist in the installed SDK’s prebuilt list', async () => {
    const sdk = await import('@mlc-ai/web-llm');
    const ids = sdk.prebuiltAppConfig.model_list.map((m) => m.model_id);
    expect(ids).toContain(LOCAL_MODEL.ids.f16);
    expect(ids).toContain(LOCAL_MODEL.ids.f32);
    const record = sdk.prebuiltAppConfig.model_list.find(
      (m) => m.model_id === LOCAL_MODEL.ids.f16,
    );
    expect(record?.model).toBe(LOCAL_MODEL.source);
    expect(record?.low_resource_required).toBe(true);
    expect(CONTEXT_WINDOW_TOKENS).toBeLessThanOrEqual(
      record?.overrides?.context_window_size ?? 0,
    );
  });
});

describe('capability check', () => {
  it('passes on a capable device and picks the f16 build when shader-f16 is supported', async () => {
    const result = await checkCapability(env(), 1_000_000);
    expect(result).toMatchObject({
      ok: true,
      variant: 'f16',
      adapter: 'test-vendor test-arch',
    });
  });

  it('falls back to the f32 build without shader-f16', async () => {
    const result = await checkCapability(
      env({
        gpu: {
          requestAdapter: () =>
            Promise.resolve({ features: new Set<string>(), limits: {} }),
        },
      }),
      1,
    );
    expect(result.variant).toBe('f32');
  });

  it.each([
    ['no WebGPU', { gpu: undefined }, /does not offer WebGPU/],
    ['an insecure page', { isSecureContext: false }, /secure pages/],
    [
      'no adapter',
      { gpu: { requestAdapter: () => Promise.resolve(null) } },
      /no graphics adapter/,
    ],
    [
      'too little storage',
      { storageEstimate: () => Promise.resolve({ quota: 100, usage: 50 }) },
      /enough storage/,
    ],
  ])('reports %s as unsupported', async (_label, overrides, reason) => {
    const result = await checkCapability(env(overrides), 1_000_000);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(reason);
  });

  it('warns, without blocking, when the device reports little memory', async () => {
    const result = await checkCapability(env({ deviceMemoryGb: 2 }), 1);
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/about 2 GB of memory/);
  });
});

describe('lifecycle', () => {
  it('loads nothing until the device check is asked for', async () => {
    const { controller, deps } = harness();
    expect(controller.getStatus()).toEqual({ kind: 'idle' });
    expect(deps.loadSdk).not.toHaveBeenCalled();
    expect(deps.createWorker).not.toHaveBeenCalled();
    await controller.checkDevice();
    expect(deps.loadSdk).toHaveBeenCalledTimes(1);
    expect(deps.createWorker).not.toHaveBeenCalled();
    expect(controller.getStatus()).toMatchObject({
      kind: 'ready-to-download',
      estimate: {
        verifiedBytes: 868_547_584,
        cached: false,
        modelId: LOCAL_MODEL.ids.f16,
      },
    });
  });

  it('shows no size when the manifest cannot be read, rather than inventing one', async () => {
    const { controller, deps } = harness();
    vi.mocked(deps.fetchJson).mockRejectedValueOnce(new Error('offline'));
    await controller.checkDevice();
    expect(controller.getStatus()).toMatchObject({ estimate: { verifiedBytes: null } });
  });

  it('becomes unsupported without loading the SDK when the device cannot run it', async () => {
    const { controller, deps } = harness({ environment: env({ gpu: undefined }) });
    await controller.checkDevice();
    expect(controller.getStatus().kind).toBe('unsupported');
    expect(deps.loadSdk).not.toHaveBeenCalled();
  });

  it('downloads with progress and becomes ready', async () => {
    const { controller, sdk } = harness();
    await controller.checkDevice();
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.getStatus().kind));
    await controller.download();
    expect(seen).toContain('downloading');
    expect(controller.getStatus()).toEqual({
      kind: 'ready',
      modelId: LOCAL_MODEL.ids.f16,
    });
    expect(vi.mocked(sdk.CreateWebWorkerMLCEngine).mock.calls[0]?.[3]).toEqual({
      context_window_size: CONTEXT_WINDOW_TOKENS,
    });
  });

  it('stops a download by ending its worker, and ignores the late result', async () => {
    let finish: () => void = () => undefined;
    const { controller, workers, engine } = harness({
      load: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    await controller.checkDevice();
    const loading = controller.download();
    await Promise.resolve();
    expect(controller.getStatus()).toMatchObject({ kind: 'downloading', progress: 0.42 });
    controller.stop();
    expect(workers[0]?.terminated).toBe(true);
    expect(controller.getStatus()).toMatchObject({ kind: 'stopped' });
    finish();
    await loading;
    expect(controller.getStatus().kind).toBe('stopped');
    expect(engine.unload).toHaveBeenCalled();
  });

  it('reports a failed load once, ends the worker, and does not retry by itself', async () => {
    const { controller, sdk, workers } = harness({
      load: () => Promise.reject(new Error('Device was lost during reload')),
    });
    await controller.checkDevice();
    await controller.download();
    const status = controller.getStatus();
    expect(status.kind).toBe('error');
    if (status.kind === 'error')
      expect(status.message).toMatch(/ran out of memory or was lost/);
    expect(workers[0]?.terminated).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(sdk.CreateWebWorkerMLCEngine).toHaveBeenCalledTimes(1);
  });

  it('generates one answer at a time, bounded, and returns to ready', async () => {
    const { controller, engine } = harness();
    await controller.checkDevice();
    await controller.download();
    const first = controller.generate({ messages: [], maxTokens: 50, temperature: 0.5 });
    expect(controller.getStatus().kind).toBe('generating');
    await expect(
      controller.generate({ messages: [], maxTokens: 50, temperature: 0.5 }),
    ).rejects.toThrow(/already answering/);
    await expect(first).resolves.toEqual({ text: 'Hello there', finishReason: 'stop' });
    expect(controller.getStatus().kind).toBe('ready');
    expect(vi.mocked(engine.chatCompletion).mock.calls[0]?.[0]).toMatchObject({
      max_tokens: 50,
      stream: true,
    });
  });

  it('stops a generation with the engine’s interrupt', async () => {
    const { controller, engine } = harness({ reply: () => ['a', 'b', 'c', 'd', 'e'] });
    await controller.checkDevice();
    await controller.download();
    const abort = new AbortController();
    const running = controller.generate({
      messages: [],
      maxTokens: 50,
      temperature: 0.5,
      signal: abort.signal,
      onText: () => {
        abort.abort();
      },
    });
    await expect(running).rejects.toThrow('Cancelled');
    expect(engine.interruptGenerate).toHaveBeenCalled();
    expect(controller.getStatus().kind).toBe('ready');
  });

  it('handles a lost device during generation by turning local AI off', async () => {
    const { controller, workers } = harness({
      failGenerate: new Error('GPU device lost'),
    });
    await controller.checkDevice();
    await controller.download();
    await expect(
      controller.generate({ messages: [], maxTokens: 10, temperature: 0 }),
    ).rejects.toThrow('GPU device lost');
    expect(controller.getStatus()).toMatchObject({ kind: 'error' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('turns off with unload, then ends the worker', async () => {
    const { controller, engine, workers } = harness();
    await controller.checkDevice();
    await controller.download();
    await controller.unload();
    expect(engine.unload).toHaveBeenCalledTimes(1);
    expect(workers[0]?.terminated).toBe(true);
    expect(controller.getStatus()).toMatchObject({ kind: 'stopped' });
  });

  it('loads a cached model even when free storage is below the download size', async () => {
    const short = env({
      storageEstimate: () => Promise.resolve({ quota: 100, usage: 50 }),
    });
    const cached = harness({ environment: short });
    vi.mocked(cached.sdk.hasModelInCache).mockResolvedValue(true);
    await cached.controller.checkDevice();
    expect(cached.controller.getStatus()).toMatchObject({
      kind: 'ready-to-download',
      estimate: { cached: true },
      capability: { ok: true, reasons: [] },
    });

    const fresh = harness({ environment: short });
    await fresh.controller.checkDevice();
    expect(fresh.controller.getStatus()).toMatchObject({ kind: 'unsupported' });
  });

  it('does not claim a running engine after the page is left', async () => {
    const { controller, workers } = harness();
    await controller.checkDevice();
    await controller.download();
    controller.dispose();
    expect(workers[0]?.terminated).toBe(true);
    expect(controller.getStatus()).toMatchObject({ kind: 'stopped' });
  });

  it('deletes the downloaded files for both builds, but never while a model is loaded', async () => {
    const { controller, sdk } = harness();
    await controller.checkDevice();
    await controller.download();
    expect(await controller.deleteDownloadedModel()).toBe('busy');
    expect(sdk.deleteModelAllInfoInCache).not.toHaveBeenCalled();
    await controller.unload();
    expect(await controller.deleteDownloadedModel()).toBe('deleted');
    expect(vi.mocked(sdk.deleteModelAllInfoInCache).mock.calls.map((c) => c[0])).toEqual([
      LOCAL_MODEL.ids.f16,
      LOCAL_MODEL.ids.f32,
    ]);
  });
});

describe('model output is untrusted', () => {
  const ctx = (record: EventRecord = planned('wedding')) =>
    buildContextSnapshot(record, TODAY, CONFIG);

  it('bounds the prompt and asks for schema-constrained JSON', () => {
    const prompt = ideasPrompt(ctx(), 'x'.repeat(5_000));
    const total = prompt.messages.reduce(
      (n, m) => n + (typeof m.content === 'string' ? m.content.length : 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(MAX_PROMPT_CHARS + 200);
    expect(prompt.responseFormat.type).toBe('json_object');
  });

  it('drops ideas that conflict with stated dietary needs or mention prices', () => {
    const raw = JSON.stringify({
      ideas: [
        {
          title: 'Chicken tikka station',
          details: 'Grilled chicken skewers for everyone.',
        },
        {
          title: 'Marigold entrance',
          details: 'Fresh marigold garlands at the doorway.',
        },
        { title: 'Photo booth', details: 'A booth with props for about ₹8,000.' },
      ],
    });
    const result = parseIdeas(raw, ctx()); // the wedding demo lists vegetarian
    expect(result?.items.map((i) => i.title)).toEqual(['Marigold entrance']);
    expect(result?.removed).toHaveLength(2);
    expect(parseIdeas('not json at all', ctx())).toBeNull();
    expect(parseIdeas('{"ideas": []}', ctx())).toBeNull();
  });

  it('removes invented contact details from invitation wording and checks the date', () => {
    const result = cleanInvitation(
      'You are invited! Call 98765 43210 or email host@example.com, see www.example.com.',
      ctx(),
    );
    expect(result?.text).not.toMatch(/98765|example\.com/);
    expect(result?.warnings.join(' ')).toMatch(/phone number|email address|link/);
    expect(result?.warnings.join(' ')).toMatch(/does not state the date/);
  });

  it('finds figures in an explanation that the planner did not supply', () => {
    const facts = [
      'Forecast: ₹4,39,000',
      'Headroom = budget ₹5,00,000 − reserve ₹50,000 = ₹11,000.',
    ];
    expect(
      ungroundedFigures('Your forecast is ₹4,39,000 and headroom ₹11,000.', facts),
    ).toEqual([]);
    expect(ungroundedFigures('You could save ₹25,000 or 20%.', facts)).toEqual([
      '₹25,000',
      '20%',
    ]);
  });
});

describe('LocalAIProvider', () => {
  async function ready(
    reply: (request: { max_tokens: number }) => string[],
    failGenerate?: Error,
  ) {
    const h = harness({ reply, ...(failGenerate ? { failGenerate } : {}) });
    await h.controller.checkDevice();
    await h.controller.download();
    return { ...h, provider: new LocalAIProvider(h.controller) };
  }
  const request = (
    message: string,
    record: EventRecord = planned('wedding'),
  ): AssistantRequest => ({
    requestId: 'r1',
    eventId: record.profile.id,
    revision: record.profile.revision,
    context: buildContextSnapshot(record, TODAY, CONFIG),
    message,
  });

  it('sends numerical commands and changes to the planner, not the model', async () => {
    const { provider, engine } = await ready(() => ['should not be used']);
    const response = await provider.respond(request('Set guests to 120'));
    expect(response).toMatchObject({
      kind: 'proposal',
      provider: { label: 'Guided planner' },
    });
    expect(response.generated).toBeUndefined();
    expect(engine.chatCompletion).not.toHaveBeenCalled();
    expect(classifyForModel('Reduce my budget by 15%')).toBeNull();
  });

  it('labels validated model ideas as an AI-written draft', async () => {
    const { provider } = await ready(() => [
      JSON.stringify({
        ideas: [
          {
            title: 'Lantern garden walk',
            details: 'Paper lanterns along the route to the hall.',
          },
          {
            title: 'Family memory wall',
            details: 'Guests pin photos and notes on a wall.',
          },
        ],
      }),
    ]);
    const response = await provider.respond(request('Suggest theme ideas'));
    expect(response).toMatchObject({
      kind: 'draft',
      provider: { label: 'Local AI' },
      generated: { by: 'local-model', model: LOCAL_MODEL.name },
    });
    if (response.kind === 'draft') expect(response.items).toHaveLength(2);
  });

  it('falls back to the guided planner, saying why, when the output is unusable', async () => {
    const { provider } = await ready(() => [
      'Sure! Here are some ideas: 1. Fun 2. Games',
    ]);
    const response = await provider.respond(request('Suggest theme ideas'));
    expect(response.provider.label).toBe('Guided planner');
    if (response.kind === 'draft')
      expect(response.note).toMatch(/did not return ideas in a usable form/);
  });

  it('discards an explanation with invented figures and shows the planner’s own', async () => {
    const { provider } = await ready(() => [
      'You can easily save ₹77,777 by cutting decor.',
    ]);
    const response = await provider.respond(request('Explain my budget in plain words'));
    expect(response.provider.label).toBe('Guided planner');
    if (response.kind === 'info') {
      expect(response.paragraphs[0]).toMatch(
        /discarded because it mentioned figures .*₹77,777/,
      );
    }
  });

  it('keeps a grounded explanation as Local AI output', async () => {
    const { provider } = await ready(() => [
      'Your plan is forecast to cost ₹4,39,000, leaving ₹11,000 of headroom after the reserve.',
    ]);
    const response = await provider.respond(request('Explain my budget in plain words'));
    expect(response).toMatchObject({ kind: 'info', provider: { label: 'Local AI' } });
  });

  it('falls back to the guided planner when the model fails', async () => {
    const { provider } = await ready(() => [], new Error('engine exploded'));
    const response = await provider.respond(request('Write invitation wording'));
    expect(response.provider.label).toBe('Guided planner');
  });
});

describe('stopping before the first token', () => {
  it('sends the interrupt again once streaming starts, and reports stopping until then', async () => {
    // Models the SDK: an interrupt before the generation starts is cleared.
    let interrupted = false;
    let started = false;
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const prefill = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: EngineLike = {
      interruptGenerate: vi.fn(() => {
        calls.push(started ? 'interrupt-after-start' : 'interrupt-before-start');
        if (started) interrupted = true;
      }),
      unload: vi.fn(() => Promise.resolve()),
      chatCompletion: vi.fn(() =>
        Promise.resolve({
          async *[Symbol.asyncIterator]() {
            await prefill;
            started = true;
            interrupted = false;
            for (const part of ['a', 'b', 'c', 'd']) {
              yield { choices: [{ delta: { content: part } }] };
              await Promise.resolve();
              if (interrupted) {
                yield { choices: [{ delta: {}, finish_reason: 'abort' }] };
                return;
              }
            }
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          },
        }),
      ),
    };
    const h = harness();
    vi.mocked(h.sdk.CreateWebWorkerMLCEngine).mockResolvedValue(engine);
    await h.controller.checkDevice();
    await h.controller.download();
    const abort = new AbortController();
    const running = h.controller.generate({
      messages: [],
      maxTokens: 50,
      temperature: 0,
      signal: abort.signal,
    });
    await Promise.resolve();
    abort.abort();
    expect(h.controller.getStatus()).toMatchObject({
      kind: 'generating',
      stopping: true,
    });
    release();
    await expect(running).rejects.toThrow('Cancelled');
    expect(calls).toEqual(['interrupt-before-start', 'interrupt-after-start']);
    expect(h.controller.getStatus().kind).toBe('ready');
  });
});
