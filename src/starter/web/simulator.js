// The laptop simulator: this browser tab acts as the glasses. It speaks the
// same protocol as the phone app (src/starter/protocol.ts), so your app
// cannot tell the difference:
//   mic     → 16 kHz PCM up the WebSocket (mic-worklet.js)
//   speaker ← plays each spoken line, then says it has finished
//   camera  ← takes a webcam frame and uploads it like the glasses do
//   button  → the "Glasses button" on the page

export function createSimulator({ token, onChange }) {
  const sim = {
    connected: false,
    running: false, // the server says the app is started
    micWanted: false,
    playing: false,
    level: 0,
    camera: false,
    talkMode: 'always', // 'always' | 'hold'
    talking: false,
    light: null,
    error: '',
    takenOver: false, // the real glasses connected and replaced the simulator
  };
  let ws = null;
  let closedByUs = false;
  let retry = 0;
  let retryTimer = null;
  let stream = null;
  let audioCtx = null;
  let video = null;
  let current = null; // { audio, utterance, finish }
  let cue = null;
  let lastState = null;
  let lightTimer = null;

  const changed = () => onChange({ ...sim });
  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
  const reply = (id, ok, detail) => send({ t: 'reply', id, ok, detail });

  // ── media ────────────────────────────────────────────────────────────────
  async function startMedia(videoEl) {
    video = videoEl;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      sim.camera = true;
    } catch {
      // No webcam (or it was refused): carry on with the mic alone.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      sim.camera = false;
    }
    if (sim.camera) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
    audioCtx = new AudioContext();
    await audioCtx.audioWorklet.addModule('/web/mic-worklet.js');
    const source = audioCtx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(audioCtx, 'mic-worklet');
    node.port.onmessage = ({ data }) => {
      sim.level = data.level;
      const open = sim.micWanted && !sim.playing && !cue?.on && (sim.talkMode === 'always' || sim.talking);
      if (open && ws && ws.readyState === 1) ws.send(data.pcm);
      levelListeners.forEach((fn) => fn(data.level, open));
    };
    source.connect(node);
    // The worklet needs to be pulled by the graph; a muted gain keeps it silent.
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(audioCtx.destination);
  }

  const levelListeners = new Set();

  function stopMedia() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    if (video) video.srcObject = null;
    sim.camera = false;
  }

  // ── speaking ─────────────────────────────────────────────────────────────
  function stopAudio() {
    const c = current;
    current = null;
    if (!c) return;
    try {
      c.audio?.pause();
    } catch {}
    if (c.utterance) speechSynthesis.cancel();
    c.finish();
  }

  function speak(m) {
    stopAudio();
    setCue(false);
    sim.playing = true;
    changed();
    let done = false;
    const finish = (ok = true, detail) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (current && current.finish === finishThis) current = null;
      sim.playing = false;
      changed();
      reply(m.id, ok, detail);
    };
    const finishThis = () => finish(true);
    // A line that does not report its end must not block the app.
    const words = m.text.split(/\s+/).length;
    const guard = setTimeout(finishThis, (words / 2.2 / (m.rate || 1)) * 1000 + 10000);
    // Once: a clip that fails can report it twice (error event and play()).
    let ownVoiceUsed = false;
    const ownVoice = () => {
      if (ownVoiceUsed || done) return;
      ownVoiceUsed = true;
      const u = new SpeechSynthesisUtterance(m.text);
      u.rate = m.rate || 1;
      u.onend = finishThis;
      u.onerror = finishThis;
      current = { utterance: u, finish: finishThis };
      speechSynthesis.speak(u);
    };
    if (!m.audioPath) return ownVoice();
    const audio = new Audio(m.audioPath);
    audio.preservesPitch = true;
    audio.playbackRate = m.rate || 1;
    audio.onended = finishThis;
    audio.onerror = () => ownVoice();
    current = { audio, finish: finishThis };
    audio.play().catch(() => ownVoice());
  }

  // The "working on it" sound while the app is thinking.
  function setCue(on) {
    if (!cue) {
      const a = new Audio('/sounds/thinking.wav');
      a.loop = true;
      a.volume = 0.35;
      cue = { audio: a, on: false };
    }
    if (on === cue.on) return;
    cue.on = on;
    if (on) {
      cue.audio.currentTime = 0;
      cue.audio.play().catch(() => {});
    } else cue.audio.pause();
  }

  // ── camera ───────────────────────────────────────────────────────────────
  async function photo(m) {
    try {
      if (!sim.camera || !video || !video.videoWidth) throw new Error('This laptop has no webcam the simulator can use.');
      const maxW = m.size === 'low' ? 640 : m.size === 'high' ? 1920 : 1280;
      const scale = Math.min(1, maxW / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      const form = new FormData();
      form.append('requestId', m.requestId);
      form.append('photo', blob, `${m.requestId}.jpg`);
      const res = await fetch(m.uploadPath, { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      flash();
      reply(m.id, true);
    } catch (e) {
      reply(m.id, false, e.message || String(e));
    }
  }

  let flashListener = () => {};
  const flash = () => flashListener();

  // ── the link ─────────────────────────────────────────────────────────────
  function connect() {
    retryTimer = null;
    if (closedByUs) return;
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/device`);
    ws = sock;
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      if (ws !== sock) return;
      send({ t: 'hello', token, device: 'simulator', name: 'Laptop simulator', resume: sim.running });
    };
    sock.onmessage = (ev) => {
      if (ws !== sock || typeof ev.data !== 'string') return;
      const m = JSON.parse(ev.data);
      switch (m.t) {
        case 'welcome':
          sim.connected = true;
          sim.error = '';
          retry = 0;
          break;
        case 'refused':
          sim.error = `The server refused the simulator: ${m.reason}`;
          break;
        case 'mic':
          sim.micWanted = m.on;
          break;
        case 'speak':
          speak(m);
          break;
        case 'stop-audio':
          stopAudio();
          break;
        case 'photo':
          void photo(m);
          break;
        case 'light':
          clearTimeout(lightTimer);
          sim.light = m.color;
          if (m.color) lightTimer = setTimeout(() => ((sim.light = null), changed()), m.ms);
          break;
        case 'state':
          lastState = m.state;
          sim.running = m.state.active;
          setCue(m.state.active && m.state.phase === 'thinking' && !sim.playing);
          if (!m.state.active) stopAudio();
          break;
      }
      changed();
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return; // an older socket closing late
      sim.connected = false;
      sim.micWanted = false;
      stopAudio();
      setCue(false);
      changed();
      if (closedByUs) return;
      if (ev.code === 4000) {
        sim.error = 'The real glasses took over. Press "Use this laptop" to switch back.';
        sim.running = false;
        sim.takenOver = true;
        closedByUs = true;
        stopMedia();
        return changed();
      }
      if (ev.code === 4401) return;
      // The server restarted (you saved a file) or the network blinked: try again.
      retryTimer = setTimeout(connect, [300, 600, 1000, 2000, 3000][Math.min(retry++, 4)]);
    };
  }

  setInterval(() => send({ t: 'ping' }), 20000);

  return {
    async start(videoEl) {
      sim.error = '';
      sim.takenOver = false;
      closedByUs = false;
      try {
        await startMedia(videoEl);
      } catch (e) {
        sim.error = `The simulator needs the microphone. ${e.message || e}`;
        changed();
        return;
      }
      connect();
      changed();
    },
    stop() {
      closedByUs = true;
      clearTimeout(retryTimer);
      retryTimer = null;
      sim.running = false;
      const old = ws;
      ws = null;
      old?.close();
      stopMedia();
      stopAudio();
      setCue(false);
      changed();
    },
    setTalkMode(mode) {
      sim.talkMode = mode;
      changed();
    },
    talk(down) {
      if (sim.talking === down) return;
      sim.talking = down;
      if (!down) send({ t: 'talk-end' });
      changed();
    },
    button(press) {
      send({ t: 'button', press });
    },
    onLevel(fn) {
      levelListeners.add(fn);
    },
    onFlash(fn) {
      flashListener = fn;
    },
    get state() {
      return { ...sim, server: lastState };
    },
  };
}
