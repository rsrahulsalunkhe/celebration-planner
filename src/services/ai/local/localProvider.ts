import type {
  AssistantProvider,
  AssistantRequest,
  AssistantResponse,
  ContextSnapshot,
  GeneratedBy,
  ProviderInfo,
} from '../assistant.ts';
import { GUIDED_EXAMPLES, guidedAnswer } from '../guidedProvider.ts';
import type { LocalModelController } from './localModel.ts';
import { LOCAL_MODEL } from './model.ts';
import {
  LIMITS,
  cleanExplanation,
  cleanInvitation,
  explanationPrompt,
  ideasPrompt,
  invitationPrompt,
  parseIdeas,
  ungroundedFigures,
} from './prompts.ts';

/**
 * Local AI on top of the guided planner.
 *
 * The planner stays in charge of numbers and changes: commands, questions and
 * proposals are always answered by the guided planner's rules and the
 * engine. The local model only writes three kinds of text: personalised
 * theme and activity ideas, invitation wording, and plain-language
 * explanations of facts the planner already computed. Its output is checked
 * and shown as an unverified draft; if it fails a check or the model fails,
 * the guided planner's answer is shown instead and says why.
 */

const LOCAL_INFO: ProviderInfo = { id: 'local-ai', label: 'Local AI' };
const GUIDED_INFO: ProviderInfo = { id: 'guided', label: 'Guided planner' };
const CAUTION =
  'Written on this device by an AI model. It can be wrong or generic: check it before you use it. Costs, totals, dates and changes always come from the planner.';

type Answer = ReturnType<typeof guidedAnswer>;
type Task = 'ideas' | 'invitation' | 'explanation';

export const LOCAL_EXAMPLES = [
  'Suggest theme ideas for this event.',
  'Write invitation wording.',
  'Explain my budget in plain words.',
  ...GUIDED_EXAMPLES.filter((e) => !/ideas|invitation/i.test(e)),
] as const;

export function classifyForModel(message: string): Task | null {
  const lower = message.toLowerCase();
  if (
    /\binvit(?:e|ation|ations)\b/.test(lower) &&
    !/\brsvp\b|\badd\b.*\bguests?\b/.test(lower)
  )
    return 'invitation';
  if (/\b(?:explain|why|walk me through|in plain words|summari[sz]e)\b/.test(lower))
    return 'explanation';
  if (/\b(?:ideas?|themes?|activit(?:y|ies)|games?)\b/.test(lower)) return 'ideas';
  return null;
}

/** The planner's own facts for an explanation: its deterministic answers. */
function factsFor(
  message: string,
  ctx: ContextSnapshot,
): { facts: string[]; basis: Answer } {
  const lower = message.toLowerCase();
  const wantsPlan = /\b(?:plan|timeline|schedule|tasks?|next|deadline)\b/.test(lower);
  const wantsMoney = /\b(?:budget|cost|money|spend|forecast|reserve|headroom)\b/.test(
    lower,
  );
  const answers: Answer[] = [];
  if (wantsMoney || !wantsPlan) answers.push(guidedAnswer('Explain my budget.', ctx));
  if (wantsPlan || !wantsMoney) answers.push(guidedAnswer('What should I do next?', ctx));
  const facts = answers.flatMap((a) =>
    a.kind === 'info'
      ? [...(a.facts ?? []).map((f) => `${f.label}: ${f.value}`), ...a.paragraphs]
      : [],
  );
  return { facts: facts.slice(0, 14), basis: answers[0] ?? guidedAnswer('help', ctx) };
}

export class LocalAIProvider implements AssistantProvider {
  readonly info = { id: 'local-ai', label: 'Local AI with the guided planner' };
  readonly examples = LOCAL_EXAMPLES;
  private readonly model: LocalModelController;

  constructor(model: LocalModelController) {
    this.model = model;
  }

  async respond(
    request: AssistantRequest,
    signal?: AbortSignal,
    onProgress?: (preview: string) => void,
  ): Promise<AssistantResponse> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const ctx = request.context;
    const ids = {
      requestId: request.requestId,
      eventId: request.eventId,
      revision: request.revision,
    };
    const guided = guidedAnswer(request.message, ctx);
    const task = classifyForModel(request.message);
    // Commands, clarifications and changes stay with the rules and the engine.
    if (task === null || guided.kind === 'proposal' || guided.kind === 'question') {
      return { ...guided, ...ids, provider: GUIDED_INFO };
    }
    const model = (warnings: string[]): GeneratedBy => ({
      by: 'local-model',
      model: LOCAL_MODEL.name,
      caution: CAUTION,
      warnings,
    });
    const fallback = (reason: string, basis: Answer = guided): AssistantResponse => {
      if (basis.kind === 'info') {
        return {
          ...basis,
          ...ids,
          provider: GUIDED_INFO,
          paragraphs: [reason, ...basis.paragraphs],
        };
      }
      if (basis.kind === 'draft') {
        return {
          ...basis,
          ...ids,
          provider: GUIDED_INFO,
          note: `${reason} ${basis.note}`,
        };
      }
      return { ...basis, ...ids, provider: GUIDED_INFO };
    };

    try {
      if (task === 'ideas') {
        const prompt = ideasPrompt(ctx, request.message);
        const result = await this.model.generate({
          messages: prompt.messages,
          responseFormat: prompt.responseFormat,
          ...LIMITS.ideas,
          maxTokens: LIMITS.ideas.maxTokens,
          ...(signal ? { signal } : {}),
          onText: (text) =>
            onProgress?.(`Writing ideas… (${text.length} characters so far)`),
        });
        const ideas = parseIdeas(result.text, ctx);
        if (!ideas) {
          return fallback(
            'Local AI did not return ideas in a usable form, so these are the guided planner’s built-in ideas.',
            guidedAnswer(`Suggest ${ctx.event.eventType} ideas`, ctx),
          );
        }
        return {
          kind: 'draft',
          ...ids,
          provider: LOCAL_INFO,
          title: 'Ideas for this event',
          intro: `For ${ctx.event.guestCount} guests, ${ctx.event.setting}, in ${ctx.event.city}${ctx.preferences.dietaryNeeds.length > 0 ? `, suiting ${ctx.preferences.dietaryNeeds.join(', ').replaceAll('-', ' ')}` : ''}.`,
          items: ideas.items,
          note: 'A draft. Nothing is saved unless you copy it somewhere.',
          generated: model([
            ...ideas.removed,
            ...(result.finishReason === 'length'
              ? ['The model hit its length limit, so the list may be short.']
              : []),
          ]),
        };
      }

      if (task === 'invitation') {
        const result = await this.model.generate({
          messages: invitationPrompt(ctx, request.message),
          maxTokens: LIMITS.invitation.maxTokens,
          temperature: LIMITS.invitation.temperature,
          ...(signal ? { signal } : {}),
          onText: onProgress,
        });
        const invitation = cleanInvitation(result.text, ctx);
        if (!invitation) {
          return fallback(
            'Local AI did not produce usable invitation wording, so this is the guided planner’s template instead.',
            guidedAnswer('Write invitation wording.', ctx),
          );
        }
        return {
          kind: 'draft',
          ...ids,
          provider: LOCAL_INFO,
          title: 'Invitation wording',
          intro: invitation.text,
          items: [],
          note: 'A draft. Nothing is sent from this app; copy it into your own message or card.',
          generated: model([
            ...invitation.warnings,
            ...(result.finishReason === 'length'
              ? ['The model hit its length limit; the ending may be cut off.']
              : []),
          ]),
        };
      }

      const { facts, basis } = factsFor(request.message, ctx);
      const result = await this.model.generate({
        messages: explanationPrompt(facts, request.message),
        maxTokens: LIMITS.explanation.maxTokens,
        temperature: LIMITS.explanation.temperature,
        ...(signal ? { signal } : {}),
        onText: onProgress,
      });
      const text = cleanExplanation(result.text);
      if (!text) return fallback('Local AI did not produce an explanation.', basis);
      const ungrounded = ungroundedFigures(text, facts);
      if (ungrounded.length > 0) {
        return fallback(
          `Local AI’s explanation was discarded because it mentioned figures the planner did not give it (${ungrounded.slice(0, 3).join(', ')}). Here are the planner’s own figures.`,
          basis,
        );
      }
      return {
        kind: 'info',
        ...ids,
        provider: LOCAL_INFO,
        title: 'In plain words',
        paragraphs: text.split(/\n+/).filter((p) => p.trim().length > 0),
        facts: basis.kind === 'info' ? basis.facts : undefined,
        links: basis.kind === 'info' ? basis.links : undefined,
        generated: model([
          'Every figure in this explanation was checked against the planner’s own numbers.',
        ]),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return fallback(
        `Local AI could not answer (${reason}). This is the guided planner’s answer instead.`,
        task === 'explanation' ? factsFor(request.message, ctx).basis : guided,
      );
    }
  }
}
