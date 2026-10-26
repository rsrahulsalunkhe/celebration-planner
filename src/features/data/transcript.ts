import type { TranscriptLine } from '@/services/export.ts';
import type { ChatMessage } from '@/features/assistant/assistantSession.ts';

/** Plain text of this session's conversation, for an export the user opted into. */
export function transcriptOf(messages: readonly ChatMessage[]): TranscriptLine[] {
  return messages.flatMap((m): TranscriptLine[] => {
    if (m.role === 'user') return [{ role: 'user', text: m.text }];
    if (m.role !== 'assistant') return [];
    const r = m.response;
    const text =
      r.kind === 'question'
        ? r.text
        : r.kind === 'info'
          ? [r.title, ...r.paragraphs].join('\n')
          : r.kind === 'draft'
            ? [
                r.title,
                r.intro,
                ...r.items.map((i) => `- ${i.title}: ${i.details}`),
                r.note,
              ].join('\n')
            : [r.title, r.explanation].join('\n');
    return [{ role: 'assistant', text }];
  });
}
