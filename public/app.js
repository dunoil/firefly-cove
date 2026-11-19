'use strict';

/**
 * Firefly Cove — browser experience.
 *
 * Renders a night cove that responds to LIVE SmartSpectra signals streamed
 * from the local server over SSE:
 *   - fireflies glow in time with the arterial-pressure (pulse) waveform and
 *     ripple on every detected heartbeat;
 *   - the mist over the water swells with the chest-breathing waveform;
 *   - breathing slowly (<= 10 br/min, stable) raises the moon ("Moonrise").
 *
 * Nothing here invents data: when no metrics are arriving, the scene idles
 * dimly, the HUD shows dashes, and the status pill shows the SDK's own
 * validation hint (e.g. "no face found").
 */

// ---------------------------------------------------------------- state
const state = {
  running: false,
  pulse: null, // { value, confidence, stable }
  breathing: null, // { value, confidence, stable }
  hrv: null, // { value }
  breathTrace: [], // rolling SDK waveform values
  pulseTrace: [],
  breathSwell: 0.5, // smoothed 0..1
  pulseSwell: 0, // smoothed 0..1
  calmSeconds: 0,
  lastBeatAt: 0,
  nextFallbackBeatAt: 0,
  ripples: [], // { x, y, r, alpha }
  lastFrameAt: performance.now(),
};

const CALM_TARGET_SECONDS = 45;
const CALM_MAX_BREATHING_RATE = 10; // br/min

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const overlay = $('consentOverlay');
const consentCheck = $('consentCheck');
const beginBtn = $('beginBtn');
const stopBtn = $('stopBtn');
const sourceSelect = $('sourceSelect');
const statusPill = $('statusPill');
const errorBanner = $('errorBanner');
const setupNote = $('setupNote');

consentCheck.addEventListener('change', () => {
  beginBtn.disabled = !consentCheck.checked;
});

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}
function clearError() {
  errorBanner.hidden = true;
}

beginBtn.addEventListener('click', async () => {
  clearError();
  beginBtn.disabled = true;
  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: sourceSelect.value }),
    });
    const body = await res.json();
    if (!body.ok) {
      showError(body.message || 'Could not start the session.');
      beginBtn.disabled = !consentCheck.checked;
      return;
    }
    state.running = true;
    overlay.hidden = true;
    stopBtn.hidden = false;
    statusPill.textContent = 'Starting the camera…';
  } catch (err) {
    showError(`Could not reach the local server: ${err.message}`);
    beginBtn.disabled = !consentCheck.checked;
  }
});

stopBtn.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' }).catch(() => {});
  resetExperience();
});

function resetExperience() {
  state.running = false;
  state.pulse = null;
  state.breathing = null;
  state.hrv = null;
  state.breathTrace.length = 0;
  state.pulseTrace.length = 0;
  state.calmSeconds = 0;
  state.ripples.length = 0;
  stopBtn.hidden = true;
  overlay.hidden = false;
  consentCheck.checked = false;
  beginBtn.disabled = true;
  statusPill.textContent = 'Waiting to start';
  updateHud();
}

// ---------------------------------------------------------------- sse
const events = new EventSource('/events');
events.onmessage = (msg) => {
  let event;
  try {
    event = JSON.parse(msg.data);
  } catch {
    return;
  }
  switch (event.type) {
    case 'hello':
      if (!event.hasApiKey) setupNote.hidden = false;
      break;
    case 'metrics':
      onMetrics(event);
      break;
    case 'validation':
      if (state.running) statusPill.textContent = event.hint || 'Adjusting…';
      break;
    case 'status':
      if (state.running && event.name === 'running') {
        statusPill.textContent = 'Measuring — sit centered and well-lit';
      }
      break;
    case 'error':
      showError(
        event.code === 2
          ? 'SmartSpectra authentication failed — check the API key in .env and restart the server.'
          : `SmartSpectra error: ${event.message}`
      );
      break;
    case 'session':
      if (event.state === 'stopped' && state.running) {
        statusPill.textContent = 'Session ended';
        resetExperience();
      }
      break;
  }
};

function pushTrace(buffer, values, max = 600) {
  for (const v of values) buffer.push(v);
  if (buffer.length > max) buffer.splice(0, buffer.length - max);
}

function onMetrics(event) {
  if (event.pulse) state.pulse = event.pulse;
  if (event.breathing) state.breathing = event.breathing;
  if (event.hrv) state.hrv = event.hrv;
  if (event.traces) {
    if (event.traces.breathing?.length) {
      pushTrace(state.breathTrace, event.traces.breathing);
    }
    if (event.traces.pulse?.length) {
      const before = state.pulseTrace.length;
      pushTrace(state.pulseTrace, event.traces.pulse);
      detectBeats(before);
    }
  }
  updateHud();
}

// ------------------------------------------------------- signal shaping
function normalizedLatest(buffer) {
  if (buffer.length < 8) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of buffer) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-6) return 0.5;
  return (buffer[buffer.length - 1] - min) / (max - min);
}

/** Fire a ripple when the pulse waveform rises through its mean. */
function detectBeats() {
  const buf = state.pulseTrace;
  if (buf.length < 30) return;
  const window = buf.slice(-90);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const prev = buf[buf.length - 2];
  const last = buf[buf.length - 1];
  const now = performance.now();
  if (prev <= mean && last > mean && now - state.lastBeatAt > 320) {
    state.lastBeatAt = now;
    spawnRipple();
  }
}

function spawnRipple() {
  state.ripples.push({
    x: window.innerWidth * (0.25 + Math.random() * 0.5),
    y: window.innerHeight * (0.55 + Math.random() * 0.2),
    r: 6,
    alpha: 0.55,
  });
}

// ---------------------------------------------------------------- hud
function fmt(value, digits) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

function updateHud() {
  $('pulseValue').textContent = state.pulse ? fmt(state.pulse.value, 0) : '—';
  $('breathValue').textContent = state.breathing
    ? fmt(state.breathing.value, 1)
    : '—';
  $('hrvValue').textContent = state.hrv ? fmt(state.hrv.value, 0) : '—';
  $('pulseConf').style.width = state.pulse?.confidence
    ? `${Math.min(100, state.pulse.confidence)}%`
    : '0%';
  $('breathConf').style.width = state.breathing?.confidence
    ? `${Math.min(100, state.breathing.confidence)}%`
    : '0%';
}

let lastCalmPct = -1;
function updateCalm(dt) {
  const b = state.breathing;
  if (state.running && b && b.stable && typeof b.value === 'number' && b.value <= CALM_MAX_BREATHING_RATE) {
    state.calmSeconds = Math.min(CALM_TARGET_SECONDS, state.calmSeconds + dt);
  } else {
    state.calmSeconds = Math.max(0, state.calmSeconds - dt * 0.4);
  }
  const pct = Math.round((state.calmSeconds / CALM_TARGET_SECONDS) * 100);
  if (pct !== lastCalmPct) {
    lastCalmPct = pct;
    $('calmFill').style.width = `${pct}%`;
    $('calmPct').textContent = pct >= 100 ? '🌕 Moonrise!' : `${pct}%`;
  }
}

// ---------------------------------------------------------------- scene
const scene = $('scene');
const sctx = scene.getContext('2d');
const wave = $('waveform');
const wctx = wave.getContext('2d');

let W = 0;
let H = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  scene.width = W * dpr;
  scene.height = H * dpr;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wave.width = wave.clientWidth * dpr;
  wave.height = wave.clientHeight * dpr;
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const stars = Array.from({ length: 140 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.55,
  r: Math.random() * 1.4 + 0.3,
  tw: Math.random() * Math.PI * 2,
}));

const fireflies = Array.from({ length: 64 }, () => ({
  x: Math.random(),
  y: 0.35 + Math.random() * 0.5,
  vx: (Math.random() - 0.5) * 0.008,
  vy: (Math.random() - 0.5) * 0.005,
  phase: Math.random() * Math.PI * 2,
  size: 1 + Math.random() * 2.2,
}));

function drawScene(now) {
  const t = now / 1000;
  const calm = state.calmSeconds / CALM_TARGET_SECONDS;

  // sky
  const sky = sctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#04061a');
  sky.addColorStop(0.55, '#0a1030');
  sky.addColorStop(1, '#101a3d');
  sctx.fillStyle = sky;
  sctx.fillRect(0, 0, W, H);

  // stars (brighter as the moon rises)
  for (const s of stars) {
    const a = (0.25 + 0.75 * calm) * (0.6 + 0.4 * Math.sin(t * 1.7 + s.tw));
    sctx.globalAlpha = Math.max(0.06, a);
    sctx.fillStyle = '#dfe8ff';
    sctx.beginPath();
    sctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
    sctx.fill();
  }
  sctx.globalAlpha = 1;

  // moon — rises with calm progress
  const moonX = W * 0.78;
  const moonY = H * (0.62 - 0.42 * calm);
  const glow = sctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, 90);
  glow.addColorStop(0, 'rgba(255,240,200,0.55)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  sctx.fillStyle = glow;
  sctx.fillRect(moonX - 90, moonY - 90, 180, 180);
  sctx.fillStyle = '#fdf3cf';
  sctx.beginPath();
  sctx.arc(moonX, moonY, 26, 0, Math.PI * 2);
  sctx.fill();

  // hills
  sctx.fillStyle = '#070d22';
  sctx.beginPath();
  sctx.moveTo(0, H * 0.78);
  sctx.quadraticCurveTo(W * 0.3, H * 0.68, W * 0.55, H * 0.78);
  sctx.quadraticCurveTo(W * 0.8, H * 0.86, W, H * 0.76);
  sctx.lineTo(W, H);
  sctx.lineTo(0, H);
  sctx.closePath();
  sctx.fill();

  // breathing mist / water — swells with the chest-breathing waveform
  const swell = state.breathSwell; // 0..1 from the live trace
  for (let layer = 0; layer < 3; layer++) {
    const baseY = H * (0.8 + layer * 0.055);
    const amp = (5 + layer * 4) * (0.55 + swell * 0.9);
    sctx.beginPath();
    sctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 14) {
      const y =
        baseY +
        Math.sin(x * 0.008 + t * (0.35 + layer * 0.12) + layer * 2.1) * amp +
        Math.sin(x * 0.02 - t * 0.2) * amp * 0.3 -
        swell * 10;
      sctx.lineTo(x, y);
    }
    sctx.lineTo(W, H);
    sctx.closePath();
    sctx.fillStyle = `rgba(${40 + layer * 14}, ${70 + layer * 16}, ${
      130 + layer * 22
    }, ${0.16 + layer * 0.1})`;
    sctx.fill();
  }

  // heartbeat ripples
  state.ripples = state.ripples.filter((r) => r.alpha > 0.02);
  for (const r of state.ripples) {
    r.r += 1.6;
    r.alpha *= 0.965;
    sctx.strokeStyle = `rgba(255, 217, 122, ${r.alpha})`;
    sctx.lineWidth = 1.6;
    sctx.beginPath();
    sctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    sctx.stroke();
  }

  // fireflies — glow follows the pulse waveform
  const glowLevel = state.pulseSwell;
  for (const f of fireflies) {
    f.x += f.vx / 60 + Math.sin(t * 0.7 + f.phase) * 0.0004;
    f.y += f.vy / 60 + Math.cos(t * 0.5 + f.phase) * 0.0003;
    if (f.x < 0.02) f.x = 0.02;
    if (f.x > 0.98) f.x = 0.98;
    if (f.y < 0.3) f.y = 0.3;
    if (f.y > 0.9) f.y = 0.9;
    const flicker = 0.72 + 0.28 * Math.sin(t * 2.2 + f.phase);
    const alpha = (0.14 + 0.86 * glowLevel) * flicker;
    const gold = calm > 0.6;
    sctx.fillStyle = gold
      ? `rgba(255, 205, 92, ${alpha})`
      : `rgba(190, 255, 170, ${alpha})`;
    sctx.shadowColor = gold ? '#ffcd5c' : '#beffaa';
    sctx.shadowBlur = 12 * alpha;
    sctx.beginPath();
    sctx.arc(f.x * W, f.y * H, f.size, 0, Math.PI * 2);
    sctx.fill();
    sctx.shadowBlur = 0;
  }
}

function drawWaveform() {
  const w = wave.clientWidth;
  const h = wave.clientHeight;
  wctx.clearRect(0, 0, w, h);
  const draw = (buffer, color, midY, height) => {
    if (buffer.length < 4) return;
    const slice = buffer.slice(-240);
    let min = Infinity;
    let max = -Infinity;
    for (const v of slice) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 1e-6) return;
    wctx.strokeStyle = color;
    wctx.lineWidth = 1.6;
    wctx.beginPath();
    slice.forEach((v, i) => {
      const x = (i / (slice.length - 1)) * w;
      const y = midY - ((v - min) / (max - min) - 0.5) * height;
      if (i === 0) wctx.moveTo(x, y);
      else wctx.lineTo(x, y);
    });
    wctx.stroke();
  };
  draw(state.breathTrace, 'rgba(122,224,255,0.95)', h * 0.28, h * 0.4);
  draw(state.pulseTrace, 'rgba(255,217,122,0.95)', h * 0.74, h * 0.4);
  wctx.fillStyle = 'rgba(170,180,212,0.8)';
  wctx.font = '10px system-ui';
  wctx.fillText('breathing', 6, 12);
  wctx.fillText('pulse', 6, h - 6);
}

// fallback heartbeat if bpm exists but the trace is momentarily empty
function fallbackBeat(now) {
  const bpm = state.pulse?.value;
  if (!state.running || !bpm) return;
  if (state.pulseTrace.length > 30) return; // trace detection is in charge
  if (now >= state.nextFallbackBeatAt) {
    state.nextFallbackBeatAt = now + (60000 / bpm);
    spawnRipple();
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - state.lastFrameAt) / 1000);
  state.lastFrameAt = now;

  const b = normalizedLatest(state.breathTrace);
  if (b !== null) state.breathSwell += (b - state.breathSwell) * 0.07;
  const p = normalizedLatest(state.pulseTrace);
  if (p !== null) state.pulseSwell += (p - state.pulseSwell) * 0.18;
  else if (!state.running) state.pulseSwell *= 0.98;

  fallbackBeat(now);
  updateCalm(dt);
  drawScene(now);
  drawWaveform();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateHud();
