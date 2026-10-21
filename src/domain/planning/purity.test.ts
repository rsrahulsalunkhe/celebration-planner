import { describe, expect, it } from 'vitest';

/**
 * The planning engine must be plain TypeScript: no React, no browser, no
 * hidden clock and no randomness. "Today" is always passed in.
 */
const modules = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const sources = Object.entries(modules).map(([path, text]) => ({
  name: path.replace('./', ''),
  text,
}));

/** Source without comments and string literals, so prose cannot trip the checks. */
const code = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g, '""');

describe('planning engine purity', () => {
  it('finds the engine sources', () => {
    expect(sources.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'generate.ts',
        'preview.ts',
        'allocation.ts',
        'forecast.ts',
        'deadlines.ts',
      ]),
    );
  });

  it.each([
    [
      'the clock',
      /\bnew Date\(|Date\.now\b|\btodayIso\b|\bsystemCalendar\b|performance\.now/,
    ],
    ['randomness or id generation', /Math\.random|randomUUID|\bcreateId\b/],
    ['the browser', /\b(window|document|localStorage|sessionStorage|navigator)\b/],
    ['global timers', /\b(setTimeout|setInterval)\b/],
  ])('does not use %s', (_label, pattern) => {
    for (const { name, text } of sources) {
      expect(code(text), name).not.toMatch(pattern);
    }
  });

  it('does not import React, UI code, services or the data layer', () => {
    for (const { name, text } of sources) {
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const spec of imports) {
        expect(spec, `${name} imports ${spec}`).not.toMatch(
          /^(react|react-dom|react-router-dom)/,
        );
        expect(spec, `${name} imports ${spec}`).not.toMatch(
          /^@\/(app|features|services|components|data)/,
        );
      }
    }
  });
});
