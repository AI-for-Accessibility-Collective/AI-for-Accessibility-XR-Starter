// Settings, read from .env (Bun loads it on its own). Each value has a
// default except the Gemini key. .env.example explains each one.

function text(name: string, fallback: string): string {
  return (process.env[name] ?? '').trim() || fallback;
}

function int(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function flag(name: string, fallback: boolean): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

const model = text('GEMINI_MODEL', 'gemini-3.5-flash');

export const config = {
  port: int('PORT', 3000),

  geminiApiKey: text('GEMINI_API_KEY', ''),
  // Answers, photo descriptions and speech-to-text. gemini-3.5-flash was the
  // fastest accurate model for spoken answers when the wearable-extension
  // project compared them. If a key cannot use it, the app falls back to
  // FALLBACK_MODEL on its own.
  model,
  sttModel: text('STT_MODEL', model),
  fallbackModel: text('FALLBACK_MODEL', 'gemini-flash-latest'),
  ttsModel: text('TTS_MODEL', 'gemini-3.1-flash-tts-preview'),
  ttsFallbackModel: text('TTS_FALLBACK_MODEL', 'gemini-2.5-flash-preview-tts'),
  ttsVoice: text('TTS_VOICE', 'Kore'),
  // 'gemini': natural voice, made with Gemini (about 2 to 5 s per sentence).
  // 'device': the phone's or browser's built-in voice. Instant and free.
  voice: text('VOICE', 'gemini') === 'device' ? ('device' as const) : ('gemini' as const),
  // A line whose Gemini voice is not ready by then is read by the device's own voice.
  ttsDeadlineMs: int('TTS_DEADLINE_MS', 8000),

  // Spending safety. Past either limit Gemini is switched off until the
  // server restarts. A normal session needs a few calls a minute.
  maxCallsPerMinute: int('GEMINI_MAX_CALLS_PER_MINUTE', 60),
  maxCallsPerRun: int('GEMINI_MAX_CALLS_PER_RUN', 800),
  // No speech, typing or button press for this long while running: Stop.
  idleStopMin: int('IDLE_STOP_MIN', 20),

  // The address the phone uses to reach this laptop. Empty: found on its own
  // (the tunnel's address when `bun run tunnel` is running, else this laptop's
  // Wi-Fi address).
  publicUrl: text('PUBLIC_URL', '').replace(/\/+$/, ''),
  // Where people get the XR Starter phone app. The dashboard shows these as
  // QR codes. Android: the newest APK in this repo's GitHub Releases
  // (.github/workflows/android-apk.yml). iPhone: the TestFlight public link,
  // once the organiser has one (phone/README.md). Empty: not offered.
  androidAppUrl: text('ANDROID_APP_URL', 'https://github.com/AI-for-Accessibility-Collective/AI-for-Accessibility-XR-Starter/releases/latest/download/XR-Starter.apk'),
  iosAppUrl: text('IOS_APP_URL', ''),
  // How a photo travels from the glasses. 'auto': over the glasses' Wi-Fi
  // when it can reach this laptop, otherwise through the phone over
  // Bluetooth. 'ble': through the phone (slower, needs no Wi-Fi).
  photoTransfer: text('PHOTO_TRANSFER', 'auto') === 'ble' ? ('ble' as const) : ('auto' as const),

  // The glasses' live camera (camera.ts): video from the glasses to this
  // laptop while an app with `camera: 'live'` or `onFrame` runs. It needs
  // the glasses on a Wi-Fi network that reaches this laptop, and ffmpeg.
  // 'off' disables it, and such apps fall back to single photos.
  video: text('VIDEO', 'auto') === 'off' ? ('off' as const) : ('auto' as const),
  // The port the glasses publish to, and this laptop's address as the glasses
  // reach it. Empty: this laptop's Wi-Fi address.
  rtmpPort: int('RTMP_PORT', 1935),
  rtmpHost: text('RTMP_HOST', ''),
  // The values below are the ones the wearable-extension project settled on
  // with these glasses.
  frameRate: int('FRAME_RATE', 3),
  // Picture the glasses are asked to send. Left to themselves they send 854×480,
  // too soft to read a dial or a label; 720p reads well and still streams
  // comfortably over ordinary Wi-Fi.
  streamWidth: int('STREAM_WIDTH', 1280),
  streamHeight: int('STREAM_HEIGHT', 720),
  // 3 frames a second needs little: 3 Mbit/s stalled the glasses' stream about
  // fifteen seconds in, every take. 1.2 is ample for 720p stills at this rate.
  streamBitrate: int('STREAM_BITRATE', 1_200_000),
  captureFps: int('CAPTURE_FPS', 3),
  frameRingSize: int('FRAME_RING_SIZE', 3),
  // A spoken question is answered from what the camera saw when the person
  // began to speak. Video reaches this laptop later than their voice does
  // (encoding and buffering, against the mic's Bluetooth hop), so the frame
  // for "the moment they started" arrives about this much after their first word.
  frameLagMs: int('FRAME_LAG_MS', 1000),
  // How often onFrame runs: 1 to 3 times a second.
  framesPerSecond: Math.min(3, Math.max(1, int('FRAMES_PER_SECOND', 1))),

  // The toolkit's profile store, the pairing token and the tunnel address live here.
  dataDir: text('DATA_DIR', './data'),
  // The dashboard shows camera photos, so by default it answers this
  // laptop and refuses other devices. Set to true to open it to your network.
  dashboardFromAnywhere: flag('DASHBOARD_FROM_ANYWHERE', false),
};

export type Config = typeof config;
