// Profile in, audio settings out. This is the "surface" step of the toolkit:
// it decides how this app should speak to this person. say() and ai.ask()
// carry the settings out (src/starter/runtime.ts and ai.ts).
//
// Speaking rate, plain language and captions come from the toolkit's own XR
// surface (renderXRSettings). The rest are audio needs that the toolkit's
// vocabulary does not have yet: `pacing` and `spokenDetail`. They come from
// the wearable-extension project (src/toolkit-candidates/xr-audio.ts).
//
// An empty profile gives the defaults: normal speed, and the answer
// without pauses. That is how the app behaves with "Adapt to profile" switched off.

import { rankOf } from '@ai4a11y/toolkit';
import { renderXRSettings } from '@ai4a11y/toolkit/surfaces/xr';
import type { Profile } from './profile.ts';

export interface AudioSettings {
  /** Speaking speed. 1 is normal. Need: `readAloudRate` (toolkit). */
  rate: number;
  /** Say one step, then wait for the person. Need: `pacing: 'stepwise'`. */
  oneStepAtATime: boolean;
  /** One step at a time: the longest piece said before a pause, in words. null: no pauses. */
  maxWordsPerChunk: number | null;
  /** Silence between those pieces, in milliseconds. */
  pauseMs: number;
  /** Plain everyday words. Need: `simplify` (toolkit). */
  plainLanguage: boolean;
  /** How much to say. Need: `spokenDetail`. With no need set: 'gist' for plain language, else 'standard'. */
  detail: 'gist' | 'standard' | 'full';
  /** Show the app's words as large text on the phone. Need: `captions` (toolkit). */
  captions: boolean;
  /** Mention what is in a photo without being asked. Need: `describeImages` (toolkit). */
  describeImages: boolean;
  /** A calm, even voice. On with one-step or plain language. */
  calmVoice: boolean;
}

// The winning value for a dimension: the stronger need wins, ties go to the
// later one. Same rule as the toolkit's surfaces.
export function needValue(profile: Profile | null, dimension: string): unknown {
  let best: { value: unknown; rank: number } | null = null;
  for (const n of profile?.needs ?? []) {
    if (n.dimension !== dimension) continue;
    const rank = rankOf(n.strength ?? 'preference');
    if (!best || rank >= best.rank) best = { value: n.value, rank };
  }
  return best?.value;
}

export function audioSettings(profile: Profile | null): AudioSettings {
  const xr = renderXRSettings({ schemaVersion: 1, supportAreas: profile?.supportAreas ?? [], needs: (profile?.needs ?? []) as any } as any);
  const rate = Number.isFinite(xr.speech.rate) ? Math.min(2, Math.max(0.5, xr.speech.rate)) : 1;
  const plainLanguage = !!xr.simplifyLanguage;
  const oneStepAtATime = needValue(profile, 'pacing') === 'stepwise';
  const detailNeed = needValue(profile, 'spokenDetail');
  const detail = detailNeed === 'gist' || detailNeed === 'full' || detailNeed === 'standard' ? detailNeed : plainLanguage ? 'gist' : 'standard';
  return {
    rate: Math.round(rate * 100) / 100,
    oneStepAtATime,
    maxWordsPerChunk: oneStepAtATime ? 14 : null,
    pauseMs: oneStepAtATime ? 900 : 0,
    plainLanguage,
    detail,
    captions: !!xr.captions.enabled,
    describeImages: needValue(profile, 'describeImages') === true,
    calmVoice: oneStepAtATime || plainLanguage,
  };
}

export const DEFAULT_SETTINGS: AudioSettings = audioSettings(null);

// What the settings do, in plain words, for the dashboard.
export function describeSettings(s: AudioSettings): string[] {
  const lines = [s.rate === 1 ? 'Speaks at normal speed' : `Speaks at ${s.rate}× speed`];
  lines.push(s.oneStepAtATime ? 'One step at a time, then waits for you' : 'Says the answer without pausing');
  if (s.plainLanguage) lines.push('Uses plain everyday words');
  if (s.detail === 'gist') lines.push('Gives the gist first, details if you ask');
  if (s.detail === 'full') lines.push('Gives full detail');
  if (s.captions) lines.push('Shows its words as large text on the phone');
  if (s.describeImages) lines.push('Mentions what is in a photo without being asked');
  if (s.calmVoice) lines.push('Calm, even voice');
  return lines;
}

// Split text at sentence ends into pieces of up to maxWords words.
// A sentence longer than maxWords stays in one piece. null: one piece.
// From the wearable-extension project (adapters/paced-delivery.ts).
export function chunkText(text: string, maxWords: number | null): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (maxWords == null) return [clean];
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const s of clean.split(/(?<=[.!?…])\s+/)) {
    const w = s.split(' ').length;
    if (current.length && words + w > maxWords) {
      chunks.push(current.join(' '));
      current = [];
      words = 0;
    }
    current.push(s);
    words += w;
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}
