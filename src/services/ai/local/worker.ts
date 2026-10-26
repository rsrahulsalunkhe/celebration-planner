/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

/**
 * The dedicated worker that owns the WebLLM engine, so model loading and
 * generation never block the page. It is created only when the user enables
 * local AI, and terminated when they stop a download or turn local AI off.
 */
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message);
};
