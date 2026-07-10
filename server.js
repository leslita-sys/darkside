// DARKSIDE — Kylo Ren face-swap. Port 4329, localhost only.
// Zero dependencies. GEMINI_API_KEY read from .env (never sent to the browser).
const http = require('http');
const fs = require('fs');
const path = require('path');

// Local default: 4329 on loopback. On Render, PORT is injected and we must
// bind all interfaces.
const PORT = process.env.PORT || 4329;
const HOST = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');
const RESULTS = path.join(ROOT, 'results');
fs.mkdirSync(RESULTS, { recursive: true });

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// Image models in preference order; first one the key can use wins.
const MODELS = ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

const SWAP_PROMPT = `Edit the first image (a dark, moody film still of a shirtless man standing in a dim industrial spaceship corridor). Replace ONLY his face with the face of the person in the second image, so it looks like that person was genuinely photographed in this scene.

Strict rules:
- Do not change the body, physique, skin tone of the torso, pose, arms, or hands in any way.
- Keep the original black wavy hair, exactly as it is.
- Keep the background, framing, and composition pixel-identical.
- Blend the new face seamlessly: match the dim, cold, blue-grey cinematic lighting, the soft top-light, the shadows, the film grain, and the muted color grade of the original still.
- The result must look like a real photograph from the same film, not a collage. Photorealistic, no visible seams, natural skin texture.`;

function b64FromDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

async function callGemini(model, face, signal) {
  const kylo = fs.readFileSync(path.join(ASSETS, 'kylo.png')).toString('base64');
  const body = {
    contents: [{
      parts: [
        { text: SWAP_PROMPT },
        { inline_data: { mime_type: 'image/png', data: kylo } },
        { inline_data: { mime_type: face.mime, data: face.data } },
      ],
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      // imageSize is only known-supported on the pro model; don't risk a 400 on fallbacks
      imageConfig: model.startsWith('gemini-3-pro')
        ? { aspectRatio: '5:4', imageSize: '2K' }
        : { aspectRatio: '5:4' },
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal,
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const parts = json.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => p.inlineData || p.inline_data);
  if (!img) {
    const err = new Error('Model returned no image (it may have refused this photo).');
    err.noImage = true;
    throw err;
  }
  const d = img.inlineData || img.inline_data;
  return { mime: d.mimeType || d.mime_type || 'image/jpeg', data: d.data };
}

async function handleSwap(req, res) {
  let raw = '';
  let tooBig = false;
  req.on('data', c => {
    raw += c;
    if (raw.length > 30e6 && !tooBig) {
      tooBig = true;
      sendJson(res, 413, { error: 'That photo is too large — keep it under about 20 MB.' });
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (tooBig) return;
    try {
      if (!process.env.GEMINI_API_KEY) {
        return sendJson(res, 503, { error: 'No GEMINI_API_KEY configured. Add it to darkside/.env and restart.' });
      }
      const { image, passcode } = JSON.parse(raw);
      if (process.env.PASSCODE && passcode !== process.env.PASSCODE) {
        return sendJson(res, 401, { error: 'Wrong passcode. The Dark Side guards its forge.' });
      }
      const face = b64FromDataUrl(image);
      if (!face) return sendJson(res, 400, { error: 'Bad image payload.' });

      let out, used, lastErr;
      for (const model of MODELS) {
        try {
          out = await callGemini(model, face, AbortSignal.timeout(180000));
          used = model;
          break;
        } catch (e) {
          lastErr = e;
          // Fall through to the next model on availability problems, bad-config
          // 400s, and safety refusals (no image returned); other errors surface.
          if (!e.noImage && ![400, 403, 404, 429].includes(e.status)) throw e;
        }
      }
      if (!out) throw lastErr || new Error('All models failed.');

      const ext = out.mime.includes('png') ? 'png' : 'jpg';
      const file = `sith-${Date.now()}.${ext}`;
      let saved = null;
      try {
        fs.writeFileSync(path.join(RESULTS, file), Buffer.from(out.data, 'base64'));
        saved = `results/${file}`;
      } catch (e) {
        console.error('result save failed:', e.message); // never discard a paid image over a disk error
      }
      sendJson(res, 200, { image: `data:${out.mime};base64,${out.data}`, model: used, ext, saved });
    } catch (e) {
      const friendly = /quota|billing/i.test(e.message || '')
        ? 'Your Gemini key has no image-generation quota yet — the free tier allows none. Enable billing on the Google AI project behind the key, then try again.'
        : e.message;
      sendJson(res, 502, { error: friendly });
    }
  });
}

function sendJson(res, code, obj) {
  const buf = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(buf);
}

function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? parseInt(range[1], 10) : Math.max(0, st.size - parseInt(range[2], 10));
      const end = range[1] && range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
      });
      return fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/swap') return handleSwap(req, res);
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      keyConfigured: !!process.env.GEMINI_API_KEY,
      passcodeRequired: !!process.env.PASSCODE,
    });
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const base = p.startsWith('/assets/') ? ROOT : PUBLIC;
  serveFile(req, res, path.join(base, p));
});

server.listen(PORT, HOST, () => {
  console.log(`DARKSIDE listening on http://${HOST}:${PORT} (key: ${process.env.GEMINI_API_KEY ? 'configured' : 'MISSING'})`);
});
