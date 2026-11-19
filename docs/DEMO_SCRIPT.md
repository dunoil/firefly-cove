# Recording the demo video

Judges verify SmartSpectra SDK use from the **public repo + demo video**, so
the video must clearly show (a) the SDK integration, (b) live Presage signals
changing in real time, and (c) the experience responding to them. Target
length: 60–120 seconds. Record at 1080p if possible.

## Before you record

1. Complete the README setup (`.env` with a real API key).
2. Decide the input:
   - **Live camera** (preferred — most convincing), or
   - **Video-file mode**: record a 60–90 s well-lit, front-facing webcam clip
     of yourself breathing normally, then slowing down; set `SOURCE=file` and
     `VIDEO_PATH` in `.env`. The scene will respond to the recording exactly
     as it would live, and you can narrate over the screen capture.
3. Start the server (`npm start`) and open <http://127.0.0.1:4399>.
4. Start your screen recorder (OBS, Xbox Game Bar, QuickTime…).

## Shot list

| # | Shot | What it proves |
| --- | --- | --- |
| 1 | The consent card. Read 2–3 bullet points aloud; tick the checkbox; press Begin. | Consent-first design (Thoughtful Use category) |
| 2 | The status pill cycling through SDK validation hints as you move into frame ("no face found" → "Measuring…"). | Real SDK validation pipeline, live |
| 3 | HUD numbers settling: pulse bpm, breathing br/min, confidence bars filling. Waveform strip drawing both traces. | Live Presage signals, decoded in real time |
| 4 | Fireflies brightening/pulsing and heartbeat ripples firing while you sit still. Point at the pulse trace lining up with the ripples. | Arterial-pressure waveform driving the scene |
| 5 | Deliberately breathe fast for a few seconds — mist swells faster, Moonrise bar stalls/falls. | Breathing trace + rate visibly in control |
| 6 | Slow your breathing below 10 br/min and hold it: Moonrise bar climbs, moon rises, stars brighten, fireflies turn gold. | The Moonrise mechanic end-to-end |
| 7 | Click "Stop & forget everything": values clear, consent card returns. | One-click data forgetting |
| 8 | (Optional, 5 s) Flash the repo: `server/spectra.js` showing `requestedMetrics: [...breathingMetrics, ...cardioMetrics]` and `enableTelemetry: false`. | Code-level SDK integration + privacy choice |

## Narration beats (suggested)

- "Firefly Cove turns two live SmartSpectra signals — pulse and breathing —
  into a place."
- "No wearables, nothing uploaded: the SDK measures on-device, telemetry is
  off, and stopping forgets everything."
- "The only way to raise the moon is to actually slow your own breathing."

## After recording

- Upload to YouTube (public or unlisted) and paste the link into the
  `## Demo` section of `dev-post.md`.
- Grab 2–3 screenshots (consent card, measuring scene, moonrise) for the post
  placeholders.
- Do **not** trim out the validation-hint or numbers-settling moments — those
  "imperfect" seconds are what make the SDK use believable.
