// bun run check: is this laptop ready? Run it once after setup.
//
//   bun run check            the full check, including 4 small Gemini calls
//   bun run check --offline  skips the Gemini calls
//
// The live part makes a spoken clip with Gemini's voice and then has Gemini
// write it down again, so it tests the same speech path the glasses use.

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { config } from '../src/starter/config.ts';
import { generate, resolveModel } from '../src/starter/gemini.ts';
import { transcribe } from '../src/starter/speech-in.ts';
import { hasFfmpeg, synthesize, toClip } from '../src/starter/speech-out.ts';
import { lanAddresses, tunnelUrl } from '../src/starter/network.ts';
import { openProfileStore } from '../src/toolkit/profile.ts';
import { audioSettings } from '../src/toolkit/settings.ts';
import { profilePrompt } from '../src/toolkit/prompt.ts';

const offline = process.argv.includes('--offline');
let failures = 0;
const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);
const fail = (msg: string, fix?: string) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${msg}${fix ? `\n      → ${fix}` : ''}`);
};
async function step(name: string, fn: () => Promise<string | void>, fix?: string) {
  try {
    const detail = await fn();
    ok(detail ? `${name}: ${detail}` : name);
  } catch (e) {
    fail(`${name}: ${e instanceof Error ? e.message : e}`, fix);
  }
}

console.log('\nSetup');
const [major, minor] = Bun.version.split('.').map(Number);
if (major! > 1 || (major === 1 && minor! >= 1)) ok(`bun ${Bun.version}`);
else fail(`bun ${Bun.version} is too old`, 'run: bun upgrade');
if (!existsSync('.env')) warn('no .env file yet. Run: cp .env.example .env, then add your GEMINI_API_KEY');
if (config.geminiApiKey) ok('GEMINI_API_KEY is set');
else fail('GEMINI_API_KEY is not set', 'put your key in .env (https://aistudio.google.com/apikey)');
if (hasFfmpeg) ok('ffmpeg found (voice clips are sent as AAC, which is smaller)');
else warn('ffmpeg not found. That is fine: voice clips are sent as WAV. Install it (brew install ffmpeg) for smaller clips.');

console.log('\nToolkit');
await step('the toolkit stores and reads a profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xr-check-'));
  try {
    const store = await openProfileStore(dir);
    await store.setNeed('readAloudRate', 0.8);
    await store.setNeed('pacing', 'stepwise');
    const p = await store.read();
    const s = audioSettings(p);
    if (s.rate !== 0.8 || !s.oneStepAtATime) throw new Error(`unexpected settings ${JSON.stringify(s)}`);
    if (!profilePrompt(p, s).includes('ONE next action')) throw new Error('the prompt directives are missing');
    return 'speed 0.8×, one step at a time';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 'run: bun install');

console.log('\nNetwork');
const lan = lanAddresses();
if (lan.length) ok(`this laptop's address on the network: ${lan.map((ip) => `http://${ip}:${config.port}`).join(', ')}`);
else warn('no network address found. Join a Wi-Fi network, or use bun run tunnel.');
const tunnel = tunnelUrl();
if (tunnel) ok(`the tunnel is running: ${tunnel}`);
else console.log(`  · no tunnel running (needed when the phone cannot reach ${lan[0] ?? 'this laptop'}). Start one with: bun run tunnel`);
await step(`port ${config.port}`, async () => {
  try {
    const s = Bun.serve({ port: config.port, fetch: () => new Response('ok') });
    s.stop(true);
    return 'free';
  } catch {
    const res = (await fetch(`http://localhost:${config.port}/health`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; app?: string } | null;
    if (res?.ok) return `in use by the starter (${res.app}), which is fine`;
    throw new Error('in use by another program');
  }
}, `stop the other program, or set PORT=${config.port + 1} in .env`);

if (offline || !config.geminiApiKey) {
  console.log(`\nGemini: skipped${offline ? ' (--offline)' : ' (no key)'}`);
} else {
  console.log('\nGemini (4 small calls)');
  await step('text', async () => {
    const out = await generate({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }], temperature: 0 });
    if (!/ready/i.test(out)) throw new Error(`unexpected reply "${out}"`);
    return `${resolveModel(config.model)} answered`;
  }, 'check the key, or set GEMINI_MODEL in .env');

  await step('vision', async () => {
    const out = await generate({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: redSquarePng().toString('base64') } }, { text: 'What colour is this picture? One word.' }] }],
      temperature: 0,
    });
    if (!/red/i.test(out)) throw new Error(`expected "red", got "${out}"`);
    return 'it saw a red square';
  });

  let wav: Buffer | null = null;
  await step('voice (text to speech)', async () => {
    wav = await synthesize('Testing the glasses, one two three.', '');
    if (!wav) throw new Error('no audio came back (see the [voice] line above)');
    const clip = await toClip(wav);
    return `${clip.seconds.toFixed(1)} s of the ${config.ttsVoice} voice, sent to devices as ${clip.ext.toUpperCase()}`;
  }, 'set VOICE=device in .env to use the phone’s own voice instead');

  await step('speech to text (that voice clip, written down again)', async () => {
    if (!wav) throw new Error('needs the voice clip from the step above');
    const text = await transcribe(to16k(wav));
    if (!/test/i.test(text)) throw new Error(`heard "${text}"`);
    return `heard "${text}"`;
  });
}

console.log(failures ? `\n\x1b[31m${failures} problem${failures > 1 ? 's' : ''} to fix.\x1b[0m See the arrows above.\n` : '\n\x1b[32mReady.\x1b[0m Next: bun run dev, then open http://localhost:' + config.port + '\n');
process.exit(failures ? 1 : 0);

// ── helpers ──────────────────────────────────────────────────────────────────

// Gemini's voice is 24 kHz; the glasses mic is 16 kHz. Resample, then return the PCM.
function to16k(wav: Buffer): Buffer {
  const rate = wav.readUInt32LE(24);
  const input = wav.subarray(44);
  const n = Math.floor(input.length / 2);
  const outN = Math.floor((n * 16000) / rate);
  const out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const x = (i * rate) / 16000;
    const a = Math.floor(x);
    const b = Math.min(n - 1, a + 1);
    const v = input.readInt16LE(a * 2) * (1 - (x - a)) + input.readInt16LE(b * 2) * (x - a);
    out.writeInt16LE(Math.round(v), i * 2);
  }
  return out;
}

// A 64×64 red PNG, built by hand so the check needs no image files.
function redSquarePng(): Buffer {
  const size = 64;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([220, 30, 30]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

