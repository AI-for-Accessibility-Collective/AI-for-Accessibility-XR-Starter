// The phone's job: hold the Bluetooth link to the glasses (Mentra
// Bluetooth SDK) and relay between them and the laptop over one WebSocket
// (../../src/starter/protocol.ts).
//
//   glasses mic     ──PCM──▶  laptop      (while the mic is on, paused while a line plays)
//   laptop  ──audio clip──▶  phone plays it ──▶ glasses speaker (the phone's Bluetooth audio)
//   laptop  ──"photo"──▶  glasses take it and upload it to the laptop (over Wi-Fi, or through this phone)
//   glasses button  ──▶  laptop
//
// With `phone` set ("Use this phone"), the phone stands in for the glasses
// and the laptop sees a simulator:
//
//   phone mic       ──PCM──▶  laptop      (through the same SDK event)
//   laptop  ──audio clip──▶  phone speaker
//   laptop  ──"photo"──▶  phone camera, then the phone uploads it
//   on-screen button  ──▶  laptop
//
// Adapted from the wearable-extension project (phone/src/useGuideLink.ts),
// where each rule below was learned on real glasses.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import BluetoothSdk from '@mentra/bluetooth-sdk';
import { File } from 'expo-file-system';
import type { DeviceState, DownMessage, LightColor, UpMessage } from '../../src/starter/protocol.ts';
import type { Laptop } from './storage';
import { announcing } from './a11y';

// Repeated from protocol.ts (a type-only import cannot carry values).
const DEVICE_WS_PATH = '/device';
const CLOSE_REPLACED = 4000;
const CLOSE_BAD_TOKEN = 4401;

const PING_MS = 20_000;
// Quick at first: the laptop restarts each time someone saves a file.
const RECONNECT_MS = [500, 1000, 2000, 3000, 5000];

export type LinkStatus = 'none' | 'connecting' | 'connected' | 'refused' | 'offline' | 'replaced';

export interface Link {
  status: LinkStatus;
  // What the laptop welcomed this phone as. While the phone switches between
  // the two, the old connection can still read 'connected' for a moment.
  connectedAs: 'phone' | 'glasses' | null;
  detail: string;
  state: DeviceState | null;
  light: LightColor | null; // the glasses light, shown on screen when the phone is the glasses
  setActive: (on: boolean) => void;
  type: (text: string) => void;
  button: (press: 'short' | 'long') => void;
}

// What the phone needs when it acts as the glasses.
export interface PhoneParts {
  takePhoto: () => Promise<string>; // the photo's file URI
}

export function useLink(
  laptop: Laptop | null,
  glasses: { connected: boolean; wifi: boolean | null; battery: number | null; ssid: string | null; ip: string | null },
  phone: PhoneParts | null,
): Link {
  const [status, setStatus] = useState<LinkStatus>(laptop ? 'connecting' : 'none');
  const [detail, setDetail] = useState('');
  const [connectedAs, setConnectedAs] = useState<'phone' | 'glasses' | null>(null);
  const [state, setState] = useState<DeviceState | null>(null);
  const [light, setLight] = useState<LightColor | null>(null);
  const asPhone = phone != null;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;

  const wsRef = useRef<WebSocket | null>(null);
  const welcomedRef = useRef(false);
  const activeRef = useRef(false); // the app was running: resume after a reconnect
  const micOnRef = useRef(false);
  const playingRef = useRef(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const cueRef = useRef<AudioPlayer | null>(null);
  const cueOnRef = useRef(false);
  // The live camera (src/starter/camera.ts). A stop that is still being
  // carried out, so a start that lands meanwhile waits for it.
  const stoppingRef = useRef<Promise<void> | null>(null);
  const ledTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const glassesRef = useRef(glasses);
  glassesRef.current = glasses;

  const send = useCallback((m: UpMessage): void => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && (welcomedRef.current || m.t === 'hello')) ws.send(JSON.stringify(m));
  }, []);

  // ── "Working on it" sound ─────────────────────────────────────────────────
  // A quiet loop while the app is thinking, so the wearer does not take silence to mean "it did
  // not hear me". The file is served by the laptop.
  const setCue = useCallback(
    (on: boolean): void => {
      if (on === cueOnRef.current || !laptop) return;
      cueOnRef.current = on;
      try {
        if (on) {
          if (!cueRef.current) {
            const cue = createAudioPlayer({ uri: `${laptop.url}/sounds/thinking.wav` }, { keepAudioSessionActive: asPhone });
            cue.loop = true;
            cue.volume = 0.5;
            cueRef.current = cue;
          }
          void cueRef.current.seekTo(0);
          cueRef.current.play();
        } else cueRef.current?.pause();
      } catch (e) {
        console.warn('thinking sound failed', e);
      }
    },
    [laptop, asPhone],
  );

  // ── Speaking ──────────────────────────────────────────────────────────────
  // Silence, now. Each step is guarded on its own, and the line that was
  // playing is reported finished, so the laptop does not wait for it.
  const stopAudio = useCallback((): void => {
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      try {
        player.pause(); // stops the sound at once; remove() alone can let the buffer play out
      } catch {}
      try {
        player.remove();
      } catch {}
    }
    try {
      void Speech.stop();
    } catch {}
    playingRef.current = false;
    void BluetoothSdk.setOwnAppAudioPlaying(false).catch(() => {});
    const finish = finishRef.current;
    finishRef.current = null;
    finish?.();
  }, []);

  // Resolves when the line has finished playing, or was stopped.
  const speak = useCallback(
    (m: Extract<DownMessage, { t: 'speak' }>): Promise<void> =>
      new Promise<void>((resolve) => {
        if (!laptop) return resolve();
        stopAudio();
        setCue(false);
        playingRef.current = true;
        // Tells the SDK to keep the glasses mic out of the speaker's way.
        void BluetoothSdk.setOwnAppAudioPlaying(true).catch(() => {});
        let done = false;
        let player: AudioPlayer | null = null;
        const finish = (): void => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          if (finishRef.current === finish) finishRef.current = null;
          if (player && playerRef.current === player) {
            try {
              player.remove();
            } catch {}
            playerRef.current = null;
          }
          playingRef.current = false;
          void BluetoothSdk.setOwnAppAudioPlaying(false).catch(() => {});
          resolve();
        };
        // A clip that does not report its end must not block the app: a few
        // seconds to start, then the clip's own remaining length.
        let guard = setTimeout(finish, 8000);
        const arm = (ms: number) => {
          clearTimeout(guard);
          guard = setTimeout(finish, ms);
        };
        finishRef.current = finish;
        const rate = Math.min(2, Math.max(0.5, m.rate || 1));

        if (!m.audioPath) {
          // The phone's own voice: about 2.5 words a second, plus some grace.
          arm(8000 + (m.text.split(/\s+/).length / 2.5 / rate) * 1000);
          Speech.speak(m.text, { rate, onDone: finish, onStopped: finish, onError: finish });
          return;
        }
        try {
          // keepAudioSessionActive: when a clip ends, expo-audio would
          // otherwise switch the audio session off, and the phone mic with it.
          player = createAudioPlayer({ uri: laptop.url + m.audioPath }, { updateInterval: 200, keepAudioSessionActive: asPhone });
          playerRef.current = player;
          // Speed from the profile, pitch kept natural.
          if (rate !== 1) player.setPlaybackRate(rate, 'high');
          player.addListener('playbackStatusUpdate', (s) => {
            if (s.didJustFinish) return finish();
            if (s.playing && s.duration > 0) arm(((s.duration - s.currentTime) / rate) * 1000 + 3000);
          });
          player.play();
        } catch {
          finish(); // no player: the line is skipped
        }
      }),
    [laptop, asPhone, stopAudio, setCue],
  );

  // ── Photo ─────────────────────────────────────────────────────────────────
  // The glasses upload straight to the laptop over Wi-Fi when they can. When
  // they cannot (no Wi-Fi, or the laptop is out of reach), the SDK sends the
  // photo through this phone over Bluetooth and the phone uploads it.
  // When the phone is the glasses, it takes the photo itself and uploads it
  // over the network, as a form post with the photo and its requestId.
  const photo = useCallback(
    async (m: Extract<DownMessage, { t: 'photo' }>): Promise<void> => {
      if (!laptop) throw new Error('no laptop');
      if (phoneRef.current) {
        const uri = await phoneRef.current.takePhoto();
        try {
          const form = new FormData();
          form.append('requestId', m.requestId);
          form.append('photo', { uri, name: `${m.requestId}.jpg`, type: 'image/jpeg' } as unknown as Blob);
          const res = await fetch(laptop.url + m.uploadPath, { method: 'POST', body: form, headers: { Authorization: `Bearer ${laptop.token}` } });
          if (!res.ok) throw new Error(`the upload failed (${res.status})`);
        } finally {
          try {
            new File(uri).delete();
          } catch {}
        }
        return;
      }
      if (!glassesRef.current.connected) throw new Error('the glasses are not connected to the phone');
      await BluetoothSdk.requestPhoto({
        requestId: m.requestId,
        size: m.size,
        mode: m.mode,
        webhookUrl: laptop.url + m.uploadPath,
        authToken: laptop.token,
        compress: 'medium',
        sound: true,
        save: false,
        transferMethod: m.transfer === 'ble' || glassesRef.current.wifi !== true ? 'ble' : 'auto',
      });
    },
    [laptop],
  );

  // ── The live camera's light ───────────────────────────────────────────────
  // A green light on the glasses while they stream video, so people nearby
  // can tell. The LED command lasts 30 s at most, so it is repeated.
  // From the wearable-extension project (phone/src/useGuideLink.ts).
  const setCameraLight = useCallback((on: boolean): void => {
    if (ledTimerRef.current) clearInterval(ledTimerRef.current);
    ledTimerRef.current = null;
    const light = (): void =>
      void BluetoothSdk.rgbLedControl(`cam-${Date.now()}`, null, 'on', 'green', 30_000, 0, 1).catch((e) => console.warn('camera light failed', e));
    if (on) {
      light();
      ledTimerRef.current = setInterval(light, 25_000);
    } else {
      void BluetoothSdk.rgbLedControl(`cam-${Date.now()}`, null, 'off', null, 0, 0, 0).catch(() => {});
    }
  }, []);

  // ── The connection to the laptop ──────────────────────────────────────────
  useEffect(() => {
    if (!laptop) {
      setStatus('none');
      setState(null);
      return;
    }
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let lightTimer: ReturnType<typeof setTimeout> | null = null;

    // With the glasses: a plain playback session, on purpose. The glasses are
    // a Bluetooth media output (A2DP, like headphones). A recording session
    // switches iOS to hands-free-call Bluetooth, and then the voice does not
    // reach the glasses. The phone does not record: the glasses mic arrives
    // as data.
    // As the glasses: the phone records and plays, out of its loudspeaker.
    void setAudioModeAsync(
      asPhone
        ? { allowsRecording: true, shouldPlayInBackground: false, playsInSilentMode: true, interruptionMode: 'mixWithOthers', shouldRouteThroughEarpiece: false }
        : { allowsRecording: false, shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: 'duckOthers' },
    ).catch(() => {});

    const reply = (id: number, ok: boolean, detail?: string) => send({ t: 'reply', id, ok, detail });
    const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

    // Mic on/off, applied in the order they were asked for: two quick
    // changes must not finish the wrong way round and leave the mic on.
    // The two capture settings are set once per connection, so turning the
    // mic on for an answer does not clip its first words.
    let micChain: Promise<void> = Promise.resolve();
    let micConfigured = false;
    const applyMic = (on: boolean): void => {
      micChain = micChain.then(async () => {
        // false: the phone's own mic, through the same mic_pcm event.
        if (asPhone) return BluetoothSdk.setMicState(on, false).catch((e) => console.warn('setMicState failed', e));
        if (on && !micConfigured) {
          // Continuous audio with quiet input gated to silence: what the
          // laptop's utterance detector expects.
          await BluetoothSdk.setVoiceActivityDetectionEnabled(false).catch(() => {});
          await BluetoothSdk.setLoudnessGateEnabled(true).catch(() => {});
          micConfigured = true;
        }
        await BluetoothSdk.setMicState(on, true).catch((e) => console.warn('setMicState failed', e));
      });
    };

    const onMessage = (m: DownMessage): void => {
      switch (m.t) {
        case 'welcome':
          welcomedRef.current = true;
          attempt = 0;
          setStatus('connected');
          setConnectedAs(asPhone ? 'phone' : 'glasses');
          setDetail(m.app);
          if (!asPhone) send({ t: 'glasses', ...glassesRef.current });
          break;
        case 'refused':
          setStatus('refused');
          setDetail(m.reason);
          break;
        case 'state':
          setState(m.state);
          activeRef.current = m.state.active;
          if (!m.state.active && (playingRef.current || playerRef.current)) stopAudio();
          setCue(m.state.active && m.state.phase === 'thinking' && !playingRef.current);
          break;
        case 'mic':
          micOnRef.current = m.on;
          applyMic(m.on);
          break;
        case 'speak':
          void speak(m).then(() => reply(m.id, true));
          break;
        case 'stop-audio':
          stopAudio();
          break;
        case 'photo':
          photo(m).then(
            () => reply(m.id, true),
            (e) => reply(m.id, false, errorText(e)),
          );
          break;
        case 'light':
          if (asPhone) {
            if (lightTimer) clearTimeout(lightTimer);
            setLight(m.color);
            lightTimer = m.color ? setTimeout(() => setLight(null), m.ms) : null;
          } else void BluetoothSdk.rgbLedControl(`led-${Date.now()}`, null, m.color ? 'on' : 'off', m.color, m.color ? m.ms : 0, 0, 1).catch(() => {});
          break;
        // The live camera, as the wearable-extension project did it
        // (phone/src/useGuideLink.ts). The glasses publish video to the
        // laptop's RTMP address; this phone only passes the start and stop on.
        case 'camera-start':
          if (asPhone) return reply(m.id, false, 'the phone as the glasses has no live camera');
          // The glasses run one stream, and a start that lands while a stop is
          // still being carried out is refused ("preempted"). So: stop first,
          // wait for it, then start.
          (stoppingRef.current ?? Promise.resolve())
            .then(() =>
              BluetoothSdk.startStream({
                type: 'start_stream',
                streamUrl: m.url,
                video: { fps: m.fps, width: m.width, height: m.height, bitrate: m.bitrate },
                sound: false,
              }),
            )
            .then(
              () => {
                setCameraLight(true);
                reply(m.id, true);
              },
              (e: unknown) => reply(m.id, false, errorText(e)),
            );
          break;
        case 'camera-stop': {
          if (asPhone) break;
          setCameraLight(false);
          const stopping = BluetoothSdk.stopStream()
            .then(() => undefined)
            .catch(() => undefined)
            .finally(() => {
              if (stoppingRef.current === stopping) stoppingRef.current = null;
            });
          stoppingRef.current = stopping;
          break;
        }
      }
    };

    const connect = (): void => {
      if (closed) return;
      setStatus((s) => (s === 'refused' ? s : 'connecting'));
      setConnectedAs(null);
      welcomedRef.current = false;
      const ws = new WebSocket(laptop.url.replace(/^http/, 'ws') + DEVICE_WS_PATH);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      micConfigured = false;
      // Each handler first checks the event is from the current socket. An
      // old one (the laptop before a QR scan) can close a minute later, and
      // must not reset the new connection.
      ws.onopen = () => {
        if (closed || wsRef.current !== ws) return;
        send(
          asPhone
            ? { t: 'hello', token: laptop.token, device: 'simulator', name: 'Phone simulator', camera: 'phone', resume: activeRef.current }
            : {
                t: 'hello',
                token: laptop.token,
                device: 'glasses',
                name: Platform.OS === 'ios' ? 'iPhone' : 'Android phone',
                resume: activeRef.current,
                glasses: glassesRef.current,
              },
        );
      };
      ws.onmessage = (ev) => {
        if (closed || wsRef.current !== ws || typeof ev.data !== 'string') return;
        try {
          onMessage(JSON.parse(ev.data) as DownMessage);
        } catch {}
      };
      ws.onclose = (ev) => {
        if (closed || wsRef.current !== ws) return;
        wsRef.current = null;
        welcomedRef.current = false;
        setConnectedAs(null);
        // The laptop reset its state when it lost us; match it.
        micOnRef.current = false;
        stopAudio();
        setCue(false);
        applyMic(false);
        setState(null);
        if (!asPhone) {
          setCameraLight(false);
          void BluetoothSdk.stopStream().catch(() => {});
        }
        if (ev.code === CLOSE_BAD_TOKEN) return setStatus('refused');
        if (ev.code === CLOSE_REPLACED) {
          activeRef.current = false;
          setStatus('replaced');
          setDetail('Another phone took over.');
          return;
        }
        setStatus('offline');
        retry = setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
      };
      ws.onerror = () => {};
    };

    activeRef.current = false;
    connect();
    const ping = setInterval(() => send({ t: 'ping' }), PING_MS);

    // Glasses mic → laptop, as raw binary frames.
    const mic = BluetoothSdk.addListener('mic_pcm', (event) => {
      const ws = wsRef.current;
      // Also quiet while VoiceOver / TalkBack reads one of the app's messages (a11y.ts).
      if (!micOnRef.current || playingRef.current || cueOnRef.current || !welcomedRef.current || announcing()) return;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(event.pcm);
    });
    // The glasses button → laptop. As the glasses, the phone sends its on-screen button instead.
    const button = BluetoothSdk.addListener('button_press', (event) => {
      if (!asPhone) send({ t: 'button', press: event.pressType === 'long' ? 'long' : 'short', buttonId: event.buttonId });
    });
    // The glasses' own account of their camera stream, for the laptop's log.
    const streamStatus = BluetoothSdk.addListener('stream_status', (event) => {
      if (asPhone) return;
      const e = event as { status?: string; errorDetails?: string; reason?: string; attempt?: number; maxAttempts?: number };
      const detail = e.errorDetails ?? e.reason ?? (e.attempt != null ? `attempt ${e.attempt}${e.maxAttempts ? '/' + e.maxAttempts : ''}` : undefined);
      send({ t: 'camera-status', status: String(e.status ?? 'unknown'), detail });
    });

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (lightTimer) clearTimeout(lightTimer);
      setLight(null);
      clearInterval(ping);
      mic.remove();
      button.remove();
      streamStatus.remove();
      wsRef.current?.close();
      stopAudio();
      setCue(false);
      cueRef.current?.remove();
      cueRef.current = null;
      void BluetoothSdk.setMicState(false).catch(() => {});
      if (!asPhone) {
        setCameraLight(false);
        void BluetoothSdk.stopStream().catch(() => {});
      }
    };
  }, [laptop, asPhone, send, speak, photo, stopAudio, setCue, setCameraLight]);

  // Keep the laptop told about the glasses.
  useEffect(() => {
    if (!asPhone) send({ t: 'glasses', connected: glasses.connected, wifi: glasses.wifi, battery: glasses.battery, ssid: glasses.ssid, ip: glasses.ip });
  }, [send, asPhone, glasses.connected, glasses.wifi, glasses.battery, glasses.ssid, glasses.ip]);

  return {
    status,
    connectedAs,
    detail,
    state,
    light,
    setActive: (on) => {
      if (!on) {
        // Stop means silence now, not after a round trip.
        stopAudio();
        setCue(false);
      }
      send({ t: 'active', on });
    },
    type: (text) => send({ t: 'type', text }),
    button: (press) => send({ t: 'button', press }),
  };
}
