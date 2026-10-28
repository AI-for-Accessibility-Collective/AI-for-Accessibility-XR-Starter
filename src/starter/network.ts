// How the phone finds this laptop, and the QR code that tells it.
//
// The phone needs an address it can reach. In order of preference:
//   1. PUBLIC_URL from .env, if you set one (ngrok, a server of your own)
//   2. the tunnel, while `bun run tunnel` runs in another terminal
//   3. this laptop's Wi-Fi address (works when the phone is on the same Wi-Fi,
//      and the network lets devices reach each other)
//
// The QR code holds an xrstarter:// link with the address and a pairing
// token. The iPhone camera app opens it in the XR Starter app.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.ts';

export interface PhoneAddress {
  url: string | null;
  how: 'PUBLIC_URL' | 'tunnel' | 'wifi' | 'none';
  others: string[];
}

// IPv4 addresses other devices on the network could use, best first.
export function lanAddresses(): string[] {
  const out: Array<{ ip: string; score: number }> = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      // Wi-Fi and Ethernet first; VPNs and virtual adapters last.
      const virtual = /^(utun|tun|tap|vbox|vmnet|docker|br-|bridge|awdl|llw|zt|tailscale)/i.test(name);
      const privateNet = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ ip: a.address, score: (virtual ? 0 : 2) + (privateNet ? 1 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((a) => a.ip);
}

const TUNNEL_FILE = () => join(config.dataDir, 'tunnel.json');

// The tunnel's address, if `bun run tunnel` is running.
export function tunnelUrl(): string | null {
  try {
    const t = JSON.parse(readFileSync(TUNNEL_FILE(), 'utf8')) as { url?: string; pid?: number };
    if (!t.url || !t.pid) return null;
    process.kill(t.pid, 0); // throws if that process has ended
    return t.url;
  } catch {
    return null;
  }
}

export function writeTunnel(url: string | null): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(TUNNEL_FILE(), JSON.stringify(url ? { url, pid: process.pid, at: Date.now() } : {}));
}

export function phoneAddress(port: number): PhoneAddress {
  const wifi = lanAddresses().map((ip) => `http://${ip}:${port}`);
  if (config.publicUrl) return { url: config.publicUrl, how: 'PUBLIC_URL', others: wifi };
  const tunnel = tunnelUrl();
  if (tunnel) return { url: tunnel, how: 'tunnel', others: wifi };
  if (wifi.length) return { url: wifi[0]!, how: 'wifi', others: wifi.slice(1) };
  return { url: null, how: 'none', others: [] };
}

// A short code the phone must present. Made once, kept in data/.
// No 0/O or 1/I, so it can be typed from the screen.
export function pairingToken(): string {
  const file = join(config.dataDir, 'pairing-token.txt');
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t) return t;
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const token = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file, token + '\n');
  return token;
}

export function pairingLink(url: string, token: string): string {
  return `xrstarter://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

export function qrTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
}
