// Speech-to-text. The device sends raw mic audio (16 kHz, 16-bit, mono PCM).
// The segmenter cuts it into utterances, and Gemini writes down each one.
// Ported from the wearable-extension project (src/engine/stt.ts).
//
// Why on the laptop and not the phone: the Bluetooth SDK's on-phone
// transcription needs a speech model installed on the phone. One Gemini call
// per utterance works the same for the glasses and the simulator.

import { generate } from './gemini.ts';
import { pcmToWav } from './speech-out.ts';
import { config } from './config.ts';
import { MIC_SAMPLE_RATE } from './protocol.ts';

const WINDOW_MS = 20;
const WINDOW_BYTES = (MIC_SAMPLE_RATE * 2 * WINDOW_MS) / 1000;

export interface SegmenterOpts {
  // RMS level (of 32768) above which a 20 ms window counts as speech. The
  // glasses' loudness gate already turns quiet input into silence.
  threshold?: number;
  minSpeechMs?: number; // speech must last this long to start an utterance (a click does not)
  endSilenceMs?: number; // this much quiet ends it
  preRollMs?: number; // kept from before the first loud window, so first syllables survive
  maxUtteranceMs?: number; // cut off here however long the person talks
  // Quiet this long is a first guess that the person has finished. The
  // runtime starts transcribing then, and reuses the result if the guess holds.
  tentativeSilenceMs?: number;
}

export interface SegmenterEvents {
  onStart?(agoMs: number): void;
  // `tentativeHeld`: a tentative guess was made and not withdrawn, so work
  // started on it still applies.
  onUtterance(pcm: Buffer, tentativeHeld: boolean): void;
  onTentative?(pcm: Buffer): void;
  onTentativeWithdrawn?(): void;
}

function rms(window: Buffer): number {
  let sum = 0;
  const n = Math.floor(window.length / 2);
  for (let i = 0; i < n; i++) {
    const s = window.readInt16LE(i * 2);
    sum += s * s;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

// Feed it PCM as it arrives. Pure and synchronous: no clock, no I/O.
export function createSegmenter(events: SegmenterEvents, opts: SegmenterOpts = {}) {
  const threshold = opts.threshold ?? 600;
  const minSpeech = Math.ceil((opts.minSpeechMs ?? 120) / WINDOW_MS);
  const endSilence = Math.ceil((opts.endSilenceMs ?? 900) / WINDOW_MS);
  const preRollN = Math.ceil((opts.preRollMs ?? 300) / WINDOW_MS);
  const maxWindows = Math.ceil((opts.maxUtteranceMs ?? 15_000) / WINDOW_MS);
  const tentativeN = opts.tentativeSilenceMs != null ? Math.ceil(opts.tentativeSilenceMs / WINDOW_MS) : null;

  let carry: Buffer = Buffer.alloc(0);
  let preRoll: Buffer[] = [];
  let current: Buffer[] | null = null;
  let loudRun = 0;
  let quietRun = 0;
  let tentative = false;

  const close = (): void => {
    if (!current) return;
    // Drop the trailing quiet, bar a short tail.
    const keep = Math.max(1, current.length - Math.max(0, quietRun - 5));
    const pcm = Buffer.concat(current.slice(0, keep));
    const held = tentative;
    current = null;
    loudRun = 0;
    quietRun = 0;
    tentative = false;
    preRoll = [];
    events.onUtterance(pcm, held);
  };

  return {
    push(chunk: Buffer): void {
      carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      while (carry.length >= WINDOW_BYTES) {
        const window = carry.subarray(0, WINDOW_BYTES);
        carry = carry.subarray(WINDOW_BYTES);
        const loud = rms(window) >= threshold;
        if (current) {
          current.push(window);
          quietRun = loud ? 0 : quietRun + 1;
          if (loud && tentative) {
            tentative = false;
            events.onTentativeWithdrawn?.();
          }
          if (tentativeN != null && !tentative && quietRun === tentativeN && events.onTentative) {
            tentative = true;
            events.onTentative(Buffer.concat(current.slice(0, current.length - quietRun + 5)));
          }
          if (quietRun >= endSilence || current.length >= maxWindows) close();
          continue;
        }
        preRoll.push(window);
        if (preRoll.length > preRollN + minSpeech) preRoll.shift();
        loudRun = loud ? loudRun + 1 : 0;
        if (loudRun >= minSpeech) {
          current = preRoll;
          preRoll = [];
          quietRun = 0;
          events.onStart?.(minSpeech * WINDOW_MS);
        }
      }
    },
    // End the utterance now (push-to-talk: the person let go of Talk).
    flush(): void {
      if (current) {
        tentative = false;
        close();
      }
    },
    // Throw away speech that was half-heard (the app started talking, or Stop).
    reset(): void {
      carry = Buffer.alloc(0);
      preRoll = [];
      current = null;
      loudRun = 0;
      quietRun = 0;
      if (tentative) events.onTentativeWithdrawn?.();
      tentative = false;
    },
  };
}

export type Segmenter = ReturnType<typeof createSegmenter>;

const INSTRUCTION =
  'You transcribe one short utterance spoken to a smart-glasses assistant. ' +
  'Reply with the words spoken, word for word, in plain text, with no other words. ' +
  'If there is no intelligible speech, reply with an empty line.';

// The words, or '' when the speech was unintelligible.
export async function transcribe(pcm: Buffer): Promise<string> {
  const out = await generate({
    model: config.sttModel,
    system: INSTRUCTION,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: pcmToWav(pcm, MIC_SAMPLE_RATE).toString('base64') } }] }],
    maxOutputTokens: 200,
    temperature: 0,
    timeoutMs: 15_000,
  });
  const text = out.trim().replace(/^["'“]|["'”]$/g, '');
  // A cough or a clatter sometimes comes back as "_" or "…".
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}
