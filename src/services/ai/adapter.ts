/**
 * Contract for optional AI assistance. Core planning never depends on it:
 * the rule-based planner works with `noModelAdapter`. A later stage adds a
 * WebLLM adapter that runs in a Web Worker and implements this interface.
 */

export type AssistantAvailability = 'unavailable' | 'loading' | 'ready';

export interface AssistantRequest {
  prompt: string;
}

export interface AssistantResponse {
  text: string;
}

export interface AssistantAdapter {
  readonly id: string;
  readonly label: string;
  availability(): AssistantAvailability;
  suggest(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse>;
}

export const noModelAdapter: AssistantAdapter = {
  id: 'none',
  label: 'No local model',
  availability: () => 'unavailable',
  suggest: () => Promise.reject(new Error('No local model is enabled.')),
};
