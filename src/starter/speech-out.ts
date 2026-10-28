// Text-to-speech with Gemini. Ported from the wearable-extension project
// (src/engine/tts.ts and the clip cache in src/index.ts).
//
// What was learned there and is kept here:
// - Gemini TTS is steered by its prompt. A line sent bare is sometimes
//   answered instead of read, and no audio comes back. A lead-in that asks
//   for reading and no answer ("Say the following: ") fixes that.
// - Clips start and end with dead air. It is trimmed to a short breath.
// - AAC is a tenth of the size of WAV, so it reaches the phone sooner. It
//   needs ffmpeg; without ffmpeg the WAV is sent as it is.
// - Fixed short lines ("Hi, I'm listening") are kept on disk, so after the
//   first time they play at once.
// - Making the voice does not throw. No clip means the device reads the line
//   with its own voice.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { geminiHaltReason, postGenerate, redactKey } from './gemini.ts';

export interface Clip {
  audio: Buffer;
  mime: string;
  ext: 'aac' | 'wav';
  seconds: number;
}

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavSeconds(wav: Buffer): number {
  return wav.length > 44 ? (wav.length - 44) / (2 * wav.readUInt32LE(24)) : 0;
}

// Keep a breath at each end, drop the rest of the silence.
export function trimSilence(wav: Buffer, keepLeadMs = 60, keepTailMs = 140): Buffer {
  if (wav.length <= 44) return wav;
  const rate = wav.readUInt32LE(24);
  const pcm = wav.subarray(44);
  const samples = Math.floor(pcm.length / 2);
  const win = Math.max(1, Math.floor(rate * 0.01));
  const loudAt = (w: number): boolean => {
    let sum = 0;
    for (let j = 0; j < win && w * win + j < samples; j++) {
      const v = pcm.readInt16LE((w * win + j) * 2);
      sum += v * v;
    }
    return Math.sqrt(sum / win) > 300;
  };
  const windows = Math.floor(samples / win);
  let first = 0;
  while (first < windows && !loudAt(first)) first++;
  if (first >= windows) return wav;
  let last = windows - 1;
  while (last > first && !loudAt(last)) last--;
  const from = Math.max(0, first * win - Math.floor((rate * keepLeadMs) / 1000));
  const to = Math.min(samples, (last + 1) * win + Math.floor((rate * keepTailMs) / 1000));
  return pcmToWav(Buffer.from(pcm.subarray(from * 2, to * 2)), rate);
}

function joinWavs(wavs: Buffer[]): Buffer {
  if (wavs.length === 1) return wavs[0]!;
  return pcmToWav(Buffer.concat(wavs.map((w) => w.subarray(44))), wavs[0]!.readUInt32LE(24));
}

export const hasFfmpeg = Bun.which('ffmpeg') != null;

export async function toClip(wav: Buffer): Promise<Clip> {
  const seconds = wavSeconds(wav);
  if (!hasFfmpeg) return { audio: wav, mime: 'audio/wav', ext: 'wav', seconds };
  try {
    const ff = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '48k', '-f', 'adts', 'pipe:1'], {
      stdin: wav,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, code] = await Promise.all([new Response(ff.stdout).arrayBuffer(), ff.exited]);
    if (code === 0 && out.byteLength) return { audio: Buffer.from(out), mime: 'audio/aac', ext: 'aac', seconds };
  } catch {
    /* fall through to WAV */
  }
  return { audio: wav, mime: 'audio/wav', ext: 'wav', seconds };
}

// One Gemini TTS call → WAV, or null.
export async function synthesize(text: string, style: string): Promise<Buffer | null> {
  const body = {
    contents: [{ parts: [{ text: (style || 'Say the following: ') + text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.ttsVoice } } },
    },
  };
  const { res, release } = await postGenerate(config.ttsModel, body, 30_000);
  try {
    if (!res.ok) {
      console.warn(`[voice] gemini tts HTTP ${res.status}: ${redactKey((await res.text()).slice(0, 200))}`);
      return null;
    }
    const data: any = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData)?.inlineData;
    if (!inline?.data) return null;
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType || '')?.[1] ?? 24000);
    return trimSilence(pcmToWav(Buffer.from(inline.data, 'base64'), rate));
  } finally {
    release();
  }
}

// Split a long line at sentence ends, so its parts can be made at the same time.
function sentences(text: string, maxWords: number): string[] {
  const parts = text.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + ' ' + p).split(/\s+/).length > maxWords) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

const CACHE_DIR = join(process.cwd(), '.cache', 'voice');
const DISK_CACHE_MAX_WORDS = 14;
const memory = new Map<string, Promise<Clip | null>>();

function cacheKey(text: string, style: string): string {
  return createHash('sha1').update(`${config.ttsModel}|${config.ttsVoice}|${style}|${text}`).digest('hex');
}

// The clip for one line, or null (the device then uses its own voice).
// Does not throw. Calling it twice with the same line makes it once.
export function makeClip(text: string, style = ''): Promise<Clip | null> {
  if (config.voice === 'device' || !config.geminiApiKey || geminiHaltReason()) return Promise.resolve(null);
  const key = cacheKey(text, style);
  const known = memory.get(key);
  if (known) return known;

  const words = text.split(/\s+/).length;
  const file = join(CACHE_DIR, `${key}.wav`);
  const made = (async (): Promise<Clip | null> => {
    if (words <= DISK_CACHE_MAX_WORDS && existsSync(file)) return toClip(readFileSync(file));
    const t0 = Date.now();
    const parts = words > 24 ? sentences(text, 24) : [text];
    const wavs = await Promise.all(parts.map((p) => synthesize(p, style)));
    if (wavs.some((w) => !w)) return null;
    const wav = joinWavs(wavs as Buffer[]);
    console.log(`[voice] ${((Date.now() - t0) / 1000).toFixed(1)} s to make ${words} words`);
    if (words <= DISK_CACHE_MAX_WORDS) {
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, wav);
      } catch {
        /* the cache is a nicety */
      }
    }
    return toClip(wav);
  })().catch((e) => {
    console.warn('[voice] could not make a clip:', e instanceof Error ? e.message : e);
    return null;
  });

  memory.set(key, made);
  // A failure is forgotten at once so the next try can succeed; a success is kept a few minutes.
  void made.then((clip) => setTimeout(() => memory.delete(key), clip ? 5 * 60_000 : 0));
  return made;
}
