# DARKSIDE

An ode to Adam Driver and his ripped body.

Upload a photo of your face, state your given name, and DARKSIDE composites your face onto a shirtless Kylo Ren film still — body, hair, pose, and lighting untouched — then knights you with a Kylo-like Sith name. The whole thing plays out over the Burberry Hero campaign film.

## Run it

```bash
node server.js
# → http://127.0.0.1:4329
```

No dependencies. Requires Node 18+ and a `.env` file:

```
GEMINI_API_KEY=your-key-here
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Image generation requires a billing-enabled Google Cloud project — the free tier has zero image-model quota.

## Deploy to Render

The repo ships a `render.yaml` blueprint. In the Render dashboard: New → Blueprint → pick this repo, or New → Web Service (runtime Node, start command `node server.js`, plan Free). Set env vars:

- `GEMINI_API_KEY` — required.
- `PASSCODE` — optional; when set, the app asks for it before forging and rejects swaps without it. Recommended on a public URL so strangers can't spend your Gemini credits.

Locally nothing changes: no `PORT` env → binds `127.0.0.1:4329`. On Render, `PORT` is injected → binds `0.0.0.0`. Note `results/` is ephemeral on Render (wiped each deploy); portraits still download to the browser.

## How it works

- `server.js` — zero-dep Node server. Serves the app, streams the background video (HTTP Range support), and proxies the swap: your face photo + `assets/kylo.png` go to Gemini's image model (`gemini-3-pro-image-preview`, falling back to `gemini-3.1-flash-image` / `gemini-2.5-flash-image`) with a prompt that locks everything except the face. Results are saved to `results/`.
- `public/app.js` — upload, ritual flow, and the Sith name generator: local, deterministic, no API. Leslie → Lylo Ren. Ben → Korben Ren.
- The API key never reaches the browser. The app binds to `127.0.0.1` only. Your photo leaves the machine exactly once — to Google's Gemini API, for the swap.

## Assets

- `assets/kylo.png` — the vessel.
- `assets/burberry.mp4` — Burberry Hero campaign film (Adam Driver), background ambience. Personal use; do not redistribute.
