// The app loop over the real server and protocol, with a fake device in
// place of the phone: start, speech, typing, button, photo, listen, stop,
// reconnect. No Gemini (see helpers.ts).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { FakeDevice, sleep, tempDir, until } from './helpers.ts';
import { Runtime } from '../src/starter/runtime.ts';
import { startServer } from '../src/starter/server.ts';
import { defineApp, type Photo } from '../src/starter/index.ts';
import { openProfileStore, type ProfileStore } from '../src/toolkit/profile.ts';
import { CLOSE_BAD_TOKEN, CLOSE_REPLACED } from '../src/starter/protocol.ts';

const TOKEN = 'TESTCODE';
let runtime: Runtime;
let store: ProfileStore;
let server: ReturnType<typeof startServer>;
let port: number;
let lastPhoto: Photo | null = null;
const heardInListen: Array<string | null> = [];

const app = defineApp({
  name: 'Test app',
  async onStart(g) {
    await g.say('Hello from the test.');
  },
  async onSpeech(text, g) {
    if (text === 'photo please') {
      lastPhoto = await g.takePhoto({ size: 'low' });
      return g.say(`Got ${lastPhoto.jpeg.length} bytes from the ${lastPhoto.from}.`);
    }
    if (text === 'ask me') {
      await g.say('Yes or no?');
      heardInListen.push(await g.listen({ timeoutMs: 2000 }));
      return;
    }
    if (text === 'crash') throw new Error('on purpose');
    if (text === 'slow') {
      await new Promise((r) => setTimeout(r, 400)); // something Stop cannot cancel
      return g.say('old session speaking');
    }
    if (text === 'read a page') return g.say(Array.from({ length: 30 }, (_, i) => `This is sentence number ${i + 1} of the page.`).join(' '));
    if (text === 'long answer') return g.say('This is the first sentence here. This is the second sentence here. This is the third sentence here.');
    await g.say(`You said: ${text}`);
  },
  async onButton(button, g) {
    await g.say(`Button ${button.press}.`);
  },
});

beforeAll(async () => {
  store = await openProfileStore(tempDir());
  runtime = new Runtime(app, store, 'test');
  server = startServer({ runtime, store, port: 0, token: TOKEN });
  port = server.port!;
});

afterAll(() => {
  runtime.stop();
  server.stop(true);
});

describe('a device', () => {
  test('is refused with the wrong pairing code', async () => {
    const dev = await FakeDevice.connect(port, { token: 'WRONG' });
    await dev.next('refused');
    await until(() => dev.closed != null, 'the socket closes');
    expect(dev.closed!.code).toBe(CLOSE_BAD_TOKEN);
  });

  test('connects, starts the app, and hears onStart', async () => {
    const dev = await FakeDevice.connect(port, { token: TOKEN });
    expect((await dev.next('welcome')).app).toBe('Test app');
    dev.send({ t: 'glasses', connected: true, wifi: false, battery: 80 });
    dev.send({ t: 'active', on: true });
    await dev.next('mic', (m) => m.on);
    const hello = await dev.next('speak');
    expect(hello.text).toBe('Hello from the test.');
    expect(hello.audioPath).toBeNull(); // no Gemini voice in tests: the device reads it itself
    expect(hello.rate).toBe(1);
    const state = await dev.next('state', (m) => m.state.active && m.state.phase === 'listening');
    expect(state.state.app).toBe('Test app');
    dev.close();
    await sleep(50);
  });
});

describe('a running session', () => {
  let dev: FakeDevice;
  beforeAll(async () => {
    runtime.stop();
    dev = await FakeDevice.connect(port, { token: TOKEN });
    await dev.next('welcome');
    dev.send({ t: 'glasses', connected: true, wifi: true, battery: 50 });
    dev.send({ t: 'active', on: true });
    await dev.next('speak', (m) => m.text.startsWith('Hello'));
    await dev.next('state', (m) => m.state.phase === 'listening');
  });

  test('typed text reaches onSpeech, and the answer is spoken', async () => {
    dev.send({ t: 'type', text: 'testing one two' });
    expect((await dev.next('speak')).text).toBe('You said: testing one two');
  });

  test('the button reaches onButton', async () => {
    dev.send({ t: 'button', press: 'long' });
    expect((await dev.next('speak')).text).toBe('Button long.');
  });

  test('a photo is requested, uploaded like the glasses do, and handed to the app', async () => {
    dev.send({ t: 'type', text: 'photo please' });
    const req = await dev.next('photo');
    expect(req.size).toBe('low');
    const jpeg = new Uint8Array(1234).fill(7);
    const form = new FormData();
    form.append('requestId', req.requestId);
    form.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await fetch(`http://localhost:${port}${req.uploadPath}`, { method: 'POST', body: form, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    dev.send({ t: 'reply', id: req.id, ok: true });
    expect((await dev.next('speak')).text).toBe('Got 1234 bytes from the glasses.');
    expect(lastPhoto!.base64.length).toBeGreaterThan(1000);
    // The same upload again is refused: a requestId is good once.
    const again = await fetch(`http://localhost:${port}${req.uploadPath}`, { method: 'POST', body: form });
    expect(again.status).toBe(404);
  });

  test('a camera failure on the device is reported, and the app says sorry', async () => {
    dev.send({ t: 'type', text: 'photo please' });
    const req = await dev.next('photo');
    dev.send({ t: 'reply', id: req.id, ok: false, detail: 'camera busy' });
    expect((await dev.next('speak')).text).toBe('Sorry, something went wrong in the app.');
    expect(runtime.dashState().problem).toContain('camera busy');
  });

  test('listen() gets the next thing said, and onSpeech does not', async () => {
    dev.send({ t: 'type', text: 'ask me' });
    await dev.next('speak', (m) => m.text === 'Yes or no?');
    await dev.next('state', (m) => m.state.status === 'Listening for your answer');
    dev.send({ t: 'type', text: 'yes' });
    await until(() => heardInListen.length === 1, 'listen() resolves');
    expect(heardInListen[0]).toBe('yes');
    await sleep(100);
    expect(dev.spoken()).not.toContain('You said: yes');
  });

  test('an error in the app is reported, and the session keeps going', async () => {
    dev.send({ t: 'type', text: 'crash' });
    expect((await dev.next('speak')).text).toBe('Sorry, something went wrong in the app.');
    expect(runtime.dashState().problem).toContain('on purpose');
    dev.send({ t: 'type', text: 'still there' });
    expect((await dev.next('speak')).text).toBe('You said: still there');
  });

  test('the profile changes how lines are spoken: speed, and one step at a time', async () => {
    await store.setNeed('readAloudRate', 0.8);
    await store.setNeed('pacing', 'stepwise');
    dev.send({ t: 'type', text: 'long answer' });
    const first = await dev.next('speak');
    expect(first.rate).toBe(0.8);
    expect(first.text).toBe('This is the first sentence here. This is the second sentence here.'); // pieces of at most 14 words
    expect((await dev.next('speak')).text).toBe('This is the third sentence here.');

    // Adapting switched off: defaults again, with the same stored profile.
    runtime.setAdapt(false);
    dev.send({ t: 'type', text: 'long answer' });
    const plain = [await dev.next('speak'), await dev.next('speak')];
    expect(plain[0]!.rate).toBe(1);
    // Played back to back in pieces of up to 16 words, so the voice starts sooner.
    expect(plain.map((m) => m.text).join(' ')).toBe('This is the first sentence here. This is the second sentence here. This is the third sentence here.');
    runtime.setAdapt(true);
    await store.replace({ supportAreas: [], needs: [] });
  });

  test('what is said while the app is busy is not handled twice', async () => {
    dev.autoReplySpeak = false;
    dev.send({ t: 'type', text: 'first' });
    const line = await dev.next('speak');
    dev.send({ t: 'type', text: 'second' });
    await sleep(50);
    dev.send({ t: 'reply', id: line.id, ok: true });
    dev.autoReplySpeak = true;
    await sleep(100);
    expect(dev.spoken().filter((t) => t === 'You said: second')).toHaveLength(0);
  });

  test('a reconnecting device carries on the same session', async () => {
    dev.close();
    await sleep(100);
    expect(runtime.dashState().active).toBe(true); // a short gap does not stop it
    dev = await FakeDevice.connect(port, { token: TOKEN, resume: true });
    await dev.next('welcome');
    dev.send({ t: 'type', text: 'back again' });
    expect((await dev.next('speak')).text).toBe('You said: back again');
  });

  test('a second device takes over from the first', async () => {
    const other = await FakeDevice.connect(port, { token: TOKEN, device: 'simulator', name: 'sim' });
    await other.next('welcome');
    await until(() => dev.closed != null, 'the first device is closed');
    expect(dev.closed!.code).toBe(CLOSE_REPLACED);
    expect(runtime.dashState().device?.kind).toBe('simulator');
    dev = other;
  });

  test('Stop: the mic goes off, and lines are no longer spoken', async () => {
    dev.send({ t: 'active', on: false });
    await dev.next('mic', (m) => !m.on);
    await dev.next('state', (m) => !m.state.active);
    const before = dev.spoken().length;
    dev.send({ t: 'type', text: 'are you there' });
    await sleep(100);
    expect(dev.spoken().length).toBe(before);
  });

  test('after someone pressed Stop, a device that comes back does not restart the app', async () => {
    dev.close();
    await sleep(50);
    dev = await FakeDevice.connect(port, { token: TOKEN, resume: true });
    await dev.next('welcome');
    await sleep(150);
    expect(runtime.dashState().active).toBe(false);
    expect(dev.spoken()).toHaveLength(0);
    dev.close();
  });

  test('after a server restart, a device that was running starts the app again', async () => {
    // A restart is a new process: a fresh runtime that has not stopped yet.
    const fresh = new Runtime(app, store, 'test');
    const server2 = startServer({ runtime: fresh, store, port: 0, token: TOKEN });
    const d = await FakeDevice.connect(server2.port!, { token: TOKEN, resume: true });
    expect((await d.next('speak')).text).toBe('Hello from the test.');
    fresh.stop();
    d.close();
    server2.stop(true);
  });
});

describe('sessions do not leak into each other', () => {
  test('a handler still running from before Stop cannot speak, and does not block the new session', async () => {
    const dev = await FakeDevice.connect(port, { token: TOKEN });
    await dev.next('welcome');
    dev.send({ t: 'active', on: true });
    await dev.next('speak', (m) => m.text.startsWith('Hello'));
    dev.send({ t: 'type', text: 'slow' });
    await sleep(50);
    dev.send({ t: 'active', on: false });
    dev.send({ t: 'active', on: true });
    await dev.next('speak', (m) => m.text.startsWith('Hello'));
    dev.send({ t: 'type', text: 'fresh start' });
    expect((await dev.next('speak')).text).toBe('You said: fresh start'); // not dropped as "busy"
    await sleep(500); // the old handler has woken up by now
    expect(dev.spoken()).not.toContain('old session speaking');
    dev.send({ t: 'active', on: false });
    dev.close();
  });

  test('reading a long page aloud uses few voice pieces', async () => {
    const dev = await FakeDevice.connect(port, { token: TOKEN });
    await dev.next('welcome');
    dev.send({ t: 'active', on: true });
    await dev.next('speak', (m) => m.text.startsWith('Hello'));
    const before = dev.spoken().length;
    dev.send({ t: 'type', text: 'read a page' });
    await dev.next('speak', (m) => m.text.includes('number 30 of'));
    const pieces = dev.spoken().slice(before);
    expect(pieces[0]!.split(' ').length).toBeLessThanOrEqual(16); // a short first piece starts sooner
    expect(pieces.length).toBeLessThanOrEqual(8); // 270 words: one voice call per piece
    dev.send({ t: 'active', on: false });
    dev.close();
  });

  test('a malformed frame from a device is ignored', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/device`);
    await new Promise((r) => (ws.onopen = r));
    ws.send('null');
    ws.send('42');
    await sleep(100);
    expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
    ws.close();
  });
});

describe('the dashboard', () => {
  test('answers this laptop, and refuses requests that came through a tunnel', async () => {
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);
    expect((await fetch(`http://localhost:${port}/api/profile`)).status).toBe(200);
    const viaTunnel = await fetch(`http://localhost:${port}/api/profile`, { headers: { 'cf-connecting-ip': '1.2.3.4' } });
    expect(viaTunnel.status).toBe(403);
  });

  test('refuses another site pointed at this laptop, and posts that are not JSON', async () => {
    const rebound = await fetch(`http://localhost:${port}/api/connect`, { headers: { Host: 'evil.example:3000' } });
    expect(rebound.status).toBe(403);
    const form = await fetch(`http://localhost:${port}/api/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }), headers: { 'Content-Type': 'text/plain' } });
    expect(form.status).toBe(415);
  });

  test('the profile editor validates and saves needs through the toolkit', async () => {
    const post = (path: string, body: unknown) =>
      fetch(`http://localhost:${port}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    expect((await post('/api/profile/need', { key: 'readAloudRate', value: 9 })).status).toBe(400);
    const saved = (await (await post('/api/profile/need', { key: 'readAloudRate', value: 1.37 })).json()) as any;
    expect(saved.needs.find((n: any) => n.key === 'readAloudRate').value).toBe(1.4);
    const ex = (await (await post('/api/profile/example', { key: 'slow-steps' })).json()) as any;
    expect(ex.effect).toContain('One step at a time, then waits for you');
    expect((await store.read()).needs.map((n) => n.dimension)).toEqual(['readAloudRate', 'pacing']);
  });

  test('serves sounds with byte ranges, which the iPhone player needs', async () => {
    const res = await fetch(`http://localhost:${port}/sounds/thinking.wav`, { headers: { Range: 'bytes=0-1' } });
    expect(res.status).toBe(206);
    expect((await res.arrayBuffer()).byteLength).toBe(2);
  });
});
