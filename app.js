(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ---------- Stockage local (tolérant aux erreurs) ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignoré */ }
    },
  };

  // ---------- Réglages ----------
  const LIMITS = {
    rounds: { min: 1, max: 99 },
    work: { min: 5, max: 3600 },
    rest: { min: 0, max: 3600 },
    prep: { min: 0, max: 60 },
  };
  const DEFAULT_CFG = { rounds: 8, work: 40, rest: 20, prep: 10 };
  const DEFAULT_PRESETS = [
    { id: 'tabata', name: 'Tabata', rounds: 8, work: 20, rest: 10, prep: 10 },
    { id: 'hiit', name: 'HIIT 40/20', rounds: 10, work: 40, rest: 20, prep: 10 },
  ];

  const clamp = (v, k) => Math.min(LIMITS[k].max, Math.max(LIMITS[k].min, v));
  const sanitize = (c) => {
    const out = {};
    for (const k of Object.keys(DEFAULT_CFG)) {
      const n = Math.round(Number(c && c[k]));
      out[k] = Number.isFinite(n) ? clamp(n, k) : DEFAULT_CFG[k];
    }
    return out;
  };

  let cfg = sanitize(store.get('timer.cfg', DEFAULT_CFG));
  let presets = store.get('timer.presets', null);
  if (!Array.isArray(presets)) presets = DEFAULT_PRESETS.slice();
  let soundOn = store.get('timer.sound', true) !== false;

  // ---------- Formatage ----------
  const clock = (s) => {
    s = Math.max(0, Math.ceil(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const words = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (!m) return `${sec} s`;
    return sec ? `${m} min ${sec} s` : `${m} min`;
  };
  const valueHtml = (k, v) => {
    if (k === 'rounds') return String(v);
    if (v === 0) return k === 'prep' ? 'Aucune' : 'Aucun';
    if (v < 60) return `${v}<small>s</small>`;
    return clock(v);
  };

  // Pas d'incrément : plus grand quand la valeur augmente.
  const nextValue = (k, v, dir) => {
    if (k === 'rounds') return clamp(v + dir, k);
    const base = dir > 0 ? v : v - 1;
    const step = base < 60 ? 5 : base < 300 ? 15 : 60;
    let n = v + dir * step;
    n = dir > 0 ? Math.floor(n / step) * step : Math.ceil(n / step) * step;
    return clamp(n, k);
  };

  const sessionTime = (c) => c.rounds * c.work + (c.rounds - 1) * c.rest;

  // ---------- Écran de réglage ----------
  const fields = [...document.querySelectorAll('.field')];

  function renderSetup() {
    for (const f of fields) {
      const k = f.dataset.key;
      f.querySelector('.value').innerHTML = valueHtml(k, cfg[k]);
      const [minus, plus] = f.querySelectorAll('.step');
      minus.disabled = cfg[k] <= LIMITS[k].min;
      plus.disabled = cfg[k] >= LIMITS[k].max;
    }
    const total = sessionTime(cfg);
    $('#total').textContent = clock(total);
    const parts = [`${cfg.rounds} × (${words(cfg.work)} effort${cfg.rest ? ` + ${words(cfg.rest)} repos` : ''})`];
    if (cfg.prep) parts.push(`+ ${words(cfg.prep)} de préparation`);
    $('#total-detail').textContent = parts.join(' ');
    renderPresets();
  }

  function setCfg(k, v) {
    if (cfg[k] === v) return false;
    cfg[k] = v;
    store.set('timer.cfg', cfg);
    renderSetup();
    return true;
  }

  // Appui long = répétition accélérée
  for (const btn of document.querySelectorAll('.step')) {
    const k = btn.closest('.field').dataset.key;
    const dir = Number(btn.dataset.dir);
    let delay = null, rep = null;
    const once = () => setCfg(k, nextValue(k, cfg[k], dir));
    const stop = () => { clearTimeout(delay); clearInterval(rep); delay = rep = null; };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      once();
      delay = setTimeout(() => {
        rep = setInterval(() => { if (!once()) stop(); }, 90);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => btn.addEventListener(t, stop));
    btn.addEventListener('click', (e) => { if (e.detail === 0) once(); }); // clavier
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Son ----------
  const soundBtn = $('#b-sound');
  const renderSound = () => {
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.setAttribute('aria-label', soundOn ? 'Son activé' : 'Son coupé');
  };
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('timer.sound', soundOn);
    renderSound();
    if (soundOn) { unlockAudio(); beep(880, 0.12); }
  });

  let ac = null;
  function unlockAudio() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      // Débloque l'audio sur iOS avec un son muet joué pendant le geste.
      const b = ac.createBuffer(1, 1, 22050);
      const s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
    } catch { ac = null; }
  }
  function beep(freq, dur, when = 0, vol = 0.35) {
    if (!soundOn || !ac) return;
    try {
      const t = ac.currentTime + when;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.setValueAtTime(vol, t + Math.max(0.01, dur - 0.04));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch { /* ignoré */ }
  }
  const sounds = {
    tick: () => beep(660, 0.12),
    work: () => beep(1046, 0.5),
    rest: () => beep(523, 0.5),
    done: () => { beep(784, 0.18); beep(988, 0.18, 0.2); beep(1318, 0.6, 0.4); },
  };

  // ---------- Écran de veille ----------
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignoré */ }
  }
  function releaseAwake() {
    try { wakeLock && wakeLock.release(); } catch { /* ignoré */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && run && !run.finished) keepAwake();
  });

  // ---------- Séance ----------
  const LABELS = { prep: 'PRÉPARE-TOI', work: 'EFFORT', rest: 'REPOS', done: 'BRAVO !' };
  const NEXT = { prep: 'Préparation', work: 'Effort', rest: 'Repos' };
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const PHASE_COLORS = { prep: '#f59e0b', work: '#22c55e', rest: '#3b82f6', done: '#a855f7' };

  let run = null;
  let loop = null;

  function buildPhases(c) {
    const p = [];
    if (c.prep > 0) p.push({ type: 'prep', dur: c.prep, round: 1 });
    for (let r = 1; r <= c.rounds; r++) {
      p.push({ type: 'work', dur: c.work, round: r });
      if (r < c.rounds && c.rest > 0) p.push({ type: 'rest', dur: c.rest, round: r });
    }
    return p;
  }

  function show(screen) {
    document.body.dataset.screen = screen;
    $('#setup').hidden = screen !== 'setup';
    $('#run').hidden = screen !== 'run';
    if (screen === 'setup') {
      delete document.body.dataset.phase;
      themeMeta.setAttribute('content', '#111418');
    }
  }

  function setPhaseLook(type) {
    document.body.dataset.phase = type;
    themeMeta.setAttribute('content', PHASE_COLORS[type]);
  }

  function startSession() {
    unlockAudio();
    run = {
      cfg: { ...cfg },
      phases: buildPhases(cfg),
      i: 0, end: 0, left: 0,
      paused: false, finished: false, lastSec: null,
    };
    document.body.classList.remove('paused');
    $('#run-controls').hidden = false;
    $('#done-controls').hidden = true;
    show('run');
    enterPhase(0, performance.now());
    keepAwake();
    clearInterval(loop);
    loop = setInterval(tick, 100);
    tick();
  }

  function enterPhase(i, startAt) {
    run.i = i;
    const ph = run.phases[i];
    run.end = startAt + ph.dur * 1000;
    run.lastSec = ph.dur;
    setPhaseLook(ph.type);
    $('#r-phase').textContent = LABELS[ph.type];
    $('#r-round').textContent = `Tour ${ph.round}/${run.cfg.rounds}`;
    const nx = run.phases[i + 1];
    $('#r-next').textContent = nx ? `Ensuite : ${NEXT[nx.type]} ${clock(nx.dur)}` : 'Dernier effort !';
    if (sounds[ph.type]) sounds[ph.type]();
  }

  function remainingAfter(i) {
    let s = 0;
    for (let j = i + 1; j < run.phases.length; j++) s += run.phases[j].dur;
    return s;
  }

  function tick() {
    if (!run || run.paused || run.finished) return;
    const now = performance.now();
    while (now >= run.end) {
      if (run.i + 1 >= run.phases.length) { finish(); return; }
      enterPhase(run.i + 1, run.end);
    }
    render((run.end - now) / 1000);
  }

  function render(left) {
    const ph = run.phases[run.i];
    const sec = Math.ceil(left);
    if (sec !== run.lastSec) {
      run.lastSec = sec;
      if (sec >= 1 && sec <= 3 && ph.dur > 3) sounds.tick();
    }
    $('#r-time').textContent = clock(left);
    $('#r-bar').style.width = `${Math.min(100, (1 - left / ph.dur) * 100)}%`;
    $('#r-left').textContent = `Restant ${clock(left + remainingAfter(run.i))}`;
  }

  function togglePause() {
    if (!run || run.finished) return;
    unlockAudio();
    const now = performance.now();
    if (run.paused) {
      run.end = now + run.left;
      run.paused = false;
      document.body.classList.remove('paused');
      $('#b-pause').setAttribute('aria-label', 'Pause');
      keepAwake();
      tick();
    } else {
      run.left = Math.max(0, run.end - now);
      run.paused = true;
      document.body.classList.add('paused');
      $('#b-pause').setAttribute('aria-label', 'Reprendre');
    }
  }

  function skip() {
    if (!run || run.finished) return;
    if (run.i + 1 >= run.phases.length) { finish(); return; }
    const now = performance.now();
    enterPhase(run.i + 1, now);
    if (run.paused) run.left = run.phases[run.i].dur * 1000;
    render(run.phases[run.i].dur);
  }

  function finish() {
    run.finished = true;
    clearInterval(loop);
    releaseAwake();
    document.body.classList.remove('paused');
    setPhaseLook('done');
    sounds.done();
    $('#r-phase').textContent = LABELS.done;
    $('#r-time').textContent = clock(sessionTime(run.cfg));
    $('#r-bar').style.width = '100%';
    $('#r-round').textContent = `${run.cfg.rounds} tours`;
    $('#r-left').textContent = 'Séance terminée';
    $('#r-next').textContent = `${words(run.cfg.work * run.cfg.rounds)} d'effort au total`;
    $('#run-controls').hidden = true;
    $('#done-controls').hidden = false;
  }

  function stopSession() {
    clearInterval(loop);
    releaseAwake();
    run = null;
    document.body.classList.remove('paused');
    show('setup');
    renderSetup();
  }

  $('#b-start').addEventListener('click', startSession);
  $('#b-pause').addEventListener('click', togglePause);
  $('#b-skip').addEventListener('click', skip);
  $('#b-stop').addEventListener('click', () => {
    const wasPaused = run && run.paused;
    if (!wasPaused) togglePause();
    if (confirm('Arrêter la séance ?')) stopSession();
    else if (!wasPaused) togglePause();
  });
  $('#b-again').addEventListener('click', startSession);
  $('#b-home').addEventListener('click', stopSession);
  document.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'run' || e.key !== ' ') return;
    e.preventDefault();
    togglePause();
  });

  // ---------- Séances enregistrées ----------
  const sameCfg = (p) => ['rounds', 'work', 'rest', 'prep'].every((k) => p[k] === cfg[k]);
  const metaText = (p) =>
    `${p.rounds} × ${clock(p.work)} / ${clock(p.rest)} · ${clock(sessionTime(p))}`;

  function renderPresets() {
    const list = $('#preset-list');
    list.textContent = '';
    for (const p of presets) {
      const li = document.createElement('li');
      li.className = 'preset' + (sameCfg(p) ? ' active' : '');
      const load = document.createElement('button');
      load.className = 'preset-load';
      const name = document.createElement('span');
      name.className = 'preset-name';
      name.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'preset-meta';
      meta.textContent = metaText(p);
      load.append(name, meta);
      load.addEventListener('click', () => {
        cfg = sanitize(p);
        store.set('timer.cfg', cfg);
        renderSetup();
      });
      const del = document.createElement('button');
      del.className = 'preset-del';
      del.setAttribute('aria-label', `Supprimer ${p.name}`);
      del.textContent = '×';
      del.addEventListener('click', () => {
        if (!confirm(`Supprimer « ${p.name} » ?`)) return;
        presets = presets.filter((x) => x !== p);
        store.set('timer.presets', presets);
        renderPresets();
      });
      li.append(load, del);
      list.append(li);
    }
    $('#preset-empty').hidden = presets.length > 0;
  }

  const dlg = $('#d-save');
  const nameInput = $('#d-save-name');
  $('#b-save').addEventListener('click', () => {
    $('#d-save-summary').textContent = metaText(cfg);
    nameInput.value = '';
    dlg.returnValue = '';
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
      nameInput.focus();
    } else {
      const n = prompt('Nom de la séance');
      if (n) savePreset(n);
    }
  });
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok' && nameInput.value.trim()) savePreset(nameInput.value);
  });

  function savePreset(name) {
    name = name.trim().slice(0, 30);
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const data = { ...cfg, name };
    if (existing) Object.assign(existing, data);
    else presets.unshift({ id: String(Date.now()), ...data });
    store.set('timer.presets', presets);
    renderPresets();
  }

  // ---------- Démarrage ----------
  renderSound();
  renderSetup();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
