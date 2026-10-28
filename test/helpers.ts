// Test helpers. Tests run without Gemini: the key is cleared and the voice is
// the device's own, so `bun test` is free and works offline.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/starter/config.ts';
import type { DownMessage, UpMessage } from '../src/starter/protocol.ts';

config.geminiApiKey = '';
config.voice = 'device';
config.dataDir = mkdtempSync(join(tmpdir(), 'xr-test-'));

export const tempDir = () => mkdtempSync(join(tmpdir(), 'xr-test-'));

// A device that speaks the protocol, like the phone app or the simulator.
export class FakeDevice {
  inbox: DownMessage[] = [];
  closed: { code: number } | null = null;
  private waiters: Array<{ pred: (m: DownMessage) => boolean; resolve: (m: DownMessage) => void }> = [];
  // Answer speak requests at once, as if each line played instantly.
  autoReplySpeak = true;

  private constructor(readonly ws: WebSocket) {}

  static async connect(port: number, hello: Partial<Extract<UpMessage, { t: 'hello' }>> & { token: string }): Promise<FakeDevice> {
    const ws = new WebSocket(`ws://localhost:${port}/device`);
    const dev = new FakeDevice(ws);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const m = JSON.parse(ev.data) as DownMessage;
      dev.inbox.push(m);
      if (m.t === 'speak' && dev.autoReplySpeak) dev.send({ t: 'reply', id: m.id, ok: true });
      for (const w of [...dev.waiters]) {
        if (w.pred(m)) {
          dev.waiters.splice(dev.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    };
    ws.onclose = (ev) => (dev.closed = { code: ev.code });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('could not connect'));
    });
    dev.send({ t: 'hello', device: 'glasses', name: 'test phone', ...hello } as UpMessage);
    return dev;
  }

  send(m: UpMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  // The next matching message after the last one a test read. Messages that
  // arrived while the test was busy (an upload, a sleep) still count.
  private read = 0;
  next<T extends DownMessage['t']>(t: T, pred: (m: Extract<DownMessage, { t: T }>) => boolean = () => true, timeoutMs = 3000): Promise<Extract<DownMessage, { t: T }>> {
    const match = (m: DownMessage) => m.t === t && pred(m as Extract<DownMessage, { t: T }>);
    for (let i = this.read; i < this.inbox.length; i++) {
      if (match(this.inbox[i]!)) {
        this.read = i + 1;
        return Promise.resolve(this.inbox[i] as Extract<DownMessage, { t: T }>);
      }
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${t}" message within ${timeoutMs} ms. Got: ${this.inbox.slice(this.read).map((m) => m.t).join(', ')}`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          this.read = this.inbox.lastIndexOf(m) + 1;
          resolve(m as Extract<DownMessage, { t: T }>);
        },
      });
    });
  }

  spoken(): string[] {
    return this.inbox.filter((m): m is Extract<DownMessage, { t: 'speak' }> => m.t === 'speak').map((m) => m.text);
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Wait until `check` is true (polling), or fail.
export async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(10);
  }
}
