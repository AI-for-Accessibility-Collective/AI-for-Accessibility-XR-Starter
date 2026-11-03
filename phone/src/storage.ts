// What the phone remembers between launches: which laptop to connect to,
// which glasses, and whether the phone acts as the glasses. Plain JSON files
// in the app's documents folder.

import { File, Paths } from 'expo-file-system';
import type { Device } from '@mentra/bluetooth-sdk';

export interface Laptop {
  url: string; // http://192.168.1.20:3000 or https://….trycloudflare.com
  token: string; // the pairing code shown on the dashboard
}

function load<T>(name: string): T | null {
  try {
    const file = new File(Paths.document, name);
    return file.exists ? (JSON.parse(file.textSync()) as T) : null;
  } catch {
    return null;
  }
}

function save(name: string, value: unknown): void {
  const file = new File(Paths.document, name);
  if (value == null) {
    if (file.exists) file.delete();
    return;
  }
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(value));
}

export const laptopStore = {
  load: () => load<Laptop>('laptop.json'),
  save: (laptop: Laptop | null) => save('laptop.json', laptop),
};

// 'glasses': the phone links the glasses. 'phone': the phone acts as the glasses.
export type Mode = 'glasses' | 'phone';
export const modeStore = {
  load: (): Mode => (load<Mode>('mode.json') === 'phone' ? 'phone' : 'glasses'),
  save: (mode: Mode) => save('mode.json', mode),
};

// As the glasses: whether the words show on the screen (Text on / Text off).
export const showTextStore = {
  load: (): boolean => load<boolean>('show-text.json') === true,
  save: (on: boolean) => save('show-text.json', on),
};

// The shape useMentraBluetooth wants, so it reconnects to the same glasses on its own.
export const glassesStore = {
  load: async (): Promise<Device | null> => load<Device>('default-glasses.json'),
  save: async (device: Device | null): Promise<void> => save('default-glasses.json', device),
};

// xrstarter://connect?url=…&token=… (the dashboard's QR code), or null.
export function parsePairingLink(link: string): Laptop | null {
  if (!/^xrstarter:\/\/connect\b/i.test(link)) return null;
  const params: Record<string, string> = {};
  for (const part of (link.split('?')[1] ?? '').split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) params[k] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return params.url && params.token ? cleanLaptop(params.url, params.token) : null;
}

// Typed in by hand: add http:// if missing, drop a trailing slash.
export function cleanLaptop(url: string, token: string): Laptop | null {
  let u = url.trim().replace(/\/+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return { url: u, token: token.trim().toUpperCase() };
}
