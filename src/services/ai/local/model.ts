/**
 * The local model and where it comes from. Checked against the installed SDK
 * by a test, so an ID that is not in its prebuilt list fails the build checks.
 *
 * - SDK: @mlc-ai/web-llm 0.2.85 (pinned exactly in package.json).
 * - Model: Qwen2.5-1.5B-Instruct, 4-bit, in MLC format. The q4f16_1 build is
 *   used when the GPU supports `shader-f16`; otherwise the q4f32_1 build.
 * - Source: https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC,
 *   converted from https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct.
 * - License: Apache-2.0 (the base model's license; the MLC repository is a
 *   format conversion without a separate license). Weights are downloaded by
 *   the browser from Hugging Face and are never part of this repository.
 */

export const WEBLLM_SDK_VERSION = '0.2.85';

export const LOCAL_MODEL = {
  name: 'Qwen2.5 1.5B Instruct',
  ids: {
    f16: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    f32: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  },
  source: 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  baseModel: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct',
  license: 'Apache-2.0',
  licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/blob/main/LICENSE',
  /** Hosts the browser downloads model files from. */
  hosts: ['huggingface.co', 'raw.githubusercontent.com'],
  /**
   * Measured on 2026-10-22 from the repository's file list and the model
   * library's Content-Length. The app re-checks the weight size at run time
   * from the model's own manifest and shows that when it can.
   */
  measured: {
    repositoryBytes: 880_289_238,
    weightBytes: 868_547_584,
    modelLibraryBytes: 5_225_782,
  },
} as const;

/**
 * Tokens of context the engine keeps. Prompts are cut well below this, and
 * a smaller window also needs less graphics memory than the default 4096.
 */
export const CONTEXT_WINDOW_TOKENS = 2048;

export type ModelVariant = keyof typeof LOCAL_MODEL.ids;
