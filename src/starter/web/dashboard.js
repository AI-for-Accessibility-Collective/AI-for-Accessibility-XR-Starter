// The dashboard: what the app is doing, the conversation, the device, and
// the toolkit profile. It talks to this laptop's server (/api/...).

import { createSimulator } from './simulator.js';
import { createTour } from './tour.js';

const $ = (id) => document.getElementById(id);
const post = (path, body) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const time = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let state = null;
let token = '';

// ── header: phase and Start/Stop ────────────────────────────────────────────
const PHASE_TEXT = { off: 'Off', idle: 'Ready', listening: 'Listening', thinking: 'Working', speaking: 'Speaking' };

function renderState(s) {
  state = s;
  document.title = `${s.app} · XR Starter`;
  $('app-name').textContent = s.app;
  if (s.file) document.querySelector('.file code').textContent = s.file;
  $('phase').dataset.phase = s.phase;
  // While running, the status line names the phase and adds detail ("Taking a photo").
  $('phase-text').textContent = s.active ? s.status || PHASE_TEXT[s.phase] : 'Off';
  const btn = $('startstop');
  btn.disabled = !s.device && !s.active;
  btn.textContent = s.active ? '■ Stop' : '▶ Start';
  btn.className = s.active ? 'stop' : 'primary';
  btn.title = s.device ? '' : 'Connect the glasses or the simulator first';

  const problem = $('problem');
  problem.hidden = !s.problem;
  problem.firstElementChild.textContent = s.problem ?? '';

  const c = $('connected');
  const g = s.device?.glasses;
  if (!s.device) [c.textContent, c.className] = ['Not connected', 'badge'];
  else if (s.device.kind !== 'glasses') [c.textContent, c.className] = ['✓ Laptop connected', 'badge ok'];
  else if (g?.connected) [c.textContent, c.className] = [`✓ Glasses connected${g.battery != null ? ` · ${g.battery}%` : ''}`, 'badge ok'];
  else [c.textContent, c.className] = ['! Phone connected, glasses not connected', 'badge warn'];

  $('adapt').setAttribute('aria-checked', String(s.adapt));
  $('adapt').textContent = s.adapt ? 'On' : 'Off';

  const gm = s.gemini;
  $('gemini-status').textContent = !gm.key
    ? 'Gemini key missing: add GEMINI_API_KEY to .env'
    : gm.off
      ? `Gemini is switched off: ${gm.off}`
      : `Gemini: ${gm.calls} calls since start`;
  tour.refresh();
}

$('startstop').onclick = () => post('/api/control', { action: state?.active ? 'stop' : 'start' });

// ── conversation ────────────────────────────────────────────────────────────
const log = $('log');
function add(cls, who, text, extra) {
  const li = document.createElement('li');
  li.className = cls;
  if (who) {
    const w = document.createElement('span');
    w.className = 'who';
    w.textContent = who;
    li.append(w);
  }
  const t = document.createElement('span');
  t.className = 'text';
  t.textContent = text;
  li.append(t);
  if (extra) li.append(extra);
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.append(li);
  while (log.children.length > 400) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function onEvent(e) {
  switch (e.type) {
    case 'state':
      return renderState(e.state);
    case 'you':
      return add(`you${e.ignored ? ' ignored' : ''}`, `You · ${time(e.at)}`, e.text + (e.ignored ? `  (not handled: ${e.ignored})` : ''));
    case 'app':
      return add('app', `App · ${time(e.at)}`, e.text);
    case 'photo': {
      const img = document.createElement('img');
      img.src = `/api/photo/${e.id}.jpg`;
      img.alt = `Photo from the ${e.from === 'glasses' ? 'glasses camera' : 'webcam'}`;
      return add('photo', `Photo · ${time(e.at)}`, '', img);
    }
    case 'button':
      return add('button', '', `Button: ${e.press} press · ${time(e.at)}`);
    case 'log':
      return add(e.level, e.level === 'info' ? '' : e.level === 'warn' ? 'Warning' : 'Error', e.text);
    case 'profile':
      return void loadProfile();
  }
}

function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => onEvent(JSON.parse(m.data));
  es.onerror = () => {
    // The server restarted (a file was saved). The browser reconnects on its own;
    // the history arrives again, so start the list fresh.
    es.close();
    setTimeout(() => {
      log.replaceChildren();
      listen();
    }, 800);
  };
}

const say = (text) => post('/api/control', { action: 'type', text });
$('say-form').onsubmit = (ev) => {
  ev.preventDefault();
  const text = $('say').value.trim();
  if (!text) return;
  say(text);
  $('say').value = '';
};
$('clear').onclick = () => log.replaceChildren();
$('announce').onchange = (e) => log.setAttribute('aria-live', e.target.checked ? 'polite' : 'off');

// ── connect: the QR code for the phone ─────────────────────────────────────
async function loadConnect() {
  const c = await fetch('/api/connect').then((r) => r.json());
  token = c.token;
  $('token').textContent = c.token;
  $('addr').textContent = c.url ?? 'No network address found. Join a Wi-Fi network, or run bun run tunnel.';
  if (c.qr) $('qr').innerHTML = c.qr;
  $('addr-how').textContent =
    c.how === 'tunnel' ? 'Using the tunnel: works from other networks too.'
    : c.how === 'PUBLIC_URL' ? 'Using PUBLIC_URL from .env.'
    : c.how === 'wifi' ? 'The phone needs to be on the same Wi-Fi as this laptop.'
    : '';
}

// ── tabs ────────────────────────────────────────────────────────────────────
function selectTab(which) {
  const sim = which === 'sim';
  $('tab-glasses').setAttribute('aria-selected', String(!sim));
  $('tab-sim').setAttribute('aria-selected', String(sim));
  $('pane-glasses').hidden = sim;
  $('pane-sim').hidden = !sim;
  try {
    localStorage.setItem('xr-tab', which);
  } catch {}
  tour.refresh();
}
$('tab-glasses').onclick = () => selectTab('glasses');
$('tab-sim').onclick = () => selectTab('sim');
for (const tab of [$('tab-glasses'), $('tab-sim')]) {
  tab.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = tab.id === 'tab-glasses' ? 'sim' : 'glasses';
      selectTab(next);
      $(next === 'sim' ? 'tab-sim' : 'tab-glasses').focus();
    }
  };
}

// ── the simulator ───────────────────────────────────────────────────────────
let sim = null;
let simOn = false;
const LED = { red: '#e5484d', green: '#30a46c', blue: '#3e63dd', orange: '#f76b15', white: '#ffffff' };

function renderSim(s) {
  if (s.takenOver) simOn = false; // the real glasses replaced the simulator
  $('sim-body').hidden = !simOn;
  $('sim-toggle').hidden = simOn;
  $('sim-error').textContent = s.error || '';
  $('sim-mic-state').textContent = !s.connected ? 'connecting…' : s.playing ? 'paused' : s.micWanted ? 'on' : 'off';
  $('sim-led').style.background = s.light ? LED[s.light] : 'transparent';
  $('sim-led').setAttribute('aria-label', `Glasses light: ${s.light ?? 'off'}`);
  $('sim-talk').hidden = s.talkMode !== 'hold';
  $('sim-talk').textContent = s.talking ? '🎙 Listening… let go to send' : '🎙 Hold to talk';
  tour.refresh();
}

async function setSim(on) {
  if (!sim) {
    if (!token) await loadConnect();
    sim = createSimulator({ token, onChange: renderSim });
    sim.onLevel((level, open) => {
      $('sim-meter').style.width = `${Math.min(100, (level / 3000) * 100)}%`;
      $('sim-meter').style.opacity = open ? '1' : '.35';
    });
    sim.onFlash(() => {
      const v = $('sim-video');
      v.classList.remove('flash');
      void v.offsetWidth;
      v.classList.add('flash');
    });
  }
  if (on === simOn) return;
  simOn = on;
  if (simOn) {
    $('sim-toggle').disabled = true;
    $('sim-error').textContent = 'Asking for the microphone and camera. Choose Allow in the browser’s prompt.';
    await sim.start($('sim-video'));
    $('sim-toggle').disabled = false;
    if (!sim.state.connected && sim.state.error) simOn = false;
  } else sim.stop();
  renderSim(sim.state);
}
$('sim-toggle').onclick = () => setSim(true);
$('sim-off').onclick = () => setSim(false);
for (const r of document.querySelectorAll('input[name=talk]')) r.onchange = (e) => sim?.setTalkMode(e.target.value);

// Push-to-talk: pointer or the Space/Enter key on the Talk button.
const talk = $('sim-talk');
talk.onpointerdown = (e) => (talk.setPointerCapture(e.pointerId), sim?.talk(true));
talk.onpointerup = talk.onpointercancel = () => sim?.talk(false);
talk.onkeydown = (e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && (e.preventDefault(), sim?.talk(true));
talk.onkeyup = (e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), sim?.talk(false));

// The glasses button: a click is a short press, holding it a second is a long press.
const gb = $('sim-button');
let downAt = 0;
let longTimer = null;
gb.onpointerdown = () => {
  downAt = Date.now();
  longTimer = setTimeout(() => {
    longTimer = null;
    sim?.button('long');
  }, 900);
};
gb.onpointerup = gb.onpointercancel = () => {
  if (longTimer) {
    clearTimeout(longTimer);
    longTimer = null;
    if (Date.now() - downAt < 900) sim?.button('short');
  }
};
gb.onkeydown = (e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && (e.preventDefault(), sim?.button('short'));
$('sim-long').onclick = () => sim?.button('long');

// ── the profile (toolkit) ──────────────────────────────────────────────────
// The dashboard shows a few needs as examples (showOnDashboard in
// src/toolkit/needs.ts). Others that an app or an example saved are listed
// below them in one line.
$('adapt').onclick = () => post('/api/control', { action: 'adapt', on: !(state?.adapt ?? true) });

async function loadProfile() {
  renderProfile(await fetch('/api/profile').then((r) => r.json()));
}

const shownValue = (n) =>
  n.kind === 'toggle' ? (n.value ? 'on' : 'off') : n.kind === 'choice' ? (n.options.find((o) => o.value === n.value)?.label ?? n.value) : `${n.value}${n.unit ?? ''}`;

function needRow(n) {
  const row = document.createElement('div');
  row.className = 'need';
  row.id = `row-${n.key}`;
  const id = `need-${n.key}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = n.label;
  let control;
  if (n.kind === 'toggle') {
    control = document.createElement('input');
    control.type = 'checkbox';
    control.checked = !!n.value;
    control.onchange = () => saveNeed(n.key, control.checked);
  } else if (n.kind === 'choice') {
    control = document.createElement('select');
    control.append(...n.options.map((o) => new Option(o.label, o.value)));
    control.value = String(n.value);
    control.onchange = () => saveNeed(n.key, control.value);
  } else {
    control = document.createElement('span');
    const range = document.createElement('input');
    range.type = 'range';
    Object.assign(range, { min: n.min, max: n.max, step: n.step, value: n.value, id });
    const out = document.createElement('output');
    out.htmlFor = id;
    out.textContent = `${Number(n.value).toFixed(1)}${n.unit ?? ''}`;
    range.oninput = () => (out.textContent = `${Number(range.value).toFixed(1)}${n.unit ?? ''}`);
    range.onchange = () => saveNeed(n.key, Number(range.value));
    control.append(range, ' ', out);
  }
  if (control.tagName !== 'SPAN') control.id = id;
  row.append(label, control);
  return row;
}

function renderProfile(p) {
  $('needs').replaceChildren(...p.needs.filter((n) => n.showOnDashboard !== false).map(needRow));

  const ex = $('examples');
  if (!ex.children.length) {
    ex.replaceChildren(
      ...p.examples.map((e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.label;
        b.onclick = () => post('/api/profile/example', { key: e.key }).then(renderProfile);
        return b;
      }),
    );
  }

  const more = [
    ...p.needs.filter((n) => n.showOnDashboard === false && n.set).map((n) => `${n.label}: ${shownValue(n)}`),
    ...p.other.map((n) => `${n.dimension}: ${JSON.stringify(n.value)}`),
  ];
  $('other-needs').textContent = `Also in the profile: ${more.join(', ')}`;
  $('other-needs').hidden = !more.length;
  tour.refresh();
}

function saveNeed(key, value) {
  return post('/api/profile/need', { key, value }).then((r) => (r.needs ? renderProfile(r) : alert(r.error)));
}

// ── the tour ────────────────────────────────────────────────────────────────
const connected = () => !!state?.device;
const running = () => !!state?.active;
const tour = createTour(
  [
    {
      title: 'Welcome',
      text: 'This page runs your glasses app on your laptop. The tour goes through it one part at a time, in about a minute.',
    },
    {
      target: '#app-info',
      title: 'Your app',
      text: 'Your app is the file src/app.ts. Save a change to it, and the app restarts on this page.',
    },
    {
      target: '#card-glasses',
      title: 'The glasses',
      text: 'The laptop simulator uses this laptop’s mic, camera and speakers as the glasses. The Real glasses tab connects the phone and the glasses.',
      do: {
        label: 'Use this laptop',
        run: () => (selectTab('sim'), setSim(true)),
        done: () => simOn && !!sim?.state.connected,
      },
    },
    {
      target: '#startstop',
      title: 'Start and Stop',
      text: 'Start runs your app. This app greets the wearer first.',
      do: { label: 'Press Start', run: () => post('/api/control', { action: 'start' }), ready: connected, done: running, notReady: 'Connect the laptop first, in the step before.' },
    },
    {
      target: '#card-convo',
      title: 'The conversation',
      text: 'What the wearer says, what the app says, and the photos it takes appear here. The newest is at the bottom.',
    },
    {
      target: '#say-form',
      side: 'left',
      title: 'Talk or type',
      text: 'Talk to the app, or type here. Typing works the same as speaking.',
      do: { label: 'Ask “What is in front of me?”', run: () => say('What is in front of me?'), ready: running, notReady: 'Press Start first.' },
    },
    {
      target: () => (simOn ? '#sim-button' : '#card-glasses'),
      title: 'The glasses button',
      text: 'The glasses have one button. Your app decides what it does. This app describes the scene ahead.',
      do: { label: 'Press the button', run: () => post('/api/control', { action: 'button', press: 'short' }), ready: running, notReady: 'Press Start first.' },
    },
    {
      target: '#card-profile',
      title: 'The profile',
      text: 'The AI for Accessibility Toolkit keeps what the wearer needs. The app’s voice and answers follow it. The examples load one person’s needs.',
    },
    {
      target: '#row-readAloudRate',
      title: 'Change a need',
      text: 'Make the voice slower, then ask the app something. The answer comes slower.',
      do: { label: 'Set the speed to 0.8×', run: () => saveNeed('readAloudRate', 0.8) },
    },
    {
      target: '#adapt-row',
      title: 'Compare',
      text: 'Switch this off to hear the app with default settings. Switch it on again to hear the difference.',
    },
    {
      target: '#tour-btn',
      title: 'That is the page',
      text: 'Open this tour again here. Next, change the greeting in src/app.ts, save, and press Start.',
    },
  ],
  {
    onEnd: () => {
      try {
        localStorage.setItem('xr-tour-seen', '1');
      } catch {}
    },
  },
);
$('tour-btn').onclick = () => tour.start();

// ── go ──────────────────────────────────────────────────────────────────────
try {
  if (localStorage.getItem('xr-tab') === 'glasses') selectTab('glasses');
} catch {}
listen();
void loadConnect();
void loadProfile();
setInterval(() => void loadConnect().catch(() => {}), 10_000);
let seen = false;
try {
  seen = localStorage.getItem('xr-tour-seen') === '1';
} catch {}
if (!seen) setTimeout(() => tour.start(), 600);
