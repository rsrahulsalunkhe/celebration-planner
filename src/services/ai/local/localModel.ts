import type {
  ChatCompletionMessageParam,
  InitProgressReport,
  MLCEngineInterface,
  ResponseFormat,
} from '@mlc-ai/web-llm';
import {
  browserEnvironment,
  checkCapability,
  type CapabilityEnvironment,
  type CapabilityResult,
} from './capability.ts';
import { CONTEXT_WINDOW_TOKENS, LOCAL_MODEL, type ModelVariant } from './model.ts';

/**
 * Owns the one local model engine for the session and its lifecycle.
 *
 * Nothing here runs until the user asks: the SDK is imported and the worker
 * created only from `checkDevice()` and `download()`. Every transition is
 * explicit and nothing retries by itself.
 *
 * Stopping is real, not cosmetic:
 * - a download cannot be interrupted through the SDK, so stopping it
 *   terminates the worker that is downloading;
 * - a generation is stopped with the engine's `interruptGenerate()`;
 * - turning local AI off calls `unload()` and then terminates the worker.
 */

export interface DownloadEstimate {
  /** Bytes from the model's own shard manifest, when it could be read. */
  verifiedBytes: number | null;
  /** Already in this browser's cache, so nothing large is downloaded. */
  cached: boolean;
  modelId: string;
}

export type LocalModelStatus =
  | { kind: 'idle' }
  | { kind: 'capability-check' }
  | { kind: 'unsupported'; reasons: string[] }
  | {
      kind: 'ready-to-download';
      capability: CapabilityResult;
      estimate: DownloadEstimate;
    }
  | { kind: 'downloading'; progress: number; text: string; modelId: string }
  | { kind: 'ready'; modelId: string }
  /** `stopping`: asked to stop, and the engine has not finished yet. */
  | { kind: 'generating'; modelId: string; stopping?: boolean }
  | { kind: 'stopped'; message: string }
  | { kind: 'error'; message: string };

/** The parts of the SDK the controller uses, so tests can supply a fake. */
export interface WebLlmSdk {
  CreateWebWorkerMLCEngine: (
    worker: Worker,
    modelId: string,
    engineConfig: { initProgressCallback: (report: InitProgressReport) => void },
    chatOpts: { context_window_size: number },
  ) => Promise<EngineLike>;
  hasModelInCache: (modelId: string) => Promise<boolean>;
  deleteModelAllInfoInCache: (modelId: string) => Promise<void>;
  prebuiltAppConfig: { model_list: { model_id: string; model: string }[] };
}

export type EngineLike = Pick<MLCEngineInterface, 'interruptGenerate' | 'unload'> & {
  chatCompletion: (request: {
    messages: ChatCompletionMessageParam[];
    stream: true;
    max_tokens: number;
    temperature: number;
    response_format?: ResponseFormat;
  }) => Promise<
    AsyncIterable<{
      choices: { delta: { content?: string | null }; finish_reason?: string | null }[];
    }>
  >;
};

export interface LocalModelDependencies {
  loadSdk: () => Promise<WebLlmSdk>;
  createWorker: () => Worker;
  environment: () => CapabilityEnvironment;
  fetchJson: (url: string) => Promise<unknown>;
}

export const browserDependencies: LocalModelDependencies = {
  // Separate chunks: neither the SDK nor the worker is part of the first page load.
  loadSdk: () => import('@mlc-ai/web-llm'),
  createWorker: () =>
    new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  environment: browserEnvironment,
  fetchJson: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as unknown;
  },
};

export interface GenerateOptions {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature: number;
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
  onText?: (textSoFar: string) => void;
}

export interface GenerateResult {
  text: string;
  /** `stop`, `length` (hit the token limit) or `abort`. */
  finishReason: string;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function friendlyLoadError(error: unknown): string {
  const text = describe(error);
  if (/device.*lost|lost.*device|out of memory|OOM/i.test(text)) {
    return 'The graphics device ran out of memory or was lost while loading the model. Close other heavy tabs and try again, or keep using the guided planner.';
  }
  if (/quota|storage/i.test(text)) {
    return 'The browser could not store the model files (storage is full or blocked).';
  }
  if (/fetch|network|Failed to fetch|HTTP/i.test(text)) {
    return 'The model files could not be downloaded. Check the connection and try again.';
  }
  return `The local model could not be loaded: ${text}`;
}

export class LocalModelController {
  private status: LocalModelStatus = { kind: 'idle' };
  private readonly listeners = new Set<() => void>();
  private sdk: WebLlmSdk | null = null;
  private worker: Worker | null = null;
  private engine: EngineLike | null = null;
  /** Bumped on every stop or unload, so a late result from older work is ignored. */
  private generation = 0;
  private readonly deps: LocalModelDependencies;

  constructor(deps: LocalModelDependencies = browserDependencies) {
    this.deps = deps;
  }

  getStatus = (): LocalModelStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(status: LocalModelStatus) {
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  /** Step one, after the user chooses Enable local AI: check the device and the download. */
  async checkDevice(): Promise<void> {
    const allowed = ['idle', 'unsupported', 'stopped', 'error'];
    if (!allowed.includes(this.status.kind)) return;
    const token = ++this.generation;
    this.set({ kind: 'capability-check' });
    const capability = await checkCapability(
      this.deps.environment(),
      LOCAL_MODEL.measured.repositoryBytes + LOCAL_MODEL.measured.modelLibraryBytes,
    );
    if (token !== this.generation) return;
    // Short of space is only a problem if the model still has to be downloaded.
    const onlyStorage = capability.storageShort && capability.reasons.length === 1;
    if (!capability.ok && !onlyStorage) {
      this.set({ kind: 'unsupported', reasons: capability.reasons });
      return;
    }
    let sdk: WebLlmSdk;
    try {
      sdk = this.sdk ?? (await this.deps.loadSdk());
      this.sdk = sdk;
    } catch (error) {
      if (token !== this.generation) return;
      this.set({
        kind: 'error',
        message: `The local AI library could not be loaded: ${describe(error)}`,
      });
      return;
    }
    const estimate = await this.estimate(sdk, LOCAL_MODEL.ids[capability.variant]);
    if (token !== this.generation) return;
    if (onlyStorage && !estimate.cached) {
      this.set({ kind: 'unsupported', reasons: capability.reasons });
      return;
    }
    this.set({
      kind: 'ready-to-download',
      capability: { ...capability, ok: true, reasons: [] },
      estimate,
    });
  }

  private async estimate(sdk: WebLlmSdk, modelId: string): Promise<DownloadEstimate> {
    const cached = await sdk.hasModelInCache(modelId).catch(() => false);
    let verifiedBytes: number | null = null;
    const record = sdk.prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
    if (record && !cached) {
      try {
        const manifest = (await this.deps.fetchJson(
          `${record.model.replace(/\/$/, '')}/resolve/main/ndarray-cache.json`,
        )) as { records?: { nbytes?: unknown }[] };
        const sizes = (manifest.records ?? []).map((r) => r.nbytes);
        if (sizes.length > 0 && sizes.every((n) => typeof n === 'number' && n >= 0)) {
          verifiedBytes = (sizes as number[]).reduce((a, b) => a + b, 0);
        }
      } catch {
        verifiedBytes = null;
      }
    }
    return { verifiedBytes, cached, modelId };
  }

  /** Step two, after the user confirms: download (or load from cache) and start the engine. */
  async download(): Promise<void> {
    if (this.status.kind !== 'ready-to-download') return;
    const { modelId } = this.status.estimate;
    const sdk = this.sdk;
    if (!sdk) return;
    const token = ++this.generation;
    this.set({ kind: 'downloading', progress: 0, text: 'Starting…', modelId });
    const worker = this.deps.createWorker();
    this.worker = worker;
    try {
      const engine = await sdk.CreateWebWorkerMLCEngine(
        worker,
        modelId,
        {
          initProgressCallback: (report) => {
            if (token !== this.generation) return;
            this.set({
              kind: 'downloading',
              progress: Math.min(1, Math.max(0, report.progress)),
              text: report.text,
              modelId,
            });
          },
        },
        { context_window_size: CONTEXT_WINDOW_TOKENS },
      );
      if (token !== this.generation) {
        // Stopped while finishing: release what was loaded.
        void engine.unload().catch(() => undefined);
        return;
      }
      this.engine = engine;
      this.set({ kind: 'ready', modelId });
    } catch (error) {
      if (token !== this.generation) return;
      this.terminate();
      this.set({ kind: 'error', message: friendlyLoadError(error) });
    }
  }

  /** Stops whatever is running: a download (by ending its worker) or a generation. */
  stop(): void {
    if (this.status.kind === 'downloading') {
      this.generation += 1;
      this.terminate();
      this.set({
        kind: 'stopped',
        message:
          'Download stopped. The worker that was downloading was ended. Files that already finished may stay in the browser cache and are reused next time.',
      });
    } else if (this.status.kind === 'generating') {
      this.engine?.interruptGenerate();
    } else if (
      this.status.kind === 'capability-check' ||
      this.status.kind === 'ready-to-download'
    ) {
      this.generation += 1;
      this.set({ kind: 'idle' });
    }
  }

  /**
   * Deletes the downloaded model files (weights, library and config, for both
   * builds) from this browser's storage. Refused while a model is loading or
   * loaded: turn local AI off first. Loads the SDK if needed, never a model.
   */
  async deleteDownloadedModel(): Promise<'deleted' | 'busy' | 'failed'> {
    const busy = ['capability-check', 'downloading', 'ready', 'generating'];
    if (busy.includes(this.status.kind)) return 'busy';
    try {
      const sdk = this.sdk ?? (await this.deps.loadSdk());
      this.sdk = sdk;
      for (const id of Object.values(LOCAL_MODEL.ids)) {
        await sdk.deleteModelAllInfoInCache(id);
      }
    } catch {
      return 'failed';
    }
    // An earlier check said the model was cached; that is no longer true.
    if (this.status.kind === 'ready-to-download') {
      this.generation += 1;
      this.set({ kind: 'idle' });
    }
    return 'deleted';
  }

  /** Turns local AI off: unloads the model, releases the GPU and ends the worker. */
  async unload(): Promise<void> {
    if (this.status.kind !== 'ready' && this.status.kind !== 'generating') return;
    this.generation += 1;
    const engine = this.engine;
    engine?.interruptGenerate();
    try {
      await engine?.unload();
    } catch {
      // The worker is ended below either way.
    }
    this.terminate();
    this.set({
      kind: 'stopped',
      message: 'Local AI is off. The model was unloaded from memory.',
    });
  }

  /** Ends the worker and forgets the engine. Safe to call more than once. */
  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
  }

  /** For page unload. */
  dispose(): void {
    this.generation += 1;
    this.terminate();
    // A page restored from the back/forward cache must not claim a running engine.
    if (this.status.kind !== 'idle') {
      this.set({ kind: 'stopped', message: 'Local AI stopped when the page was left.' });
    }
  }

  /**
   * Runs one generation. Only one can run at a time; the signal stops it
   * with the engine's own interrupt. Output is bounded by `maxTokens`.
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (this.status.kind === 'generating') {
      throw new Error('The local model is already answering another request.');
    }
    if (this.status.kind !== 'ready' || !this.engine) {
      throw new Error('The local model is not ready.');
    }
    const engine = this.engine;
    const { modelId } = this.status;
    const token = this.generation;
    this.set({ kind: 'generating', modelId });
    // WebLLM 0.2.85 clears its interrupt flag when a generation starts and
    // cannot interrupt prompt processing, so an interrupt sent before the
    // first token is lost. It is sent again as soon as streaming begins, and
    // the status says "stopping" until the engine has really finished.
    let interruptAfterStart = false;
    const onAbort = () => {
      engine.interruptGenerate();
      if (token === this.generation && this.getStatus().kind === 'generating') {
        this.set({ kind: 'generating', modelId, stopping: true });
      }
    };
    options.signal?.addEventListener('abort', onAbort);
    let text = '';
    let finishReason = 'stop';
    try {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const stream = await engine.chatCompletion({
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      });
      for await (const chunk of stream) {
        if (options.signal?.aborted && !interruptAfterStart) {
          interruptAfterStart = true;
          engine.interruptGenerate();
        }
        const choice = chunk.choices[0];
        const piece = choice?.delta.content ?? '';
        if (piece) {
          text += piece;
          options.onText?.(text);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      return { text, finishReason };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (/device.*lost|lost.*device/i.test(describe(error))) {
        this.generation += 1;
        this.terminate();
        this.set({
          kind: 'error',
          message:
            'The graphics device was lost while the local model was answering. Local AI was turned off; you can try enabling it again.',
        });
      }
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      if (token === this.generation && this.getStatus().kind === 'generating') {
        this.set({ kind: 'ready', modelId });
      }
    }
  }
}

export type { ModelVariant };
