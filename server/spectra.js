'use strict';

/**
 * Firefly Cove — SmartSpectra SDK wrapper.
 *
 * Owns the Presage SmartSpectra SDK lifecycle (one session at a time) and
 * translates the SDK's protobuf metrics into small plain-JSON events that the
 * web UI consumes over Server-Sent Events:
 *
 *   { type: 'metrics',    pulse, breathing, hrv, traces, at }
 *   { type: 'validation', code, hint }
 *   { type: 'status',     status, name }
 *   { type: 'error',      code, message, retryable }
 *   { type: 'session',    state: 'started' | 'stopped', source }
 *
 * Privacy choices made here, on purpose:
 *   - `enableTelemetry: false` — the SDK's aggregate session telemetry is
 *     opt-out; we opt out so the app sends Presage nothing beyond the API-key
 *     authentication / metrics-authorization calls the SDK itself requires.
 *   - We never call `requestInsight()` — the optional LLM Insights feature is
 *     not used, so no vitals leave the machine for AI analysis.
 *   - Metrics live only in memory and are streamed to the local browser tab.
 *     Nothing is written to disk, logged, or shared.
 */

const {
  SmartSpectraSDK,
  CameraSelection,
  breathingMetrics,
  cardioMetrics,
} = require('@smartspectra/node-sdk');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const PROCESSING_STATUS_NAMES = {
  0: 'uninitialized',
  1: 'idle',
  2: 'starting',
  3: 'running',
  4: 'stopping',
  5: 'error',
};

function lastOf(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : null;
}

function rateOf(measurement) {
  if (!measurement) return null;
  return {
    value: typeof measurement.value === 'number' ? measurement.value : null,
    confidence:
      typeof measurement.confidence === 'number' ? measurement.confidence : null,
    stable: measurement.stable === true,
  };
}

function traceValues(trace, maxPoints) {
  if (!Array.isArray(trace)) return [];
  const values = [];
  for (const point of trace) {
    if (point && typeof point.value === 'number') values.push(point.value);
  }
  return values.slice(-maxPoints);
}

/** Convert one decoded protobuf Metrics packet into a compact JSON event. */
function normalizeMetrics(metrics) {
  if (!metrics) return null;
  const cardio = metrics.cardio || null;
  const breathing = metrics.breathing || null;

  const pulse = cardio ? rateOf(lastOf(cardio.pulseRate)) : null;
  const breathRate = breathing ? rateOf(lastOf(breathing.rate)) : null;

  let hrv = null;
  const hrvEntry = cardio ? lastOf(cardio.hrv) : null;
  if (hrvEntry && typeof hrvEntry.value === 'number') {
    hrv = { value: hrvEntry.value };
  }

  return {
    type: 'metrics',
    at: Date.now(),
    pulse, // { value: bpm, confidence: 0-100, stable } | null
    breathing: breathRate, // { value: breaths/min, confidence, stable } | null
    hrv, // { value } | null
    traces: {
      // Waveforms straight from the SDK: chest breathing movement and the
      // relative arterial pressure (pulse) waveform.
      breathing: breathing ? traceValues(breathing.upperTrace, 120) : [],
      pulse: cardio ? traceValues(cardio.arterialPressureTrace, 120) : [],
    },
  };
}

class SpectraSession {
  /**
   * @param {(event: object) => void} emit  broadcast sink (SSE)
   */
  constructor(emit) {
    this.emit = emit;
    this.sdk = null;
    this.running = false;
    this.source = null;
  }

  static availableCameras() {
    return SmartSpectraSDK.availableCameras();
  }

  get isRunning() {
    return this.running;
  }

  /**
   * Start a measurement session.
   * @param {{apiKey: string, source: 'camera'|'file', videoPath?: string}} opts
   */
  start({ apiKey, source, videoPath }) {
    if (this.running) {
      throw Object.assign(new Error('A session is already running.'), {
        code: 'busy',
      });
    }
    if (!apiKey) {
      throw Object.assign(
        new Error(
          'SMARTSPECTRA_API_KEY is not set. Register for a free key at ' +
            'https://physiology.presagetech.com/auth/register and put it in .env'
        ),
        { code: 'missing_api_key' }
      );
    }

    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...breathingMetrics, ...cardioMetrics],
      enableTelemetry: false, // see privacy notes at the top of this file
      enableAccumulatedOutput: false,
    });
    this.sdk = sdk;

    sdk.on('metrics', (buf) => {
      try {
        const event = normalizeMetrics(decodeMetrics(buf));
        if (event) this.emit(event);
      } catch (err) {
        this.emit({
          type: 'error',
          code: 'decode_failed',
          message: `Failed to decode metrics packet: ${err.message}`,
          retryable: false,
        });
      }
    });

    let lastValidation = '';
    sdk.on('validationStatus', (code, _ts, hint) => {
      const key = `${code}:${hint}`;
      if (key === lastValidation) return; // de-duplicate repeats
      lastValidation = key;
      this.emit({ type: 'validation', code, hint });
    });

    sdk.on('processingStatus', (status) => {
      this.emit({
        type: 'status',
        status,
        name: PROCESSING_STATUS_NAMES[status] || String(status),
      });
      if ((status === 1 || status === 5) && this.running) {
        // Returned to idle (a file source reached end-of-file, or the
        // pipeline stopped on its own) or hit a terminal error: either way
        // the session is over and a fresh start must be possible.
        this.running = false;
        this.emit({ type: 'session', state: 'stopped', source: this.source });
      }
    });

    sdk.on('error', (code, message, retryable) => {
      this.emit({ type: 'error', code, message, retryable });
    });

    if (source === 'file') {
      if (!videoPath) {
        throw Object.assign(
          new Error('source=file requires VIDEO_PATH (path to a face video).'),
          { code: 'missing_video_path' }
        );
      }
      // ~33 ms between frames replays the recording at roughly real time so
      // the experience (and a demo recording of it) unfolds naturally.
      sdk.useFile(videoPath, { interframeDelayMs: 33 });
    } else {
      sdk.useCamera(CameraSelection.default, {
        width: 1280,
        height: 720,
        fps: 30,
      });
    }

    sdk.start(); // throws a typed SDK error on failure (auth, input, ...)
    this.running = true;
    this.source = source;
    this.emit({ type: 'session', state: 'started', source });
  }

  async stop() {
    if (!this.sdk) return;
    const sdk = this.sdk;
    this.sdk = null;
    this.running = false;
    try {
      await sdk.stopAsync();
    } catch {
      /* stopping is best-effort */
    }
    try {
      await sdk.destroy();
    } catch {
      /* teardown is best-effort */
    }
    this.emit({ type: 'session', state: 'stopped', source: this.source });
  }
}

module.exports = { SpectraSession, normalizeMetrics };
