// The wire between a device and this server: one WebSocket at /device.
//
// Two kinds of device speak it, and the server treats them the same:
//   - the phone app in phone/, which holds the Bluetooth link to the glasses
//   - the simulator on the dashboard, which uses the laptop's mic, webcam and speaker
//
// JSON text frames carry the messages below. Binary frames going up are
// microphone audio: 16 kHz, 16-bit, mono, little-endian PCM.
//
// The phone app imports the types from this file with `import type`, so keep
// it free of Node, Bun, DOM and React Native APIs. It cannot import the
// constants at the bottom; phone/src/link.ts repeats the few it needs.

export type DeviceKind = 'glasses' | 'simulator';

// What the app is doing right now. Devices show it, and the phone plays a
// soft "working on it" sound while it is 'thinking'. 'idle': running, with
// the mic off until the app asks something (listen: 'when-asked').
export type Phase = 'off' | 'idle' | 'listening' | 'thinking' | 'speaking';

// Pushed to the device when it changes.
export interface DeviceState {
  app: string; // the app's name, from defineApp()
  active: boolean; // Start was pressed
  phase: Phase;
  heard: string; // the last thing the person said
  said: string; // the last line the app spoke
  status: string; // one line about what is going on
  captions: boolean; // the profile asks for the app's words as large text
  problem: string | null; // something the person must know about (no key, Gemini off, app error)
}

export type PhotoSize = 'low' | 'medium' | 'high';

// ── device → server ──────────────────────────────────────────────────────────
export type UpMessage =
  // `resume`: the device was running before the connection dropped (or the
  // server restarted after a code change), so start again straight away.
  // `glasses`: their state right now, so an app that resumes at once knows it.
  | { t: 'hello'; token: string; device: DeviceKind; name: string; resume?: boolean; glasses?: { connected: boolean; wifi: boolean | null; battery: number | null } }
  | { t: 'glasses'; connected: boolean; wifi: boolean | null; battery: number | null }
  | { t: 'active'; on: boolean }
  // Typed instead of spoken.
  | { t: 'type'; text: string }
  | { t: 'button'; press: 'short' | 'long'; buttonId?: string }
  // Push-to-talk (simulator): the person let go of Talk, so the utterance is over.
  | { t: 'talk-end' }
  // Answers a DownRequest once the device is done with it.
  | { t: 'reply'; id: number; ok: boolean; detail?: string }
  | { t: 'ping' };

// ── server → device ──────────────────────────────────────────────────────────
// Requests carry an id and are answered with a 'reply'.
export type DownRequest =
  // Play one line. audioPath null: no audio was made, so the device reads
  // `text` with its own voice. `rate` is the playback speed (1 = normal).
  | { t: 'speak'; id: number; text: string; audioPath: string | null; rate: number }
  // Take a photo and upload it (multipart: `photo` file + `requestId`) to
  // uploadPath on this server. The reply comes after the upload.
  // transfer 'ble': the photo must go through the phone over Bluetooth.
  | { t: 'photo'; id: number; requestId: string; uploadPath: string; size: PhotoSize; mode: 'photo' | 'text'; transfer: 'auto' | 'ble' };

export type LightColor = 'red' | 'green' | 'blue' | 'orange' | 'white';

export type DownMessage =
  | DownRequest
  | { t: 'welcome'; app: string }
  | { t: 'refused'; reason: string }
  | { t: 'mic'; on: boolean }
  | { t: 'stop-audio' }
  // The glasses' RGB light, on for `ms`. null turns it off.
  | { t: 'light'; color: LightColor | null; ms: number }
  | { t: 'state'; state: DeviceState };

export const DEVICE_WS_PATH = '/device';
export const PHOTO_UPLOAD_PATH = '/upload/photo';
export const MIC_SAMPLE_RATE = 16_000;

// WebSocket close codes the server uses.
export const CLOSE_REPLACED = 4000; // another device connected and took over
export const CLOSE_BAD_TOKEN = 4401; // wrong pairing token: retrying will not help
