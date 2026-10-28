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
  // How a photo travels from the glasses. 'auto': over the glasses' Wi-Fi
  // when it can reach this laptop, otherwise through the phone over
  // Bluetooth. 'ble': through the phone (slower, needs no Wi-Fi).
  photoTransfer: text('PHOTO_TRANSFER', 'auto') === 'ble' ? ('ble' as const) : ('auto' as const),

  // The toolkit's profile store, the pairing token and the tunnel address live here.
  dataDir: text('DATA_DIR', './data'),
  // The dashboard shows camera photos, so by default it answers this
  // laptop and refuses other devices. Set to true to open it to your network.
  dashboardFromAnywhere: flag('DASHBOARD_FROM_ANYWHERE', false),
};

export type Config = typeof config;
