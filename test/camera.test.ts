// The live camera, end to end and without glasses. A fake phone answers the
// camera start, and ffmpeg publishes a moving test picture to the starter's
// RTMP port the way the glasses do. The frames then reach onFrame, and
// g.takePhoto returns one at once. Skipped when ffmpeg is not installed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { FakeDevice, tempDir, until } from './helpers.ts';
import { config } from '../src/starter/config.ts';
import { Runtime } from '../src/starter/runtime.ts';
import { startServer } from '../src/starter/server.ts';
import { defineApp, type Photo } from '../src/starter/index.ts';
import { hasFfmpeg } from '../src/starter/speech-out.ts';
import { openProfileStore, type ProfileStore } from '../src/toolkit/profile.ts';

// Away from a starter that may be running on this laptop.
config.rtmpPort = 19350;
config.rtmpHost = '127.0.0.1';

// Bun 1.3's test runner, when it finds the test files itself (`bun test` with
// no path, or with a filter word), starts child processes with no working
// stdio, so ffmpeg cannot run. Named by path it works: `bun run test:camera`,
// which is `bun test ./test/camera.test.ts`. Checked here, so the suite skips
// with a reason instead of failing.
const childrenWork = await new Promise<boolean>((resolve) => {
  const p = spawn('sh', ['-c', 'echo ok'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout!.on('data', (d) => (out += d));
  p.on('exit', () => resolve(out.trim() === 'ok'));
  p.on('error', () => resolve(false));
});
if (hasFfmpeg && !childrenWork) console.log('  the live camera tests are skipped here: run them with `bun run test:camera`');

const TOKEN = 'TESTCODE';
const frames: Photo[] = [];
let lastPhoto: Photo | null = null;

const app = defineApp({
  name: 'Camera test',
  camera: 'live',
  async onFrame(frame) {
    frames.push(frame);
  },
  async onSpeech(text, g) {
    if (text === 'photo please') {
      lastPhoto = await g.takePhoto();
      return g.say(`Got a ${lastPhoto.from} picture.`);
    }
  },
});

let runtime: Runtime;
let store: ProfileStore;
let server: ReturnType<typeof startServer>;
let port: number;
let dev: FakeDevice;
let publisher: ChildProcess | null = null;

describe.skipIf(!hasFfmpeg || !childrenWork)('the live camera', () => {
  beforeAll(async () => {
    store = await openProfileStore(tempDir());
    runtime = new Runtime(app, store, 'test');
    server = startServer({ runtime, store, port: 0, token: TOKEN });
    port = server.port!;
    dev = await FakeDevice.connect(port, { token: TOKEN, glasses: { connected: true, wifi: true, battery: 80 } });
    await dev.next('welcome');
  });

  afterAll(() => {
    publisher?.kill('SIGKILL');
    runtime.stop();
    runtime.shutdown();
    server.stop(true);
  });

  test('Start asks the phone to stream, and the frames reach onFrame', async () => {
    dev.send({ t: 'active', on: true });
    const req = await dev.next('camera-start', () => true, 5000);
    expect(req.url.startsWith('rtmp://127.0.0.1:19350/live/')).toBe(true);
    expect(req).toMatchObject({ fps: 3, width: 1280, height: 720 });
    // The glasses, stood in for by ffmpeg: a test picture that changes every frame.
    publisher = spawn(
      'ffmpeg',
      ['-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '6', '-f', 'flv', req.url],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    publisher.stderr!.on('data', (d: Buffer) => console.log(`  [test publisher] ${String(d).trim()}`));
    dev.send({ t: 'reply', id: req.id, ok: true });
    await until(() => frames.length >= 2, 'two frames for onFrame', 20_000);
    expect(frames[0]!.from).toBe('glasses');
    expect(frames[0]!.jpeg.length).toBeGreaterThan(1000);
    expect(runtime.dashState().camera).toBe('live');
  }, 30_000);

  test('takePhoto returns the newest picture at once, without asking the phone', async () => {
    const photoRequests = () => dev.inbox.filter((m) => m.t === 'photo').length;
    const before = photoRequests();
    const t0 = Date.now();
    dev.send({ t: 'type', text: 'photo please' });
    expect((await dev.next('speak', () => true, 8000)).text).toBe('Got a glasses picture.');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(photoRequests()).toBe(before);
    expect(lastPhoto!.jpeg.length).toBeGreaterThan(1000);
  }, 15_000);

  test('the dashboard can fetch the latest frame', async () => {
    const res = await fetch(`http://localhost:${port}/api/frame.jpg`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  test('Stop tells the phone to stop the stream', async () => {
    dev.send({ t: 'active', on: false });
    await dev.next('camera-stop', () => true, 3000);
    await until(() => runtime.dashState().camera === 'off', 'the camera is off');
    expect(await fetch(`http://localhost:${port}/api/frame.jpg`).then((r) => r.status)).toBe(404);
  });
});
