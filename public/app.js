// DARKSIDE — client logic

const $ = id => document.getElementById(id);
const ritual = $('ritual'), chamber = $('chamber'), reveal = $('reveal'), fault = $('fault');
const dropzone = $('dropzone'), fileinput = $('fileinput'), facepreview = $('facepreview'),
      dropprompt = $('dropprompt'), namein = $('namein'), gobtn = $('gobtn');

let faceDataUrl = null;

/* ---------- health check ---------- */
fetch('/api/health').then(r => r.json()).then(h => {
  if (!h.keyConfigured) $('keybanner').classList.remove('hidden');
}).catch(() => {});

/* ---------- upload ---------- */
function acceptFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    faceDataUrl = reader.result;
    facepreview.src = faceDataUrl;
    facepreview.classList.remove('hidden');
    dropprompt.classList.add('hidden');
    updateReady();
  };
  reader.readAsDataURL(file);
}

dropzone.addEventListener('click', () => fileinput.click());
dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileinput.click(); });
fileinput.addEventListener('change', () => acceptFile(fileinput.files[0]));

['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', e => acceptFile(e.dataTransfer.files[0]));

namein.addEventListener('input', updateReady);

function updateReady() {
  gobtn.disabled = !(faceDataUrl && namein.value.trim().length > 0);
  $('formhint').textContent = gobtn.disabled
    ? 'A face and a name. That is all the Dark Side asks. For now.'
    : 'Good. Gooood. Press the button.';
}

/* ---------- Sith name generator (local, deterministic) ---------- */
function fnv(s) {
  let h = 2166136261;
  for (const c of s.toLowerCase().trim()) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

const DARK_SYLLABLES = ['lo', 'rax', 'dus', 'gar', 'vek', 'zan', 'myr', 'dral', 'thys', 'kaan', 'dor', 'vane', 'xus', 'mor', 'rath', 'nyx'];
const DARK_PREFIXES = ['Ky', 'Vy', 'Za', 'Mal', 'Dre', 'Kor', 'Syl', 'Vex', 'Ash', 'Bel'];
const EPITHETS = [
  'Master of the Knights of Ren',
  'Heir apparent to Lord Vader',
  'Supreme Leader in waiting',
  'Scourge of the Resistance',
  'First of the Shredded Order',
  'Breaker of helmets, and of hearts',
  'Champion of shirtless brooding',
  'Warden of the crossguard saber',
];
const DOSSIERS = [
  'Allegiance: First Order · Weapon: Crossguard saber · Cardio: never, lifts only',
  'Allegiance: First Order · Known weakness: family reunions',
  'Allegiance: First Order · Hobbies: destroying consoles, core work',
  'Allegiance: First Order · Skincare: rage, mostly',
];

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function sithName(name) {
  const clean = name.replace(/[^a-zA-Z]/g, '').toLowerCase() || 'ben';
  const h = fnv(clean);
  let first;
  switch (h % 3) {
    case 0: // fuse their name's opening with a dark syllable: Leslie -> Lesdral
      first = cap(clean.slice(0, Math.min(3, clean.length))) + DARK_SYLLABLES[(h >>> 3) % DARK_SYLLABLES.length];
      break;
    case 1: // dark prefix + tail of their name: Leslie -> Vexlie
      first = DARK_PREFIXES[(h >>> 5) % DARK_PREFIXES.length] + clean.slice(-Math.min(3, clean.length));
      break;
    default: // the Kylo treatment: first letter + ylo. Leslie -> Lylo
      first = cap(clean[0]) + 'ylo';
  }
  return {
    name: `${first} Ren`,
    epithet: EPITHETS[(h >>> 7) % EPITHETS.length],
    dossier: DOSSIERS[(h >>> 11) % DOSSIERS.length],
  };
}

/* ---------- the ritual ---------- */
const CHAMBER_LINES = [
  'Kneeling before the Supreme Leader…',
  'Forging your crossguard saber…',
  'Doing push-ups on the Finalizer…',
  'Bending the Force around your jawline…',
  'Consulting Snoke about your cheekbones…',
  'Polishing the ashes of your enemies…',
  'Adjusting the mood lighting…',
];

let lineTimer = null, bladeTimer = null;

function show(section) {
  [ritual, chamber, reveal, fault].forEach(s => s.classList.add('hidden'));
  section.classList.remove('hidden');
}

function startChamber() {
  show(chamber);
  const blade = $('blade');
  blade.style.transform = 'scaleX(0)';
  let i = 0, progress = 0;
  $('chamberline').textContent = CHAMBER_LINES[0];
  lineTimer = setInterval(() => {
    i = (i + 1) % CHAMBER_LINES.length;
    $('chamberline').textContent = CHAMBER_LINES[i];
  }, 3600);
  // creep to 92% over ~75s; the reveal snaps it to full
  bladeTimer = setInterval(() => {
    progress = Math.min(92, progress + (92 - progress) * 0.045);
    blade.style.transform = `scaleX(${progress / 100})`;
  }, 900);
}

function stopChamber() {
  clearInterval(lineTimer);
  clearInterval(bladeTimer);
  $('blade').style.transform = 'scaleX(1)';
}

gobtn.addEventListener('click', async () => {
  const given = namein.value.trim();
  startChamber();
  try {
    const res = await fetch('/api/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: faceDataUrl }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    stopChamber();
    const identity = sithName(given);
    $('sithname').textContent = identity.name;
    $('epithet').textContent = identity.epithet;
    $('dossier').textContent = identity.dossier;
    $('portrait').src = json.image;
    const dl = $('downloadbtn');
    dl.href = json.image;
    dl.download = identity.name.toLowerCase().replace(/\s+/g, '-') + '.jpg';
    setTimeout(() => show(reveal), 450);
  } catch (e) {
    stopChamber();
    $('faultmsg').textContent = e.message;
    show(fault);
  }
});

$('againbtn').addEventListener('click', () => show(ritual));
$('retrybtn').addEventListener('click', () => show(ritual));

/* ---------- sound toggle for the ode ---------- */
const bg = $('bgvideo');
$('soundbtn').addEventListener('click', () => {
  bg.muted = !bg.muted;
  $('soundbtn').textContent = bg.muted ? 'Sound: Off' : 'Sound: On';
});

/* ---------- embers drifting up, Sith style ---------- */
(function embers() {
  const canvas = $('embers');
  const ctx = canvas.getContext('2d');
  let w, h, parts = [];
  function resize() {
    w = canvas.width = innerWidth;
    h = canvas.height = innerHeight;
  }
  resize();
  addEventListener('resize', resize);
  function spawn() {
    return {
      x: Math.random() * w,
      y: h + 10,
      r: 0.6 + Math.random() * 1.8,
      vy: 0.25 + Math.random() * 0.7,
      vx: (Math.random() - 0.5) * 0.3,
      life: 0,
      max: 400 + Math.random() * 500,
    };
  }
  for (let i = 0; i < 46; i++) {
    const p = spawn();
    p.y = Math.random() * h;
    p.life = Math.random() * p.max;
    parts.push(p);
  }
  (function tick() {
    ctx.clearRect(0, 0, w, h);
    for (let p of parts) {
      p.y -= p.vy;
      p.x += p.vx + Math.sin((p.y + p.life) / 60) * 0.15;
      p.life++;
      const fade = Math.sin(Math.PI * Math.min(1, p.life / p.max));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, ${60 + p.r * 40 | 0}, 40, ${0.35 * fade})`;
      ctx.shadowColor = 'rgba(255,43,43,0.8)';
      ctx.shadowBlur = 6;
      ctx.fill();
    }
    parts = parts.map(p => (p.y < -12 || p.life > p.max) ? spawn() : p);
    requestAnimationFrame(tick);
  })();
})();
