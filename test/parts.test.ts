// The pieces on their own: the toolkit settings and prompt, the profile
// editor's checks, the speech segmenter, and spoken-text cleanup.

import { describe, expect, test } from 'bun:test';
import './helpers.ts';
import { audioSettings, chunkText, DEFAULT_SETTINGS, needValue } from '../src/toolkit/settings.ts';
import { profilePrompt } from '../src/toolkit/prompt.ts';
import { checkNeedValue, EXAMPLE_PROFILES, NEEDS } from '../src/toolkit/needs.ts';
import { createSegmenter } from '../src/starter/speech-in.ts';
import { spoken } from '../src/starter/ai.ts';
import { pcmToWav, trimSilence } from '../src/starter/speech-out.ts';

describe('settings (the toolkit surface)', () => {
  test('an empty profile gives the defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ rate: 1, oneStepAtATime: false, maxWordsPerChunk: null, pauseMs: 0, plainLanguage: false, detail: 'standard', captions: false });
  });

  test('toolkit needs and audio needs both apply', () => {
    const s = audioSettings({
      supportAreas: ['cognitive'],
      needs: [
        { dimension: 'readAloudRate', value: 0.8 },
        { dimension: 'simplify', value: true },
        { dimension: 'pacing', value: 'stepwise' },
        { dimension: 'captions', value: true },
      ],
    });
    expect(s).toMatchObject({ rate: 0.8, plainLanguage: true, oneStepAtATime: true, detail: 'gist', captions: true, calmVoice: true });
    expect(s.maxWordsPerChunk).toBe(14);
  });

  test('the stronger need wins, as in the toolkit', () => {
    const p = { supportAreas: [], needs: [{ dimension: 'readAloudRate', value: 0.7, strength: 'floor' as const }, { dimension: 'readAloudRate', value: 1.3 }] };
    expect(needValue(p, 'readAloudRate')).toBe(0.7);
    expect(audioSettings(p).rate).toBe(0.7);
  });

  test('speed is kept between 0.5 and 2', () => {
    expect(audioSettings({ supportAreas: [], needs: [{ dimension: 'readAloudRate', value: 9 }] }).rate).toBe(2);
  });

  test('each example profile renders', () => {
    for (const ex of EXAMPLE_PROFILES) expect(() => audioSettings({ supportAreas: ex.supportAreas, needs: ex.needs })).not.toThrow();
  });
});

describe('the prompt directives', () => {
  test('an empty profile adds no lines', () => {
    expect(profilePrompt({ supportAreas: [], needs: [] }, DEFAULT_SETTINGS)).toBe('');
  });

  test('one step at a time is added for spoken answers, and left out for data', () => {
    const p = { supportAreas: [], needs: [{ dimension: 'pacing', value: 'stepwise' }, { dimension: 'simplify', value: true }] };
    const s = audioSettings(p);
    expect(profilePrompt(p, s)).toContain('ONE next action');
    expect(profilePrompt(p, s, { forData: true })).not.toContain('ONE next action');
    expect(profilePrompt(p, s, { forData: true })).toContain('plain everyday words');
  });
});

describe('the profile editor checks', () => {
  test('values are checked and snapped', () => {
    expect(checkNeedValue('readAloudRate', '0.84')).toEqual({ ok: true, value: 0.8 });
    expect(checkNeedValue('readAloudRate', 3).ok).toBe(false);
    expect(checkNeedValue('pacing', 'stepwise')).toEqual({ ok: true, value: 'stepwise' });
    expect(checkNeedValue('pacing', 'fast').ok).toBe(false);
    expect(checkNeedValue('captions', 'yes').ok).toBe(false);
    expect(checkNeedValue('nope', true).ok).toBe(false);
  });

  test('each need has a default its own check accepts', () => {
    for (const n of NEEDS) expect(checkNeedValue(n.key, n.default).ok).toBe(true);
  });
});

describe('chunkText', () => {
  test('null keeps one piece; a limit keeps sentences intact', () => {
    expect(chunkText('One. Two.', null)).toEqual(['One. Two.']);
    expect(chunkText('One two three. Four five. Six seven eight nine.', 5)).toEqual(['One two three. Four five.', 'Six seven eight nine.']);
    expect(chunkText('A very long sentence that is longer than the limit allows.', 3)).toHaveLength(1);
  });
});

describe('the speech segmenter', () => {
  const RATE = 16_000;
  const tone = (ms: number) => {
    const b = Buffer.alloc((RATE * ms) / 1000 * 2);
    for (let i = 0; i < b.length / 2; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * 8000), i * 2);
    return b;
  };
  const quiet = (ms: number) => Buffer.alloc((RATE * ms) / 1000 * 2);

  test('speech between silences is one utterance', () => {
    const got: Buffer[] = [];
    const seg = createSegmenter({ onUtterance: (pcm) => got.push(pcm) });
    seg.push(quiet(500));
    seg.push(tone(800));
    seg.push(quiet(1200));
    expect(got).toHaveLength(1);
    expect(got[0]!.length / 2 / RATE).toBeGreaterThan(0.8);
  });

  test('a click is not an utterance', () => {
    const got: Buffer[] = [];
    const seg = createSegmenter({ onUtterance: (pcm) => got.push(pcm) });
    seg.push(tone(60));
    seg.push(quiet(1500));
    expect(got).toHaveLength(0);
  });

  test('flush ends an utterance at once (push-to-talk), reset throws it away', () => {
    const got: Buffer[] = [];
    const seg = createSegmenter({ onUtterance: (pcm) => got.push(pcm) });
    seg.push(tone(500));
    seg.flush();
    expect(got).toHaveLength(1);
    seg.push(tone(500));
    seg.reset();
    seg.push(quiet(1500));
    expect(got).toHaveLength(1);
  });

  test('a tentative guess is made, then held or withdrawn', () => {
    const events: string[] = [];
    const seg = createSegmenter(
      { onTentative: () => events.push('guess'), onTentativeWithdrawn: () => events.push('withdrawn'), onUtterance: (_p, held) => events.push(held ? 'held' : 'fresh') },
      { tentativeSilenceMs: 400 },
    );
    seg.push(tone(500));
    seg.push(quiet(500));
    seg.push(tone(300));
    seg.push(quiet(1200));
    expect(events).toEqual(['guess', 'withdrawn', 'guess', 'held']);
  });
});

describe('spoken text', () => {
  test('markdown that would be read aloud is removed', () => {
    expect(spoken('**Hello** there.\n- one\n- two\n# Title')).toBe('Hello there. one two Title');
  });

  test('silence is trimmed from voice clips, leaving a breath', () => {
    const rate = 24_000;
    const pcm = Buffer.alloc(rate * 2 * 2); // 2 s
    for (let i = rate / 2; i < rate; i++) pcm.writeInt16LE(9000, i * 2); // sound from 0.5 to 1.0 s
    const trimmed = trimSilence(pcmToWav(pcm, rate));
    const seconds = (trimmed.length - 44) / 2 / rate;
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(0.8);
  });
});
