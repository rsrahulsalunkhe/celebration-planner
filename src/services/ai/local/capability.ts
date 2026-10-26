import type { ModelVariant } from './model.ts';

/**
 * Checks whether this browser and device can run the local model at all,
 * before anything large is downloaded. Uses only what the browser reports;
 * it does not guess performance.
 */

/** The parts of the WebGPU API this check needs (TypeScript's DOM types lack them). */
interface GpuAdapterLike {
  features: { has(name: string): boolean };
  limits: { maxBufferSize?: number; maxStorageBufferBindingSize?: number };
  info?: { vendor?: string; architecture?: string; description?: string };
}
interface GpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<GpuAdapterLike | null>;
}
export interface CapabilityEnvironment {
  isSecureContext: boolean;
  hasWorker: boolean;
  gpu: GpuLike | undefined;
  /** `navigator.deviceMemory`, in gigabytes, where the browser reports it. */
  deviceMemoryGb: number | undefined;
  storageEstimate: (() => Promise<{ quota?: number; usage?: number }>) | undefined;
}

export interface CapabilityResult {
  ok: boolean;
  /** Why the model cannot run here. */
  reasons: string[];
  /** Risks that do not block trying. */
  warnings: string[];
  variant: ModelVariant;
  adapter: string | null;
  freeStorageBytes: number | null;
  /** Too little free space for a download; a model already in the cache can still load. */
  storageShort: boolean;
}

export function browserEnvironment(): CapabilityEnvironment {
  const nav = navigator as Navigator & {
    gpu?: GpuLike;
    deviceMemory?: number;
  };
  return {
    isSecureContext: window.isSecureContext,
    hasWorker: typeof Worker !== 'undefined',
    gpu: nav.gpu,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    storageEstimate:
      typeof nav.storage?.estimate === 'function'
        ? () => nav.storage.estimate()
        : undefined,
  };
}

export async function checkCapability(
  env: CapabilityEnvironment,
  downloadBytes: number,
): Promise<CapabilityResult> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let variant: ModelVariant = 'f16';
  let adapterName: string | null = null;
  let freeStorageBytes: number | null = null;
  let storageShort = false;

  if (!env.isSecureContext) {
    reasons.push('WebGPU only works on secure pages (https or localhost).');
  }
  if (!env.hasWorker) reasons.push('This browser does not support Web Workers.');
  if (!env.gpu) {
    reasons.push(
      'This browser does not offer WebGPU. Recent desktop Chrome or Edge usually do; some browsers need it switched on.',
    );
  }

  if (env.gpu && reasons.length === 0) {
    const adapter = await env.gpu
      .requestAdapter({ powerPreference: 'high-performance' })
      .catch(() => null);
    if (!adapter) {
      reasons.push(
        'WebGPU is present but no graphics adapter is available (it may be blocked or unsupported on this device).',
      );
    } else {
      variant = adapter.features.has('shader-f16') ? 'f16' : 'f32';
      const info = adapter.info;
      adapterName =
        [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') ||
        null;
    }
  }

  if (env.deviceMemoryGb !== undefined && env.deviceMemoryGb < 4) {
    warnings.push(
      `This device reports about ${env.deviceMemoryGb} GB of memory. The model needs roughly 1.5 GB of graphics memory and may fail to load.`,
    );
  }
  if (env.storageEstimate) {
    try {
      const { quota, usage } = await env.storageEstimate();
      if (quota !== undefined && usage !== undefined) {
        freeStorageBytes = Math.max(0, quota - usage);
        if (freeStorageBytes < downloadBytes) {
          storageShort = true;
          reasons.push(
            'This browser does not have enough storage space for the model files.',
          );
        }
      }
    } catch {
      // Unknown storage: the download itself will report a failure.
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    variant,
    adapter: adapterName,
    freeStorageBytes,
    storageShort,
  };
}
