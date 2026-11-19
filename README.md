# Firefly Cove

**A night garden that breathes with you — and glows with your heartbeat.**

Firefly Cove is a camera-based human-sensing experience built on the
[Presage SmartSpectra SDK](https://smartspectra.presagetech.com/). Sit in front of
your webcam and a quiet night cove comes alive with *your* physiology:

- **Fireflies glow with your pulse.** Their brightness follows the SDK's live
  arterial-pressure waveform, and every detected heartbeat sends a ripple
  across the water.
- **The mist breathes with you.** The swell of the cove's water and fog is
  driven by your live chest-breathing waveform.
- **Moonrise.** Breathe slowly — a stable breathing rate at or under
  10 breaths/min — and hold it: the moon climbs, the stars come out, and the
  fireflies turn gold. A small game about calming your own body, played with
  no controller at all.
- **Your signals, visible.** A live HUD shows pulse (bpm), breathing rate
  (br/min), HRV when available, per-measurement confidence, and a waveform
  strip plotting the actual breathing and pulse traces from the SDK.

Firefly Cove is a relaxation toy, **not a medical device**. It makes no
diagnosis or treatment claims and must never be used for medical decisions.
SmartSpectra metrics are offered for general wellness and informational
purposes only and have not been cleared by the FDA.

> Submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04) on DEV.

---

## How it works

```
┌────────────┐   frames    ┌──────────────────────┐  metrics (protobuf)
│  Webcam or │ ──────────► │ SmartSpectra SDK     │ ────────────────┐
│ video file │             │ (native, on-device)  │                 │
└────────────┘             └──────────────────────┘                 ▼
                                              ┌──────────────────────────────┐
                                              │ Node server (this repo)      │
                                              │ decodes packets → plain JSON │
                                              └──────────────┬───────────────┘
                                                 SSE /events │
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │ Browser experience (canvas)  │
                                              │ fireflies · mist · moonrise  │
                                              └──────────────────────────────┘
```

- The SDK runs **in the Node server process** using the official
  `@smartspectra/node-sdk` (v3.5.0), in its headless camera mode — the browser
  never touches the camera directly.
- `server/spectra.js` requests the SDK's **breathing + cardio metric bundles**
  (`breathingMetrics`, `cardioMetrics`), decodes each protobuf `Metrics`
  packet with the SDK's own message classes, and normalizes the latest pulse
  rate, breathing rate, HRV, and both waveforms into small JSON events.
- `server/index.js` serves the static experience and streams those events over
  Server-Sent Events. No framework, no build step, no database.
- `public/app.js` renders the scene on canvas and shapes the raw signals:
  rolling min/max normalization for the waveforms, mean-crossing heartbeat
  detection on the pulse trace (with a bpm-timer fallback), and the Moonrise
  calm-progress rule.

## Signals used

| SmartSpectra signal | Field | Drives |
| --- | --- | --- |
| Pulse rate | `cardio.pulseRate` | HUD readout + confidence bar |
| Arterial pressure trace | `cardio.arterialPressureTrace` | Firefly glow, heartbeat ripples, waveform strip |
| Breathing rate | `breathing.rate` | HUD readout, Moonrise calm progress |
| Chest breathing trace | `breathing.upperTrace` | Mist/water swell, waveform strip |
| HRV | `cardio.hrv` | HUD readout (when the SDK reports it) |
| Validation status | `validationStatus` event | Live guidance pill ("no face found", "too dark", …) |

## Setup

### Prerequisites

- Node.js 18 or newer
- A webcam — **or** a short pre-recorded video of a face (see *Video-file mode*)
- A free Presage Physiology API key (below)
- On Linux, the native SDK uses Vulkan inference; a working Vulkan driver
  (including software rendering such as Mesa's lavapipe) is enough.

### 1. Install

```bash
git clone <this-repo-url>
cd firefly-cove
npm install
```

### 2. Get your free API key

1. Register at <https://physiology.presagetech.com/auth/register> (email +
   password, then confirm via the email link).
2. Log in to the developer portal and copy your API key.
3. Create your local config:

```bash
cp .env.example .env
# edit .env and set SMARTSPECTRA_API_KEY=<your key>
```

The key is only ever read from the environment / `.env` (which is gitignored).
It is never committed or sent anywhere except Presage's own authentication
endpoints by the SDK.

### 3. Run

```bash
npm start
# Firefly Cove is running at http://127.0.0.1:4399
```

Open the URL, read the consent card, tick the checkbox, and press **Begin**.
Sit centered, well-lit, and reasonably still; measurements take a few seconds
to stabilize. The status pill mirrors the SDK's live validation hints.

### Video-file mode (great for demos and judging)

No camera? The SDK can measure from a recording instead:

```bash
# in .env
SOURCE=file
VIDEO_PATH=/path/to/face-video.mp4
```

…or pick "Recorded video file" in the UI's source selector (the path still
comes from the server config). The file replays at roughly real time. A
20–60 second, well-lit, front-facing clip works best. This is also exactly how
the demo video for the DEV post was recorded — see
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Consent & privacy design

Consent is a feature of this app, not a footer:

- **Explicit gate.** The camera cannot start until a visitor reads the consent
  card and ticks the checkbox. The Begin button stays disabled otherwise.
- **On-device processing.** The SDK analyzes video on this machine (Vulkan
  inference). This app never records, saves, or uploads video.
- **Memory only.** Measurements exist only in the page's memory and vanish on
  Stop or tab close. There is no database, no log of vitals, no sharing.
- **Telemetry off.** The SDK's optional aggregate session telemetry is
  disabled in code (`enableTelemetry: false` in `server/spectra.js`). The only
  network calls the SDK makes are its own API-key authentication / metrics
  authorization requests to Presage.
- **No AI services.** The SDK's optional LLM Insights feature is never called.
- **One-click forget.** "Stop & forget everything" ends the SDK session,
  destroys the native instance, and clears every value from the UI.

## Project structure

```
firefly-cove/
├── server/
│   ├── index.js      # HTTP server: static files, SSE stream, session API
│   └── spectra.js    # SmartSpectra session wrapper + metrics normalization
├── public/
│   ├── index.html    # consent gate, HUD, canvases
│   ├── styles.css
│   └── app.js        # scene rendering + signal shaping (no build step)
├── docs/
│   └── DEMO_SCRIPT.md
├── .env.example
└── package.json      # depends only on @smartspectra/node-sdk
```

## Troubleshooting

- **`SmartSpectra authentication failed`** — the API key is missing, mistyped,
  or not yet activated. Re-check `.env` (no quotes/spaces) and restart.
- **"Cameras detected: none"** — no webcam is visible to the SDK. Check the
  OS camera permission, close other apps using the camera, or use video-file
  mode.
- **No metrics, hint says no face / too dark** — center your face, add light,
  stay still for a few seconds. The validation pill is the SDK talking to you.
- **Port already in use** — set `PORT` in `.env` to something free.

## Credits & license

- Built with the Presage SmartSpectra SDK (`@smartspectra/node-sdk`, © Presage
  Technologies, Inc., proprietary license — see the package's LICENSE/NOTICE).
- Firefly Cove's own code is released under the [MIT License](LICENSE).
- Created for the Presage SmartSpectra SDK Challenge on DEV (Nov 2026).
