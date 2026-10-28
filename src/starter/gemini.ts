// The one place a Gemini request is made: text, photos, speech-to-text and
// text-to-speech come through here. Ported from the wearable-extension
// project (src/engine/gemini-rest.ts), where each rule below was learned.
//
// - The API key goes in the x-goog-api-key header and stays out of the URL. It is
//   removed from error messages. (Fetch errors can print the URL.)
// - Thinking: thought tokens count against maxOutputTokens, which cut spoken
//   answers off mid-sentence. So each model is asked for no thinking first
//   (thinkingBudget 0), then low thinking, then its default, and the first
//   setting it accepts is remembered.
// - A model the key cannot use (HTTP 404) is retried once with the fallback
//   model, and the swap is remembered.
// - Spending guard: past the per-minute or per-run limit, later
//   requests are refused until restart. haltGemini() does the same on purpose.

import { config } from './config.ts';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

// ── spending guard ───────────────────────────────────────────────────────────

let haltReason: string | null = null;
let callsThisRun = 0;
let recent: number[] = [];
const inFlight = new Set<AbortController>();
const haltListeners: Array<(reason: string) => void> = [];

export function onGeminiHalt(fn: (reason: string) => void): void {
  haltListeners.push(fn);
}

export function geminiHaltReason(): string | null {
  return haltReason;
}

export function geminiCallCount(): number {
  return callsThisRun;
}

// Refuse later requests and cancel the ones in flight.
export function haltGemini(reason: string): void {
  if (haltReason) return;
  haltReason = reason;
  cancelGemini(reason);
  for (const fn of haltListeners) fn(reason);
}

// Cancel what is in flight. Later requests still go out.
export function cancelGemini(reason: string): void {
  for (const c of inFlight) c.abort(new Error(reason));
  inFlight.clear();
}

class MissingKey extends Error {}

// Admit one request, or throw. Pass `signal` to fetch, and call `release` once done.
export function guardedRequest(timeoutMs: number): { signal: AbortSignal; release: () => void } {
  if (!config.geminiApiKey) throw new MissingKey('GEMINI_API_KEY is not set. Put your key in .env and restart.');
  if (haltReason) throw new Error(`Gemini is switched off (${haltReason}). Restart the server to turn it back on.`);
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= config.maxCallsPerMinute) {
    haltGemini(`${recent.length} requests in one minute reached GEMINI_MAX_CALLS_PER_MINUTE. Something may be looping`);
  } else if (callsThisRun >= config.maxCallsPerRun) {
    haltGemini(`${callsThisRun} requests reached GEMINI_MAX_CALLS_PER_RUN`);
  }
  if (haltReason) throw new Error(`Gemini is switched off (${haltReason}).`);
  recent.push(now);
  callsThisRun++;
  const controller = new AbortController();
  inFlight.add(controller);
  return {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
    release: () => void inFlight.delete(controller),
  };
}

export function redactKey(text: string): string {
  const key = config.geminiApiKey;
  return key ? text.split(key).join('[key]') : text;
}

// ── model fallback ───────────────────────────────────────────────────────────

const swapped = new Map<string, string>();

export function resolveModel(model: string): string {
  return swapped.get(model) ?? model;
}

function fallbackFor(model: string): string | null {
  const fb = /tts/i.test(model) ? config.ttsFallbackModel : config.fallbackModel;
  return fb && fb !== model ? fb : null;
}

// POST to models/<model>:generateContent, swapping in the fallback model once
// on a 404. Returns the response as it is; the caller reads it.
export async function postGenerate(model: string, body: unknown, timeoutMs: number): Promise<{ res: Response; model: string; release: () => void }> {
  let current = resolveModel(model);
  for (let attempt = 0; ; attempt++) {
    const request = guardedRequest(timeoutMs);
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${current}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (e) {
      request.release();
      // Aborted: the reason says why (a timeout, or a Stop). Otherwise a network error.
      const reason: unknown = request.signal.reason ?? e;
      const why =
        (reason as { name?: string } | null)?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms`
        : reason instanceof Error ? reason.message
        : String(reason);
      throw new Error(redactKey(`gemini ${current}: ${why}`));
    }
    const fb = res.status === 404 && attempt === 0 ? fallbackFor(current) : null;
    if (!fb) return { res, model: current, release: request.release };
    request.release();
    console.warn(`[gemini] ${current} is not available to this key; using ${fb} instead`);
    swapped.set(model, fb);
    current = fb;
  }
}

// ── generateContent ──────────────────────────────────────────────────────────

const LADDER: Array<Record<string, unknown> | null> = [{ thinkingBudget: 0 }, { thinkingLevel: 'low' }, null];
const acceptedRung = new Map<string, number>();

export interface GenerateOpts {
  model?: string;
  system?: string;
  contents: GeminiContent[];
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  json?: boolean;
}

export async function generate(opts: GenerateOpts): Promise<string> {
  const model = opts.model ?? config.model;
  let rung = acceptedRung.get(resolveModel(model)) ?? 0;
  let firstRejection = '';
  for (;;) {
    const thinking = LADDER[rung];
    const generationConfig: Record<string, unknown> = {
      // A runaway guard, not a brevity control: brevity comes from the prompt.
      maxOutputTokens: thinking ? (opts.maxOutputTokens ?? 1024) : Math.max(opts.maxOutputTokens ?? 1024, 8192),
      temperature: opts.temperature ?? 0.3,
    };
    if (thinking) generationConfig.thinkingConfig = thinking;
    if (opts.json) generationConfig.responseMimeType = 'application/json';
    const body: Record<string, unknown> = { contents: opts.contents, generationConfig };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    const timeoutMs = opts.timeoutMs ?? (thinking ? 30_000 : 90_000);

    const { res, model: used, release } = await postGenerate(model, body, timeoutMs);
    try {
      if (res.ok) {
        const data: any = await res.json();
        acceptedRung.set(used, rung);
        const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
        const out = parts.map((p) => (typeof p?.text === 'string' && !p.thought ? p.text : '')).join('').trim();
        const blocked = data?.promptFeedback?.blockReason;
        if (!out && blocked) throw new Error(`gemini blocked the request (${blocked})`);
        return out;
      }
      const detail = redactKey((await res.text()).slice(0, 300));
      // Some models refuse thinkingBudget 0 (or thinkingLevel) with a 400: try the next setting.
      if (res.status === 400 && thinking && rung < LADDER.length - 1) {
        firstRejection ||= detail;
        rung++;
        continue;
      }
      throw new Error(`gemini ${used} HTTP ${res.status}: ${detail}${firstRejection ? ` (first rejection: ${firstRejection.slice(0, 120)})` : ''}`);
    } finally {
      release();
    }
  }
}

export function isMissingKey(e: unknown): boolean {
  return e instanceof MissingKey;
}
