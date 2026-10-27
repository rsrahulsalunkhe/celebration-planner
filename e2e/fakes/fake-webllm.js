// A stand-in for the @mlc-ai/web-llm SDK chunk, served by the end-to-end tests
// in its place. It downloads nothing, needs no GPU and runs no model. It lets
// the journeys drive the app's local AI states (loading, failing, stopping,
// answering); it says nothing about what a real model would write.
//
// Behaviour is set per test through `window.__fakeLocalAi` (see localAi.ts).

const settings = () => globalThis.__fakeLocalAi;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const prebuiltAppConfig = {
  model_list: [
    {
      model_id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      model: 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    },
    {
      model_id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
      model: 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    },
  ],
};

export async function hasModelInCache() {
  return false;
}

export async function deleteModelAllInfoInCache() {
  settings().calls.deletes += 1;
}

const IDEAS = {
  ideas: [
    {
      title: 'Lantern courtyard welcome',
      details: 'Paper lanterns and soft music greet guests as they arrive.',
    },
    {
      title: 'Story corner',
      details: 'A quiet table where guests write a short memory for the hosts.',
    },
    {
      title: 'Garden games',
      details: 'Simple lawn games that guests of every age can join in.',
    },
  ],
};

export async function CreateWebWorkerMLCEngine(_worker, _modelId, engineConfig) {
  const s = settings();
  s.calls.loads += 1;
  engineConfig.initProgressCallback({
    progress: 0.4,
    text: 'Stand-in download: 40% (nothing is downloaded)',
    timeElapsed: 1,
  });
  if (s.holdLoad) await new Promise(() => {});
  await wait(100);
  if (s.failLoad) throw new Error(s.failLoad);
  engineConfig.initProgressCallback({
    progress: 1,
    text: 'Stand-in ready',
    timeElapsed: 2,
  });

  let interrupted = false;
  return {
    interruptGenerate() {
      interrupted = true;
      s.calls.interrupts += 1;
    },
    async unload() {
      s.calls.unloads += 1;
    },
    async chatCompletion(request) {
      interrupted = false;
      s.calls.generations += 1;
      const text = request.response_format
        ? JSON.stringify(IDEAS)
        : 'Here is a short answer from the stand-in model used by the tests.';
      const pieces = text.match(/[\s\S]{1,16}/g) ?? [];
      return {
        async *[Symbol.asyncIterator]() {
          for (const piece of pieces) {
            await wait(s.replyDelayMs);
            if (interrupted) {
              yield { choices: [{ delta: {}, finish_reason: 'abort' }] };
              return;
            }
            yield { choices: [{ delta: { content: piece } }] };
          }
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      };
    },
  };
}
