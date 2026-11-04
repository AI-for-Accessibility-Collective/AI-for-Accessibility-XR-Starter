// The glasses' live camera: video from the glasses to this laptop, read into
// frames that the app can look at at once.
//
//   glasses ──video (RTMP) over Wi-Fi──▶ rtmp.ts on this laptop ──▶ ffmpeg ──▶ frames.ts
//
// The phone only passes the start and the stop on to the glasses
// (phone/src/link.ts). The glasses need to reach this laptop over Wi-Fi: the
// same network, or a hotspot that both are on. A tunnel does not carry video.
//
// Ported from the AI for Accessibility XR project (wearable-extension/
// src/index.ts: startCamera, tryStartCamera, stopCamera and cameraWatch),
// where it ran with these glasses. The comments are theirs where the code is.

import { config } from './config.ts';
import { FrameStore, startFrameCapture } from './frames.ts';
import { lanAddresses } from './network.ts';
import { dropPublishersExcept, getPublishUrl, newStreamKey, startRtmpServer, stopRtmpServer } from './rtmp.ts';
import { hasFfmpeg } from './speech-out.ts';
import type { GlassesInfo } from './runtime.ts';

const CAMERA_RETRIES = 5;
const CAMERA_RETRY_DELAY_MS = 5000;
export const CAMERA_TIMEOUT_MS = 30_000;

// What the dashboard shows about the camera.
export type CameraState = 'off' | 'starting' | 'live' | 'failed';

export interface StreamVideo {
  fps: number;
  width: number;
  height: number;
  bitrate: number;
}

export interface CameraDeps {
  frames: FrameStore;
  // The glasses as the phone last reported them. null: no phone with glasses.
  glasses: () => GlassesInfo | null;
  // Ask the phone to make the glasses publish to `url`. Rejects when they refuse.
  startStream: (url: string, video: StreamVideo) => Promise<void>;
  stopStream: () => void;
  // One line about the camera, for the dashboard's status line. '' clears it.
  setStatus: (text: string) => void;
  log: (level: 'info' | 'warn' | 'error', text: string) => void;
  // A fresh frame arrived (before it is stored).
  onFrame?: (jpeg: Buffer) => void;
}

export class LiveCamera {
  state: CameraState = 'off';

  private wanted = false; // the session is on and the app wants the camera
  private cameraStarted = false;
  private cameraStarting = false;
  private cameraWanted = false;
  private cameraStartedAt = 0;
  private lastCameraRestart = 0;
  private currentStreamKey: string | null = null;
  private captureHandle: ReturnType<typeof startFrameCapture> | null = null;
  private cameraWatch: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: CameraDeps) {}

  // Start was pressed, and the app wants the live camera.
  on(): void {
    this.wanted = true;
    void this.startCamera();
    // The stream can die without saying so: the connection stays open and the
    // pictures just stop. Nothing downstream can tell on its own, so this
    // watches for it: no frame for a while during a take means stop the
    // stream and start it again, and say so.
    if (!this.cameraWatch) this.cameraWatch = setInterval(() => this.watch(), 3000);
  }

  // Stop was pressed.
  off(): void {
    this.wanted = false;
    if (this.cameraWatch) clearInterval(this.cameraWatch);
    this.cameraWatch = null;
    this.stopCamera();
    this.setState('off', '');
  }

  // The glasses connected, dropped, or changed Wi-Fi; or another phone took over.
  glassesChanged(): void {
    if (!this.wanted) return;
    const glasses = this.deps.glasses();
    if (!glasses?.connected || glasses.wifi === false) {
      if (this.cameraStarted) this.deps.log('info', 'The glasses dropped off: stopping the live camera');
      this.cameraStarted = false;
      void this.startCamera(); // sets the "connect…" status
    } else {
      void this.startCamera();
    }
  }

  // Frames are arriving (or about to): g.takePhoto reads them instead of asking for a photo.
  streaming(): boolean {
    return this.cameraStarted && !this.cameraStarting;
  }

  // The server is shutting down.
  dispose(): void {
    this.off();
    this.captureHandle?.stop();
    this.captureHandle = null;
    stopRtmpServer();
  }

  private setState(state: CameraState, status: string): void {
    this.state = state;
    this.deps.setStatus(status);
  }

  // The reader and the RTMP server come up the first time an app wants the
  // camera, and stay up: ffmpeg waits on the stream path and retries by itself.
  private ensureCapture(): void {
    if (this.captureHandle) return;
    startRtmpServer(config.rtmpPort);
    this.captureHandle = startFrameCapture({
      rtmpPort: config.rtmpPort,
      captureFps: config.captureFps,
      onFrame: (jpeg) => {
        this.deps.onFrame?.(jpeg);
        this.deps.frames.push(jpeg);
        if (this.state === 'starting') this.setState('live', '');
      },
    });
  }

  // Any rejection here is caught: a camera that will not start is a line of
  // status; the app still talks.
  private async startCamera(): Promise<void> {
    try {
      // A start asked for while another is still being answered (Stop then
      // Start in quick succession) is remembered, not dropped. Otherwise that
      // take would run with no camera at all and nothing would ever retry it.
      if (this.cameraStarting) return void (this.cameraWanted = true);
      if (this.cameraStarted || !this.wanted) return;
      if (config.video === 'off') return this.setState('off', 'The live camera is off (VIDEO=off in .env)');
      if (!hasFfmpeg) return this.setState('failed', 'Install ffmpeg for the live camera (brew install ffmpeg), then press Stop and Start');
      const glasses = this.deps.glasses();
      if (!glasses) return this.setState('off', '');
      if (!glasses.connected) return this.setState('failed', 'The live camera waits for the glasses. Connect them in the phone app');
      if (glasses.wifi === false) return this.setState('failed', 'The live camera needs the glasses on Wi-Fi. Connect them in the phone app, under Glasses Wi-Fi');
      const host = config.rtmpHost || lanAddresses()[0];
      if (!host) return this.setState('failed', 'No Wi-Fi address found for the live camera. Join a Wi-Fi network, or set RTMP_HOST in .env');
      this.cameraStarted = true;
      this.cameraStarting = true;
      this.ensureCapture();
      // A path of its own for this start, the reader pointed at it, and any
      // stream the glasses left hanging from before cleared away (rtmp.ts).
      const streamKey = newStreamKey();
      this.currentStreamKey = streamKey;
      dropPublishersExcept(streamKey);
      // Nothing from before this stream may be shown or answered from.
      this.deps.frames.clear();
      this.captureHandle?.retarget(streamKey);
      this.cameraStartedAt = Date.now();
      const url = getPublishUrl(host, config.rtmpPort, streamKey);
      this.setState('starting', 'Starting the glasses camera');
      try {
        return await this.tryStartCamera(url);
      } finally {
        this.cameraStarting = false;
        if (this.cameraWanted) {
          this.cameraWanted = false;
          if (this.wanted && !this.cameraStarted) void this.startCamera();
        }
      }
    } catch (e) {
      this.cameraStarted = false;
      this.cameraStarting = false;
      this.setState('failed', `The camera could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async tryStartCamera(url: string): Promise<void> {
    for (let attempt = 1; attempt <= CAMERA_RETRIES; attempt++) {
      try {
        await this.deps.startStream(url, { fps: config.frameRate, width: config.streamWidth, height: config.streamHeight, bitrate: config.streamBitrate });
        if (!this.wanted) return void this.deps.stopStream();
        this.deps.log('info', `The glasses are streaming to ${url} (${config.streamWidth}×${config.streamHeight}, ${config.frameRate} fps)`);
        return this.setState('starting', 'Glasses camera started. Waiting for the first picture');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.deps.log('warn', `Camera attempt ${attempt}/${CAMERA_RETRIES} failed: ${msg}`);
        if (!this.wanted || !this.deps.glasses()?.connected) break;
        if (attempt < CAMERA_RETRIES) await new Promise((r) => setTimeout(r, CAMERA_RETRY_DELAY_MS));
        else this.setState('failed', `The glasses camera did not start: ${msg}`);
      }
    }
    this.cameraStarted = false;
  }

  private stopCamera(): void {
    if (this.cameraStarted || this.cameraStarting) this.deps.stopStream();
    this.cameraStarted = false;
    this.cameraWanted = false;
    this.currentStreamKey = null;
    // The pages go blank rather than hold the take's last picture as if live.
    this.deps.frames.clear();
    // The glasses often leave the stream's connection open and silent instead
    // of closing it. Give them a moment to do it properly, then close it from
    // this end, which also makes sure they really have stopped encoding.
    setTimeout(() => dropPublishersExcept(this.currentStreamKey ?? '(none)'), 2500);
  }

  private watch(): void {
    if (!this.wanted || !this.cameraStarted || this.cameraStarting) return;
    // Silence is counted from this stream's own start, not from the last
    // frame of the previous one. Otherwise every restart would look stalled at once.
    const sinceStart = Date.now() - this.cameraStartedAt;
    const quiet = Math.min(this.deps.frames.sinceLastArrivalMs() ?? sinceStart, sinceStart);
    if (quiet < 12_000 || Date.now() - this.lastCameraRestart < 25_000) return;
    this.lastCameraRestart = Date.now();
    this.deps.log('warn', `No camera frame for ${(quiet / 1000).toFixed(0)} s: restarting the glasses' stream`);
    this.setState('starting', 'The camera stalled. Restarting it');
    this.deps.stopStream();
    this.cameraStarted = false;
    setTimeout(() => void this.startCamera(), 2000);
  }
}
