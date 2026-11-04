/* Karaoke — type a song, strip the vocals, sing with synced lyrics, put it on the TV.
 * No build step, no server: everything runs in the browser.
 *   Song search ...... Apple iTunes Search API (JSONP)
 *   Lyrics ........... LRCLIB (free, synced LRC lyrics)
 *   Vocal removal .... separator-worker.js (on-device, Web Audio)
 *   Full songs ....... your own file, or a YouTube karaoke/instrumental upload (official embed player)
 *   TV ............... TV mode (full screen) + a "TV window" that follows along via BroadcastChannel
 */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LRCLIB = 'https://lrclib.net';
const IS_RECEIVER = new URLSearchParams(location.search).has('tv');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decodeHtml = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const store = {
  get(k, d) { try { const v = localStorage.getItem('karaoke.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('karaoke.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ------------------------------------------------------------------ toast */
let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.hidden = true; action.fn(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6500 : 3800);
}

/* ------------------------------------------------------------------ search */
function storeCountry() {
  const m = (navigator.language || '').match(/-([a-z]{2})$/i);
  return m ? m[1].toUpperCase() : 'US';
}

function jsonp(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const cb = '__kjp' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, timeout);
    window[cb] = (data) => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error('network')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}

async function searchSongs(q) {
  try {
    const url = 'https://itunes.apple.com/search?' + new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '25', country: storeCountry() });
    const data = await jsonp(url);
    const results = (data.results || []).filter((r) => r.trackName && r.artistName).map((r) => ({
      id: 'it' + r.trackId,
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName || '',
      duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
      thumb: r.artworkUrl100 || r.artworkUrl60 || '',
      art: (r.artworkUrl100 || '').replace(/\d+x\d+bb/, '600x600bb'),
      preview: r.previewUrl || '',
      explicit: r.trackExplicitness === 'explicit',
    }));
    if (results.length) return results;
  } catch (e) { console.warn('iTunes search failed, falling back to LRCLIB', e); }

  const r = await fetch(`${LRCLIB}/api/search?` + new URLSearchParams({ q }));
  if (!r.ok) throw new Error('Search failed');
  const seen = new Set();
  return (await r.json()).filter((x) => {
    const k = norm(x.trackName) + '|' + norm(x.artistName);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).map((x) => ({
    id: 'lr' + x.id, title: x.trackName, artist: x.artistName, album: x.albumName || '',
    duration: x.duration || 0, thumb: '', art: '', preview: '', lrclib: x,
  }));
}

/* ------------------------------------------------------------------ lyrics */
const JUNK = /feat\.?|ft\.|\bwith\b|remaster|version|edit\b|mix\b|\bfrom\b|soundtrack|mono|stereo|\blive\b|deluxe|bonus|explicit|clean|anniversary|single|radio|acoustic/i;
function cleanTitle(t) {
  let s = t.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner) => (JUNK.test(inner) ? '' : m));
  s = s.replace(/\s+-\s+[^-]*$/, (m) => (JUNK.test(m) ? '' : m));
  return s.trim() || t;
}
function mainArtist(a) {
  return (a || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bwith\b)\s*/i)[0].trim() || a || '';
}
function titleMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  return a.includes(b) || b.includes(a);
}
function scoreLyric(x, song, wantDur) {
  const nt = norm(cleanTitle(song.title)), xt = norm(cleanTitle(x.trackName || ''));
  if (!titleMatches(nt, xt)) return -Infinity;
  let s = nt === xt ? 40 : 20;
  const na = norm(mainArtist(song.artist)), xa = norm(x.artistName);
  if (na && xa && (xa.includes(na) || na.includes(xa))) s += 30; else s -= 25; // covers still OK
  if (x.syncedLyrics) s += 50; else if (x.plainLyrics) s += 8;
  if (x.instrumental) s -= 80;
  const d = wantDur || song.duration;
  if (d && x.duration) s -= Math.min(45, Math.abs(x.duration - d) * 2.5);
  return s;
}
async function lrclibSearch(params) {
  const r = await fetch(`${LRCLIB}/api/search?` + new URLSearchParams(params));
  if (!r.ok) throw new Error('lyrics ' + r.status);
  return r.json();
}
async function findLyrics(song, query) {
  const title = cleanTitle(song.title), artist = song.artist || '';
  const reqs = query
    ? [lrclibSearch({ q: query })]
    : [
      lrclibSearch(artist ? { track_name: title, artist_name: artist } : { track_name: title }),
      lrclibSearch({ q: `${title} ${mainArtist(artist)}`.trim() }),
    ];
  if (!query && title !== song.title) reqs.push(lrclibSearch({ q: `${song.title} ${mainArtist(artist)}` }));
  const settled = await Promise.allSettled(reqs);
  if (settled.every((s) => s.status === 'rejected')) throw new Error('offline');
  const seen = new Map();
  if (song.lrclib) seen.set(song.lrclib.id, song.lrclib);
  for (const s of settled) if (s.status === 'fulfilled' && Array.isArray(s.value)) for (const x of s.value) if (!seen.has(x.id)) seen.set(x.id, x);
  return rankLyrics([...seen.values()].filter((x) => x.syncedLyrics || x.plainLyrics), query ? null : song, song.duration);
}
function rankLyrics(list, song, dur) {
  if (!song) return list.sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur));
  return list.map((x) => ({ x, s: scoreLyric(x, song, dur) })).filter((o) => o.s > -Infinity).sort((a, b) => b.s - a.s).map((o) => o.x);
}

/** Parse LRC (incl. multiple stamps per line, [offset:], and <mm:ss.xx> word stamps). */
function parseLRC(text) {
  const out = [];
  let offset = 0;
  const stamp = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const times = [];
    let rest = raw, m;
    while ((m = rest.match(stamp))) {
      times.push(parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) {
      const o = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
      if (o) offset = parseInt(o[1], 10) / 1000;
      continue;
    }
    for (const t of times) out.push({ t, raw: rest });
  }
  out.sort((a, b) => a.t - b.t);
  return out.map(({ t, raw }) => {
    const units = [];
    const wordStamp = /<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>/g;
    if (wordStamp.test(raw)) {
      let cur = null;
      for (const part of raw.split(/(<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>)/)) {
        const mm = part.match(/^<(\d+):([\d.]+)>$/);
        if (mm) cur = parseInt(mm[1], 10) * 60 + parseFloat(mm[2]) - offset;
        else if (part) units.push({ text: part, s: cur });
      }
    } else {
      for (const w of raw.trim().match(/\S+\s*/g) || []) units.push({ text: w, s: null });
    }
    const text = units.map((u) => u.text).join('').trim();
    return { t: Math.max(0, t - offset), text, units, empty: !text };
  });
}

/** Give every word a start/end time so the line can "fill" as it's sung. */
function timeLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const next = lines[i + 1] ? lines[i + 1].t : L.t + 8;
    const chars = L.text.replace(/\s/g, '').length;
    const est = Math.max(1.2, 0.45 + chars * 0.075);
    const avail = Math.max(0.3, next - L.t - 0.12);
    const dur = Math.min(avail, est);
    if (L.units.some((u) => u.s != null)) {
      L.units.forEach((u, k) => {
        u.s = u.s ?? (k ? L.units[k - 1].s : L.t);
        u.e = L.units[k + 1] && L.units[k + 1].s != null ? L.units[k + 1].s : Math.min(next, u.s + 1);
      });
    } else {
      const weights = L.units.map((u) => u.text.trim().length + 1);
      const total = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = L.t;
      L.units.forEach((u, k) => { u.s = acc; acc += (dur * weights[k]) / total; u.e = acc; });
    }
    L.end = L.units.length ? L.units[L.units.length - 1].e : L.t;
  }
  return lines;
}

function plainLines(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((text) => ({ t: null, text, units: [{ text, s: null, e: null }], empty: false }));
}

function lineIndexAt(lines, T) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function wordsHTML(line) {
  return line.units.map((u, k) => `<span class="w" data-k="${k}">${esc(u.text)}</span>`).join('');
}

/** Colour the words of `el` (holding `line`) up to lyric-time T. */
function paintWords(el, line, T) {
  const spans = el.children;
  for (let k = 0; k < spans.length; k++) {
    const u = line.units[k];
    if (!u) continue;
    const sp = spans[k];
    if (T >= u.e) { if (sp.className !== 'w done') { sp.className = 'w done'; sp.style.removeProperty('--p'); } }
    else if (T >= u.s) {
      if (sp.className !== 'w now') sp.className = 'w now';
      sp.style.setProperty('--p', (((T - u.s) / (u.e - u.s)) * 100).toFixed(1) + '%');
    } else if (sp.className !== 'w') { sp.className = 'w'; sp.style.removeProperty('--p'); }
  }
}

/* ------------------------------------------------------------------ audio */
let actx = null;
function getCtx() {
  if (!actx) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC({ latencyHint: 'playback' });
  }
  return actx;
}
// iOS needs the audio context to be started from a tap.
function unlockAudio() {
  const ctx = getCtx();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  try {
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch { /* ignore */ }
}
['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, function once() {
  if (IS_RECEIVER) return;
  unlockAudio();
  ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.removeEventListener(e, once, true));
}, true));

function runSeparator(L, R, sampleRate, strength, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker('separator-worker.js?v=2');
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') onProgress(d.p);
      else { w.terminate(); if (d.type === 'error') reject(new Error(d.message)); else resolve(d); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Vocal remover failed')); };
    w.postMessage({ L, R, sampleRate, opts: { strength } }, [L.buffer, R.buffer]);
  });
}

class FileEngine {
  constructor() {
    this.kind = 'file';
    this.canVocal = true;
    this.pos = 0; this.playing = false; this.duration = 0; this.vocal = 0;
    this.key = 0; this.range = null; this.job = null;
    const ctx = getCtx();
    this.gI = ctx.createGain(); this.gV = ctx.createGain();
    this.gI.connect(ctx.destination); this.gV.connect(ctx.destination);
    this.gV.gain.value = 0;
  }
  async load(blob, strength, onProgress) {
    const ctx = getCtx();
    const arr = await blob.arrayBuffer();
    const buf = await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(arr, res, () => rej(new Error("Couldn't read that audio file")));
      if (p && p.catch) p.catch(() => rej(new Error("Couldn't read that audio file")));
    });
    this.duration = buf.duration;
    if (buf.numberOfChannels < 2) { this.mono(buf); return { mono: true }; }
    const L = buf.getChannelData(0).slice(), R = buf.getChannelData(1).slice();
    const r = await runSeparator(L, R, buf.sampleRate, strength, onProgress);
    if (r.type === 'mono') { this.mono(buf); return { mono: true }; }
    const mk = (a, b) => {
      const B = ctx.createBuffer(2, a.length, buf.sampleRate);
      B.copyToChannel(a, 0); B.copyToChannel(b, 1);
      return B;
    };
    this.inst = this.baseInst = mk(r.instL, r.instR);
    this.voc = this.baseVoc = mk(r.vocL, r.vocR);
    this.range = r.range || null;
    return { ms: r.ms };
  }
  mono(buf) { this.inst = this.baseInst = buf; this.voc = this.baseVoc = null; this.canVocal = false; }
  swapBuffers(inst, voc) {
    const was = this.playing, pos = this.currentTime;
    if (was) { this.stopSources(); this.playing = false; }
    this.inst = inst; this.voc = voc; this.pos = pos;
    if (was) this.play();
  }
  /** Change key by `semi` semitones from the original. Resolves true once the music is in the new key. */
  async setKey(semi, onProgress) {
    semi = clamp(Math.round(semi), -12, 12);
    const hadJob = !!this.job;
    if (this.job) { this.job.cancel(); this.job = null; }
    if (semi === this.key && !hadJob && (semi === 0 || this.inst !== this.baseInst)) return true;
    this.key = semi;
    if (!semi) { this.swapBuffers(this.baseInst, this.baseVoc); return true; }
    const job = { cancelled: false, workers: [] };
    job.cancel = () => { job.cancelled = true; job.workers.forEach((w) => w.terminate()); };
    this.job = job;
    const shift = (buf, prog) => new Promise((resolve, reject) => {
      const w = new Worker('pitch-worker.js?v=1');
      job.workers.push(w);
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') { if (prog) prog(d.p); return; }
        w.terminate();
        if (d.type === 'done') {
          const B = getCtx().createBuffer(2, d.L.length, buf.sampleRate);
          B.copyToChannel(d.L, 0); B.copyToChannel(d.R, 1);
          resolve(B);
        } else reject(new Error(d.message));
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Key change failed')); };
      const L = buf.getChannelData(0).slice(), R = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0).slice();
      w.postMessage({ L, R, sampleRate: buf.sampleRate, semitones: semi }, [L.buffer, R.buffer]);
    });
    // Pause, drop the previous re-keyed copy, re-key the band first and resume;
    // the guide vocal follows in the background.
    const wasPlaying = this.playing;
    this.pause();
    this.inst = this.baseInst; this.voc = this.baseVoc;
    let inst;
    try { inst = await shift(this.baseInst, onProgress); } catch (err) { if (job.cancelled) return false; this.job = null; this.key = 0; throw err; }
    if (job.cancelled) return false;
    this.inst = inst;
    this.voc = null;
    if (wasPlaying) this.play();
    if (this.baseVoc) {
      shift(this.baseVoc).then((voc) => {
        if (job.cancelled || this.job !== job) return;
        this.job = null;
        this.swapBuffers(this.inst, voc);
      }).catch(() => { if (this.job === job) this.job = null; });
    } else this.job = null;
    return true;
  }
  play() {
    if (this.playing || !this.inst) return;
    const ctx = getCtx();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (this.pos >= this.duration - 0.05) this.pos = 0;
    const t0 = ctx.currentTime + 0.04;
    const start = (buf, g) => { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start(t0, this.pos); return s; };
    const sI = start(this.inst, this.gI);
    this.sI = sI;
    this.sV = this.voc ? start(this.voc, this.gV) : null;
    sI.onended = () => {
      if (this.sI === sI && this.playing) { this.playing = false; this.pos = this.duration; this.sI = this.sV = null; this.onended && this.onended(); }
    };
    this.startAt = t0 - this.pos;
    this.playing = true;
  }
  stopSources() {
    for (const s of [this.sI, this.sV]) if (s) { s.onended = null; try { s.stop(); } catch { /* ok */ } s.disconnect(); }
    this.sI = this.sV = null;
  }
  pause() { if (!this.playing) return; this.pos = this.currentTime; this.stopSources(); this.playing = false; }
  seek(t) {
    t = clamp(t, 0, Math.max(0, this.duration - 0.05));
    const was = this.playing;
    if (was) { this.stopSources(); this.playing = false; }
    this.pos = t;
    if (was) this.play();
  }
  get currentTime() {
    if (!this.playing) return this.pos;
    const ctx = getCtx();
    return clamp(ctx.currentTime - this.startAt - (ctx.outputLatency || 0), 0, this.duration);
  }
  setVocal(v) {
    this.vocal = v;
    const ctx = getCtx();
    this.gV.gain.setTargetAtTime(v, ctx.currentTime, 0.04);
  }
  destroy() {
    if (this.job) { this.job.cancel(); this.job = null; }
    this.pause(); this.gI.disconnect(); this.gV.disconnect();
    this.inst = this.voc = this.baseInst = this.baseVoc = null;
  }
}

let ytApi;
function loadYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!ytApi) {
    ytApi = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { ytApi = null; reject(new Error("YouTube didn't load. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

const YT_ERRORS = {
  2: "That doesn't look like a valid YouTube video.",
  5: "This video can't play in the browser. Try another one.",
  100: 'That video was removed or is private.',
  101: "The uploader doesn't allow this video outside YouTube. Try another one.",
  150: "The uploader doesn't allow this video outside YouTube. Try another one.",
};

class YTEngine {
  constructor() { this.kind = 'youtube'; this.canVocal = false; this.player = null; this._raw = 0; this._at = 0; this._last = 0; }
  load(videoId) {
    return loadYTApi().then(() => new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.videoId = videoId;
      $('#ytBox').hidden = false;
      if (this.player && this.player.cueVideoById) {
        this.player.cueVideoById(videoId);
      } else {
        this.player = new YT.Player('ytPlayer', {
          videoId,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
          events: {
            onReady: () => this.settle(),
            onStateChange: (e) => this.onState(e.data),
            onError: (e) => this.onError(e.data),
          },
        });
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.settle(), 8000);
    }));
  }
  settle(err) {
    clearTimeout(this.timer);
    if (!this.pending) return;
    const p = this.pending; this.pending = null;
    if (err) p.reject(err); else p.resolve();
  }
  onState(s) {
    if (s === 5 || s === 1) this.settle();
    if (s === 0 && this.onended) this.onended();
  }
  onError(code) {
    const err = new Error(YT_ERRORS[code] || "That YouTube video can't be played here.");
    if (this.pending) this.settle(err);
    else if (this.onerror) this.onerror(err);
  }
  get playing() { const p = this.player; return !!(p && p.getPlayerState && (p.getPlayerState() === 1 || p.getPlayerState() === 3)); }
  get duration() { return (this.player && this.player.getDuration && this.player.getDuration()) || 0; }
  get currentTime() {
    const p = this.player;
    if (!p || !p.getCurrentTime) return 0;
    const raw = p.getCurrentTime() || 0, now = performance.now();
    if (raw !== this._raw) { this._raw = raw; this._at = now; }
    let t = raw;
    if (p.getPlayerState() === 1) t = raw + Math.min(0.6, (now - this._at) / 1000);
    // keep it smooth: ignore tiny backwards jitter
    if (t < this._last && this._last - t < 0.25) t = this._last;
    this._last = t;
    return t;
  }
  play() { if (this.player && this.player.playVideo) this.player.playVideo(); }
  pause() { if (this.player && this.player.pauseVideo) this.player.pauseVideo(); }
  seek(t) { this._last = 0; if (this.player && this.player.seekTo) this.player.seekTo(Math.max(0, t), true); }
  setVocal() {}
  destroy() { this.pause(); $('#ytBox').hidden = true; }
}
const yt = new YTEngine();

function ytId(s) {
  s = (s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12) || null;
    const v = u.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  } catch { /* not a URL */ }
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

async function ytSearch(q) {
  const key = store.get('ytKey', '');
  if (!key) return null;
  const r = await fetch('https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q, key,
  }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'YouTube search failed');
  return (j.items || []).map((it) => ({
    id: it.id.videoId,
    title: decodeHtml(it.snippet.title),
    channel: decodeHtml(it.snippet.channelTitle),
    thumb: (it.snippet.thumbnails && (it.snippet.thumbnails.medium || it.snippet.thumbnails.default) || {}).url || '',
  }));
}

/* ------------------------------------------------------------------ library (IndexedDB) */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('karaoke', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('songs', mode);
      const req = fn(tx.objectStore('songs'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  };
  return {
    put: (rec) => run('readwrite', (s) => s.put(rec)),
    get: (id) => run('readonly', (s) => s.get(id)),
    all: () => run('readonly', (s) => s.getAll()),
    del: (id) => run('readwrite', (s) => s.delete(id)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();

/* ------------------------------------------------------------------ voices & keys */
// Comfortable singing ranges (MIDI note numbers).
const VOICES = [
  { id: 'bass', name: 'Bass', lo: 40, hi: 60, group: 'male' },
  { id: 'baritone', name: 'Baritone', lo: 45, hi: 65, group: 'male' },
  { id: 'tenor', name: 'Tenor', lo: 48, hi: 69, group: 'male' },
  { id: 'alto', name: 'Alto', lo: 53, hi: 74, group: 'female' },
  { id: 'mezzo', name: 'Mezzo', lo: 57, hi: 77, group: 'female' },
  { id: 'soprano', name: 'Soprano', lo: 60, hi: 81, group: 'female' },
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (m) => { m = Math.round(m); return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
/** Smallest key change (−6…+5) that puts the melody in the voice's range, singing in whichever octave suits. */
function fitKey(range, voice) {
  if (!range || !voice) return null;
  const songMid = (range.lo + range.hi) / 2, voiceMid = (voice.lo + voice.hi) / 2;
  const diff = Math.round(voiceMid - songMid);
  const shift = ((((diff % 12) + 18) % 12) - 6);
  const octaves = Math.round((voiceMid - (songMid + shift)) / 12); // >0 sing higher, <0 sing lower
  return { shift, octaves };
}
const keyText = (k) => (!k ? 'Original' : (k > 0 ? '+' : '−') + Math.abs(k));
function octaveText(o) {
  return o < 0 ? (o === -1 ? ' (sing it an octave lower)' : ' (sing it two octaves lower)') : o > 0 ? (o === 1 ? ' (sing it an octave higher)' : ' (sing it two octaves higher)') : '';
}

/* ------------------------------------------------------------------ app state */
const S = {
  song: null,
  candidates: [], lyricIdx: 0, lyric: null,
  lines: [], synced: false,
  engine: null, source: null,
  offset: 0, vocal: store.get('vocal', 0), strength: store.get('strength', 0.85),
  syncMode: false, tvOn: false, pendingFile: null, ytKind: 'karaoke',
  voice: store.get('voice', ''), keyTarget: 0, savedKey: null,
};

/* ------------------------------------------------------------------ phone lyrics view */
const LV = {
  el: $('#lyrics'), nodes: [], idx: -2, holdUntil: 0,
  render() {
    const el = this.el;
    this.idx = -2;
    if (!S.lines.length) {
      el.innerHTML = S.lyricState === 'loading'
        ? '<div class="no-lyrics"><span class="spin"></span><p>Finding lyrics…</p></div>'
        : `<div class="no-lyrics"><p>${S.lyricState === 'error' ? "Couldn't reach the lyrics service." : 'No lyrics found for this song.'}</p>
           <form class="row" id="lyricSearch"><input name="q" placeholder="Search lyrics: title, artist" value="${esc(S.song ? S.song.title + ' ' + S.song.artist : '')}"><button class="btn red">Search</button></form></div>`;
      this.nodes = [];
      return;
    }
    el.innerHTML = S.lines.map((L, i) => S.synced
      ? `<div class="ly${L.empty ? ' gap' : ''}" data-i="${i}">${L.empty ? '♪' : wordsHTML(L)}</div>`
      : `<div class="ly plain" data-i="${i}">${esc(L.text)}</div>`).join('');
    this.nodes = [...el.children];
  },
  update(T, t, dur) {
    if (!this.nodes.length) return;
    if (!S.synced) {
      if (performance.now() > this.holdUntil && dur && S.engine && S.engine.playing) {
        const top = this.el.getBoundingClientRect().top + scrollY - innerHeight * 0.25 + (this.el.scrollHeight - innerHeight * 0.5) * clamp(t / dur, 0, 1);
        if (Math.abs(scrollY - top) > 2) window.scrollTo(0, Math.max(0, top));
      }
      return;
    }
    const i = lineIndexAt(S.lines, T);
    if (i !== this.idx) {
      for (const old of this.el.querySelectorAll('.ly.active')) {
        old.classList.remove('active');
        for (const w of old.children) { w.className = 'w'; w.style.removeProperty('--p'); }
      }
      this.nodes.forEach((n, k) => n.classList.toggle('past', k < i));
      const cur = this.nodes[i];
      if (cur) { cur.classList.add('active'); cur.classList.remove('past'); }
      this.idx = i;
      if (performance.now() > this.holdUntil) this.scrollTo(cur || this.nodes[0]);
    }
    const cur = this.nodes[i];
    if (cur && !S.lines[i].empty) paintWords(cur, S.lines[i], T);
  },
  scrollTo(node) {
    if (!node || S.tvOn) return;
    const dockH = $('#dock').offsetHeight || 0;
    const y = node.getBoundingClientRect().top + scrollY - (innerHeight - dockH) * 0.36;
    scrollSmoothTo(y);
  },
};
let scrollTarget = null;
function scrollSmoothTo(y) {
  y = Math.max(0, y);
  if (scrollTarget !== null && Math.abs(scrollTarget - y) < 4) return;
  scrollTarget = y;
  window.scrollTo({ top: y, behavior: 'smooth' });
}
['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { LV.holdUntil = performance.now() + 4000; scrollTarget = null; }, { passive: true }));

/* ------------------------------------------------------------------ TV view */
const TV = {
  root: $('#tv'), stage: $('#tvStage'), cur: $('#tvCur'), prev: $('#tvPrev'), next: $('#tvNext'), next2: $('#tvNext2'),
  count: $('#tvCount'), prog: $('#tvProg'), key: '',
  song: null, lines: [], synced: false,
  setSong(song, lines, synced) {
    this.song = song; this.lines = lines || []; this.synced = !!synced; this.key = '';
    $('#tvSong').textContent = song ? song.title : '';
    $('#tvArtist').textContent = song ? song.artist + (lines && lines.length && !synced ? ' · lyrics not timed' : '') : '';
    $('#tvBg').style.backgroundImage = song && song.art ? `url("${song.art}")` : '';
    $('#tvIdle').hidden = !!song;
  },
  show(key, rows, flip) {
    if (key === this.key) return false;
    this.key = key;
    const [p, c, n, n2, cls] = rows;
    this.prev.textContent = p || '';
    this.cur.className = 'tv-line cur ' + (cls || '');
    if (c && typeof c === 'object') this.cur.innerHTML = wordsHTML(c); else this.cur.textContent = c || '';
    this.next.textContent = n || '';
    this.next2.textContent = n2 || '';
    if (flip) { this.stage.classList.remove('flip'); void this.stage.offsetWidth; this.stage.classList.add('flip'); }
    return true;
  },
  dots(n) {
    this.count.classList.toggle('on', n > 0);
    [...this.count.children].forEach((d, k) => d.classList.toggle('off', k >= n));
  },
  update(T, t, dur) {
    this.prog.style.width = dur ? clamp((t / dur) * 100, 0, 100) + '%' : '0';
    const lines = this.lines;
    if (!this.song) return;
    if (!lines.length) { this.show('none', ['', '♪', '', '', 'music']); this.dots(0); return; }
    if (!this.synced) {
      const i = dur ? Math.floor(clamp(t / dur, 0, 0.999) * lines.length) : 0;
      this.show('p' + i, [lines[i - 1] && lines[i - 1].text, lines[i].text, lines[i + 1] && lines[i + 1].text, lines[i + 2] && lines[i + 2].text], true);
      this.dots(0);
      return;
    }
    const i = lineIndexAt(lines, T);
    const L = lines[i];
    // next non-empty line
    let j = i + 1; while (lines[j] && lines[j].empty) j++;
    const N = lines[j];
    let j2 = j + 1; while (lines[j2] && lines[j2].empty) j2++;
    const N2 = lines[j2];
    const toNext = N ? N.t - T : Infinity;
    const gapAfter = L && N ? N.t - L.end : Infinity; // silence between this line and the next
    const waiting = i < 0 || L.empty || (T > L.end + 1.6 && gapAfter > 3.8);
    if (waiting) {
      const lead = i < 0 && toNext > 7;
      if (lead) this.show('title', ['', this.song.title, this.song.artist, '', 'title-card'], false);
      else if (N) this.show('w' + j, [i >= 0 && !L.empty ? L.text : '', N, N2 && N2.text, '', 'waiting'], false);
      else this.show('end', [L && !L.empty ? L.text : '', '♪', '', '', 'music'], false);
      if (lead) this.next.className = 'tv-line next artist-card'; else this.next.className = 'tv-line next';
      this.dots(N && toNext <= 3 ? Math.min(3, Math.ceil(toNext)) : 0);
      return;
    }
    this.next.className = 'tv-line next';
    let pi = i - 1; while (lines[pi] && lines[pi].empty) pi--;
    this.show('l' + i, [lines[pi] && lines[pi].text, L, N && N.text, N2 && N2.text, ''], this.key.startsWith('l'));
    this.dots(0);
    paintWords(this.cur, L, T);
  },
};

let uiTimer;
function tvPoke() {
  TV.root.classList.add('show-ui');
  TV.root.classList.remove('hide-cursor');
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => { TV.root.classList.remove('show-ui'); TV.root.classList.add('hide-cursor'); }, 3200);
}
function fullscreen(on) {
  const d = document, el = d.documentElement;
  try {
    if (on && !(d.fullscreenElement || d.webkitFullscreenElement)) {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen || (() => null)).call(el);
      if (p && p.catch) p.catch(() => {});
    } else if (!on && (d.fullscreenElement || d.webkitFullscreenElement)) {
      const p = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      if (p && p.catch) p.catch(() => {});
    }
  } catch { /* not supported (iPhone) */ }
}
function enterTV() {
  S.tvOn = true;
  TV.root.hidden = false;
  document.body.classList.add('tv-on');
  TV.key = '';
  fullscreen(true);
  tvPoke();
  if (matchMedia('(orientation: portrait)').matches && matchMedia('(pointer: coarse)').matches) {
    $('#tvHint').hidden = false;
    setTimeout(() => { $('#tvHint').hidden = true; }, 5000);
  }
  keepAwake(true);
}
function exitTV() {
  S.tvOn = false;
  TV.root.hidden = true;
  document.body.classList.remove('tv-on');
  fullscreen(false);
  LV.idx = -2;
  if (!(S.engine && S.engine.playing)) keepAwake(false);
}

/* ------------------------------------------------------------------ TV window link */
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('karaoke-tv') : null;
function bcSend(msg) { if (bc) try { bc.postMessage(msg); } catch { /* ignore */ } }
function bcSong() {
  bcSend({ type: 'song', song: S.song && S.engine ? S.song : null, lines: S.lines, synced: S.synced });
}
function bcTick() {
  const e = S.engine;
  bcSend({ type: 'tick', t: e ? e.currentTime : 0, playing: !!(e && e.playing), offset: S.offset, dur: e ? e.duration : 0, at: Date.now() });
}

/* ------------------------------------------------------------------ wake lock */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ((S.engine && S.engine.playing) || S.tvOn || IS_RECEIVER)) keepAwake(true);
});

/* ------------------------------------------------------------------ views */
function showView(name) {
  $('#home').hidden = name !== 'home';
  $('#song').hidden = name !== 'song';
  $('#backBtn').hidden = name === 'home';
}

function resultHTML(r, i, extra = '') {
  const thumb = r.thumb ? `style="background-image:url('${esc(r.thumb)}')"` : '';
  return `<li class="res" tabindex="0" data-i="${i}">
    <div class="thumb" ${thumb}>${r.thumb ? '' : '♪'}</div>
    <div class="res-txt">
      <div class="res-title">${esc(r.title)}${r.explicit ? '<span class="tag">E</span>' : ''}${extra}</div>
      <div class="res-sub">${esc(r.artist)}${r.album ? ' · ' + esc(r.album) : ''}</div>
    </div>
    ${r.duration ? `<span class="res-dur">${fmt(r.duration)}</span>` : ''}
    ${r.preview ? `<button class="mini" data-preview="${i}" aria-label="Play 30-second preview"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg></button>` : ''}
  </li>`;
}

let lastResults = [];
async function doSearch(q) {
  q = q.trim();
  if (!q) return;
  $('#resultsWrap').hidden = false;
  $('#results').innerHTML = '<li class="empty"><span class="spin"></span>&nbsp; Searching…</li>';
  $('#resultsNote').textContent = '';
  try {
    lastResults = await searchSongs(q);
    $('#results').innerHTML = lastResults.length
      ? lastResults.map((r, i) => resultHTML(r, i)).join('')
      : '<li class="empty">No songs found. Try the title and the artist.</li>';
    $('#resultsNote').textContent = lastResults.length ? 'Tap a song to start' : '';
  } catch (e) {
    $('#results').innerHTML = `<li class="empty">Couldn't search right now (${esc(e.message)}). Check your connection.</li>`;
  }
}

/* preview (30s Apple sample) */
const previewAudio = $('#previewAudio');
let previewBtn = null;
function togglePreview(url, btn) {
  if (previewBtn === btn && !previewAudio.paused) { stopPreview(); return; }
  stopPreview();
  previewAudio.src = url;
  previewAudio.play().catch(() => toast("Preview couldn't play."));
  previewBtn = btn;
  if (btn) btn.classList.add('on');
}
function stopPreview() {
  previewAudio.pause();
  if (previewBtn) previewBtn.classList.remove('on');
  previewBtn = null;
}
previewAudio.addEventListener('ended', stopPreview);

/* ------------------------------------------------------------------ library UI */
async function renderLibrary() {
  let recs = [];
  try { recs = await DB.all(); } catch { /* IndexedDB unavailable */ }
  recs.sort((a, b) => b.updated - a.updated);
  $('#libraryWrap').hidden = !recs.length;
  $('#library').innerHTML = recs.map((r, i) => {
    const tag = r.source ? `<span class="tag">${r.source.type === 'file' ? 'File' : 'YouTube'}</span>` : '';
    return resultHTML({ ...r.song, preview: '' }, i, tag).replace('</li>', `<button class="mini" data-del="${esc(r.id)}" aria-label="Remove from My songs"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button></li>`);
  }).join('');
  renderLibrary.recs = recs;
}

async function saveRecord() {
  if (!S.song) return;
  const rec = {
    id: S.song.id,
    song: S.song,
    lyric: S.lyric ? { id: S.lyric.id, trackName: S.lyric.trackName, artistName: S.lyric.artistName, duration: S.lyric.duration, syncedLyrics: S.lyric.syncedLyrics || null, plainLyrics: S.lyric.plainLyrics || null } : null,
    offset: S.offset,
    key: S.engine && S.engine.kind === 'file' ? S.engine.key : S.savedKey,
    source: S.source,
    updated: Date.now(),
  };
  try { await DB.put(rec); } catch (e) { console.warn('save failed', e); }
}
let saveTimer;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveRecord, 800); }

/* ------------------------------------------------------------------ song screen */
function setLyricChip() {
  const c = $('#lyricsChip');
  const n = S.candidates.length;
  c.className = 'chip';
  if (S.lyricState === 'loading') { c.innerHTML = '<span class="spin" style="width:14px;height:14px;border-width:2px"></span> Finding lyrics…'; return; }
  if (S.lyricState === 'error') { c.classList.add('bad'); c.textContent = 'Lyrics offline · retry'; return; }
  if (!S.lines.length) { c.classList.add('bad'); c.textContent = 'No lyrics found · search'; return; }
  c.classList.add(S.synced ? 'ok' : 'warn');
  c.textContent = (S.synced ? '✓ Synced lyrics' : 'Lyrics (not timed)') + (n > 1 ? ` · version ${S.lyricIdx + 1}/${n}` : '');
  c.title = n > 1 ? 'Tap to try another version of the lyrics' : '';
}

function applyLyric(x) {
  S.lyric = x || null;
  if (x && x.syncedLyrics) {
    S.lines = timeLines(parseLRC(x.syncedLyrics));
    S.synced = S.lines.length > 0;
  } else { S.lines = []; S.synced = false; }
  if (!S.synced) S.lines = x && x.plainLyrics ? plainLines(x.plainLyrics) : [];
  S.lyricState = 'done';
  setLyricChip();
  LV.render();
  TV.setSong(S.engine ? S.song : null, S.lines, S.synced);
  bcSong();
}

async function loadLyrics(query) {
  const song = S.song;
  S.lyricState = 'loading'; S.lines = []; S.candidates = [];
  setLyricChip(); LV.render();
  try {
    const list = await findLyrics(song, query);
    if (S.song !== song) return;
    S.candidates = list; S.lyricIdx = 0;
    applyLyric(list[0]);
    if (query && !list.length) toast('No lyrics found for that search.');
  } catch (e) {
    if (S.song !== song) return;
    S.lyricState = 'error'; setLyricChip(); LV.render();
  }
}

/** Once we know the real length of the music, prefer lyrics timed for that length. */
function refineLyricsForDuration(dur) {
  if (!dur || S.candidates.length < 2 || !S.lyric || !S.song) return;
  const cur = S.lyric;
  if (Math.abs((cur.duration || dur) - dur) < 3) return;
  const ranked = rankLyrics(S.candidates.slice(), S.song, dur);
  const best = ranked[0];
  if (best && best !== cur && best.syncedLyrics && Math.abs(best.duration - dur) + 2 < Math.abs((cur.duration || 0) - dur)) {
    S.candidates = ranked; S.lyricIdx = 0;
    applyLyric(best);
    toast('Switched to lyrics that match the length of this track.');
  }
}

function ytQuery() {
  const s = S.song;
  const base = `${cleanTitle(s.title)} ${mainArtist(s.artist)}`.trim();
  if (S.ytKind === 'lower') {
    const v = VOICES.find((x) => x.id === S.voice);
    return base + ' karaoke lower key' + (v && v.group === 'male' ? ' male' : '');
  }
  return S.ytKind === 'karaoke' ? base + ' karaoke' : S.ytKind === 'instrumental' ? base + ' instrumental' : base + ' official audio';
}
async function refreshYT() {
  if (!S.song) return;
  const q = ytQuery();
  $('#ytFind').href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  const hasKey = !!store.get('ytKey', '');
  $('#ytKeyTip').hidden = hasKey;
  const box = $('#ytResults');
  if (!hasKey) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<li class="empty"><span class="spin"></span>&nbsp; Searching YouTube…</li>';
  try {
    const items = await ytSearch(q);
    if (ytQuery() !== q) return;
    box.innerHTML = items.length ? items.map((v) => `<li class="yt-item" data-yt="${esc(v.id)}" data-title="${esc(v.title)}" tabindex="0">
        <img src="${esc(v.thumb)}" alt="" loading="lazy"><div class="res-txt"><div class="res-title">${esc(v.title)}</div><div class="res-sub">${esc(v.channel)}</div></div></li>`).join('')
      : '<li class="empty">Nothing found. Try another tab above.</li>';
  } catch (e) {
    box.innerHTML = `<li class="empty">${esc(e.message)}</li>`;
  }
}

function resetEngine() {
  if (S.engine) { S.engine.onended = null; S.engine.destroy(); }
  S.engine = null;
  $('#ytBox').hidden = true;
  $('#dock').hidden = true;
  document.body.style.setProperty('--dock-h', '0px');
  document.body.classList.remove('playing-view', 'is-playing');
  if (S.tvOn) exitTV();
  bcSong();
}

async function openSong(song, rec) {
  stopPreview();
  resetEngine();
  S.song = song; S.source = null; S.syncMode = false;
  S.offset = rec && typeof rec.offset === 'number' ? rec.offset : 0;
  S.savedKey = rec && typeof rec.key === 'number' ? rec.key : null;
  S.keyTarget = 0;
  $('#songTitle').textContent = song.title;
  $('#songSub').textContent = [song.artist, song.album, song.duration ? fmt(song.duration) : ''].filter(Boolean).join(' · ');
  const art = $('#songArt');
  art.style.backgroundImage = song.art || song.thumb ? `url("${song.art || song.thumb}")` : '';
  art.textContent = song.art || song.thumb ? '' : '♪';
  $('#previewBtn').hidden = !song.preview;
  $('#changeMusicBtn').hidden = true;
  $('#sourcePick').hidden = false;
  $('#processing').hidden = true;
  $('#player').hidden = true;
  $('#syncBanner').hidden = true;
  $('#lyrics').classList.remove('syncing');
  updateOffsetLabel();
  showView('song');
  if (location.hash !== '#song') history.pushState({ song: true }, '', '#song');
  scrollTo(0, 0);
  refreshYT();

  if (rec && rec.lyric) {
    S.candidates = [rec.lyric]; S.lyricIdx = 0;
    applyLyric(rec.lyric);
    // look for alternatives quietly
    findLyrics(song).then((list) => {
      if (S.song !== song) return;
      const others = list.filter((x) => x.id !== rec.lyric.id);
      S.candidates = [rec.lyric, ...others];
      setLyricChip();
    }).catch(() => {});
  } else {
    loadLyrics();
  }

  if (S.pendingFile) { const f = S.pendingFile; S.pendingFile = null; loadFile(f); }
  else if (rec && rec.source) {
    if (rec.source.type === 'file' && rec.source.blob) loadFile(rec.source.blob, rec.source.name);
    else if (rec.source.type === 'youtube') loadYouTube(rec.source.videoId, rec.source.title);
  }
}

function showProcessing(title, note) {
  $('#sourcePick').hidden = true;
  $('#player').hidden = true;
  $('#processing').hidden = false;
  $('#procTitle').textContent = title;
  $('#procNote').textContent = note;
  $('#procBar').style.width = '0';
}

async function loadFile(file, name) {
  if (!S.song) return;
  const song = S.song;
  stopPreview();
  resetEngine();
  unlockAudio();
  showProcessing('Reading the song…', 'This happens on your device. Nothing is uploaded.');
  const eng = new FileEngine();
  try {
    let info;
    const t0 = performance.now();
    info = await eng.load(file, S.strength, (p) => {
      $('#procTitle').textContent = 'Removing vocals…';
      $('#procBar').style.width = Math.round(p * 100) + '%';
    });
    if (S.song !== song) { eng.destroy(); return; }
    S.source = { type: 'file', blob: file, name: name || file.name || 'song' };
    setEngine(eng);
    if (info.mono) toast("This file is mono, so the vocals can't be separated. Playing it as is.");
    else console.info('Vocal removal took', Math.round(performance.now() - t0), 'ms');
    refineLyricsForDuration(eng.duration);
    autoKey(eng);
    saveRecord().then(renderLibrary);
  } catch (e) {
    eng.destroy();
    if (S.song !== song) return;
    $('#processing').hidden = true;
    $('#sourcePick').hidden = false;
    toast(e.message || "Couldn't load that file.");
  }
}

async function loadYouTube(id, title) {
  if (!S.song) return;
  const song = S.song;
  stopPreview();
  resetEngine();
  showProcessing('Loading YouTube…', 'Make sure you picked a karaoke or instrumental version for no vocals.');
  $('#procBar').style.width = '60%';
  $('#player').hidden = false; // the YouTube player has to be on screen to start
  $('#ytBox').hidden = false;
  try {
    await yt.load(id);
    if (S.song !== song) return;
    S.source = { type: 'youtube', videoId: id, title: title || '' };
    setEngine(yt);
    yt.onerror = (err) => { toast(err.message); showSourcePicker(); };
    if (matchMedia('(pointer: coarse)').matches) toast('Tap ▶ on the video once to start, then sing along.');
    saveRecord().then(renderLibrary);
  } catch (e) {
    if (S.song !== song) return;
    $('#ytBox').hidden = true;
    $('#player').hidden = true;
    $('#processing').hidden = true;
    $('#sourcePick').hidden = false;
    toast(e.message);
  }
}

function setEngine(eng) {
  S.engine = eng;
  eng.onended = () => { updatePlayUI(); keepAwake(S.tvOn); bcTick(); };
  $('#processing').hidden = true;
  $('#sourcePick').hidden = true;
  $('#player').hidden = false;
  $('#dock').hidden = false;
  $('#changeMusicBtn').hidden = false;
  document.body.classList.add('playing-view');
  requestAnimationFrame(() => document.body.style.setProperty('--dock-h', $('#dock').offsetHeight + 'px'));
  const vk = $('#vocalKnob');
  vk.hidden = eng.kind === 'youtube'; // a YouTube video's vocals are whatever that upload has
  vk.classList.toggle('disabled', !eng.canVocal);
  $('#vocal').disabled = !eng.canVocal;
  if (eng.canVocal) eng.setVocal(S.vocal);
  updateVocalLabel();
  S.keyTarget = eng.kind === 'file' ? eng.key : 0;
  $('#keyKnob').classList.toggle('disabled', eng.kind !== 'file');
  setKeyStatus('');
  updateKeyLabel();
  LV.render();
  TV.setSong(S.song, S.lines, S.synced);
  bcSong(); bcTick();
  setMediaSession();
  updatePlayUI();
}

function showSourcePicker() {
  if (S.engine) S.engine.pause();
  resetEngine();
  $('#sourcePick').hidden = false;
  $('#player').hidden = true;
  $('#processing').hidden = true;
}

/* ------------------------------------------------------------------ key */
function updateKeyLabel() {
  $('#keyVal').textContent = keyText(S.keyTarget);
  const v = VOICES.find((x) => x.id === S.voice);
  $('#voiceName').textContent = v ? v.name : 'Any';
}
function setKeyStatus(t) { $('#keyStatus').textContent = t; }
function ytKeyHint() {
  toast("A YouTube video's sound can't be re-keyed. Find a lower-key karaoke version instead.", {
    label: 'Find one',
    fn: () => {
      showSourcePicker();
      S.ytKind = 'lower';
      $$('#ytKind button').forEach((x) => x.classList.toggle('on', x.dataset.kind === 'lower'));
      refreshYT();
      $('#ytCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
}
let keyTimer;
function requestKey(semi, msg) {
  const e = S.engine;
  if (!e) return;
  if (e.kind !== 'file') { ytKeyHint(); return; }
  S.keyTarget = clamp(Math.round(semi), -12, 12);
  updateKeyLabel();
  setKeyStatus(S.keyTarget === e.key ? '' : 'getting ready…');
  clearTimeout(keyTimer);
  keyTimer = setTimeout(() => applyKey(S.keyTarget, msg), msg ? 0 : 650);
}
async function applyKey(semi, msg) {
  const e = S.engine;
  if (!e || e.kind !== 'file') return;
  if (semi === e.key && !e.job) { setKeyStatus(''); return; }
  setKeyStatus(semi ? 'changing… 0%' : '');
  try {
    const ok = await e.setKey(semi, (p) => { if (S.engine === e && S.keyTarget === semi) setKeyStatus(`changing… ${Math.round(p * 100)}%`); });
    if (!ok || S.engine !== e) return;
    setKeyStatus('');
    S.savedKey = semi;
    saveSoon();
    if (msg) toast(msg);
    if (Math.abs(semi) > 7) toast('Big key changes can sound a little artificial. Within ±5 sounds most natural.');
  } catch (err) {
    if (S.engine !== e) return;
    S.keyTarget = 0; updateKeyLabel(); setKeyStatus('');
    toast("Couldn't change the key: " + err.message);
  }
}
/** After a file loads: restore this song's key, or fit it to the chosen voice. */
function autoKey(eng) {
  if (S.savedKey != null) {
    if (S.savedKey) requestKey(S.savedKey, `Key ${keyText(S.savedKey)}, as you had it last time.`);
    return;
  }
  const v = VOICES.find((x) => x.id === S.voice);
  if (!v) return;
  const fit = fitKey(eng.range, v);
  if (!fit) { toast(`Couldn't read this song's melody, so it's in the original key. Use Lower / Higher to suit your ${v.name.toLowerCase()} voice.`); return; }
  if (!fit.shift) { toast(`Already a good key for your ${v.name.toLowerCase()} voice${octaveText(fit.octaves)}.`); return; }
  requestKey(fit.shift, `Moved ${fit.shift < 0 ? 'down' : 'up'} ${Math.abs(fit.shift)} to suit your ${v.name.toLowerCase()} voice${octaveText(fit.octaves)}.`);
}
function renderVoices() {
  const e = S.engine;
  const range = e && e.kind === 'file' ? e.range : null;
  $('#melodyInfo').textContent = range
    ? `This song's melody sits around ${noteName(range.lo) === noteName(range.hi) ? noteName(range.lo) : noteName(range.lo) + '–' + noteName(range.hi)}. Pick your voice and the key moves to suit it.`
    : e && e.kind === 'youtube'
      ? "Key changes need a song file. A YouTube video's sound can't be changed, but your voice is saved for the songs you load as files."
      : 'Pick your voice. Every song file you load will be moved into your range.';
  for (const group of ['male', 'female']) {
    $(group === 'male' ? '#voicesMale' : '#voicesFemale').innerHTML = VOICES.filter((v) => v.group === group).map((v) => {
      const fit = fitKey(range, v);
      const hint = fit ? (fit.shift ? `${fit.shift < 0 ? '♭ down' : '♯ up'} ${Math.abs(fit.shift)}` : 'no change') : '';
      return `<button type="button" class="voice${S.voice === v.id ? ' on' : ''}" data-voice="${v.id}"><b>${v.name}</b><span>${noteName(v.lo)}–${noteName(v.hi)}</span>${hint ? `<em>${hint}</em>` : ''}</button>`;
    }).join('');
  }
}
function chooseVoice(id) {
  S.voice = id;
  store.set('voice', id);
  $('#voiceSheet').hidden = true;
  updateKeyLabel();
  const e = S.engine;
  const v = VOICES.find((x) => x.id === id);
  if (!v) {
    if (e && e.kind === 'file' && S.keyTarget) requestKey(0, 'Back to the original key.');
    else toast('Songs will stay in their original key.');
    return;
  }
  if (!e || e.kind !== 'file') { toast(`Saved: ${v.name}. Song files you load will be fitted to your range.`); return; }
  const fit = fitKey(e.range, v);
  if (!fit) { toast("Couldn't read this song's melody. Use Lower / Higher by ear."); return; }
  if (fit.shift === S.keyTarget) { toast(`Already in a good key for ${v.name.toLowerCase()}${octaveText(fit.octaves)}.`); return; }
  requestKey(fit.shift, fit.shift ? `Moved ${fit.shift < 0 ? 'down' : 'up'} ${Math.abs(fit.shift)} for ${v.name.toLowerCase()}${octaveText(fit.octaves)}.` : `Original key suits ${v.name.toLowerCase()}${octaveText(fit.octaves)}.`);
}

/* ------------------------------------------------------------------ transport */
function togglePlay() {
  const e = S.engine;
  if (!e) return;
  const wasPlaying = e.playing;
  if (wasPlaying) e.pause(); else { stopPreview(); e.play(); }
  setTimeout(updatePlayUI, 60);
  setTimeout(() => { updatePlayUI(); bcTick(); }, 400);
  if (!wasPlaying && e.kind === 'youtube') {
    setTimeout(() => { if (S.engine === e && !e.playing) toast('Tap ▶ on the video itself to start it. After that these buttons work.'); }, 1800);
  }
}
function seekBy(d) { const e = S.engine; if (e) { e.seek(e.currentTime + d); LV.idx = -2; TV.key = ''; setTimeout(bcTick, 80); } }
function updatePlayUI() {
  const p = !!(S.engine && S.engine.playing);
  document.body.classList.toggle('is-playing', p);
  $('#tvPlay').classList.toggle('on', p);
  $('#playBtn').setAttribute('aria-label', p ? 'Pause' : 'Play');
  if (p) keepAwake(true); else if (!S.tvOn) keepAwake(false);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
}
function updateVocalLabel() {
  const v = !S.engine || S.engine.canVocal ? Math.round(S.vocal * 100) : 0;
  $('#vocal').value = v;
  $('#vocal').style.setProperty('--v', v + '%');
  $('#vocalVal').textContent = !S.engine || S.engine.canVocal ? (v === 0 ? 'Off' : v >= 100 ? 'Full' : v + '%') : 'n/a';
}
function updateOffsetLabel() {
  const o = S.offset;
  $('#offVal').textContent = (o > 0 ? '+' : o < 0 ? '−' : '') + Math.abs(o).toFixed(2).replace(/0$/, '') + 's';
}
function setOffset(o, msg) {
  const before = S.offset;
  S.offset = Math.round(o * 100) / 100;
  updateOffsetLabel();
  LV.idx = -2; TV.key = '';
  bcTick();
  saveSoon();
  if (msg) toast(msg, { label: 'Undo', fn: () => setOffset(before) });
}
function setSyncMode(on) {
  S.syncMode = on;
  $('#syncBanner').hidden = !on;
  $('#lyrics').classList.toggle('syncing', on);
  $('#syncBtn').classList.toggle('on', on);
  if (on && S.tvOn) exitTV();
  if (on && !S.synced) { toast('These lyrics are not timed, so they cannot be synced.'); setSyncMode(false); }
}

function setMediaSession() {
  if (!('mediaSession' in navigator) || !S.song) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: S.song.title, artist: S.song.artist, album: 'Karaoke',
      artwork: S.song.art ? [{ src: S.song.art, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => { if (S.engine && !S.engine.playing) togglePlay(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (S.engine && S.engine.playing) togglePlay(); });
    navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
  } catch { /* partial support */ }
}

/* ------------------------------------------------------------------ main loop */
let lastUI = 0, lastTick = 0, seeking = false;
function frame(now) {
  requestAnimationFrame(frame);
  const e = S.engine;
  if (!e) return;
  const t = e.currentTime, dur = e.duration || (S.song && S.song.duration) || 0;
  const T = t - S.offset;
  if (!S.tvOn && !document.hidden) LV.update(T, t, dur);
  if (S.tvOn) TV.update(T, t, dur);
  if (now - lastUI > 120) {
    lastUI = now;
    if (!seeking) {
      const v = dur ? (t / dur) * 1000 : 0;
      $('#seek').value = v;
      $('#seek').style.setProperty('--v', v / 10 + '%');
      $('#tCur').textContent = fmt(t);
    }
    $('#tDur').textContent = fmt(dur);
    const p = e.playing;
    if (p !== document.body.classList.contains('is-playing')) updatePlayUI();
  }
  if (now - lastTick > 300) { lastTick = now; bcTick(); }
}

/* ------------------------------------------------------------------ receiver (TV window) */
function startReceiver() {
  document.body.classList.add('receiver');
  document.title = 'Karaoke · TV';
  TV.root.hidden = false;
  TV.setSong(null, [], false);
  let tick = null;
  bc && bc.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (m.type === 'song') { TV.setSong(m.song, m.lines, m.synced); $('#tvIdleMsg').textContent = 'Pick a song in the other window.'; }
    else if (m.type === 'tick') tick = m;
    else if (m.type === 'bye') { TV.setSong(null, [], false); tick = null; $('#tvIdleMsg').textContent = 'The controller window was closed.'; }
  });
  if (!bc) $('#tvIdleMsg').textContent = "This browser can't link windows. Use TV mode instead.";
  bcSend({ type: 'hello' });
  const loop = () => {
    requestAnimationFrame(loop);
    if (!tick || !TV.song) return;
    const t = Math.min(tick.dur || Infinity, tick.t + (tick.playing ? (Date.now() - tick.at) / 1000 : 0));
    TV.update(t - tick.offset, t, tick.dur);
  };
  requestAnimationFrame(loop);
  const goFull = () => fullscreen(true);
  $('#tvFull').onclick = goFull;
  TV.root.addEventListener('dblclick', goFull);
  TV.root.addEventListener('pointermove', tvPoke);
  TV.root.addEventListener('click', (e) => { if (!e.target.closest('button')) goFull(); tvPoke(); });
  tvPoke();
  keepAwake(true);
}

/* ------------------------------------------------------------------ wiring */
function initController() {
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); $('#q').blur(); doSearch($('#q').value); });

  $('#results').addEventListener('click', (e) => {
    const pv = e.target.closest('[data-preview]');
    if (pv) { e.stopPropagation(); togglePreview(lastResults[+pv.dataset.preview].preview, pv); return; }
    const li = e.target.closest('.res');
    if (li) pickResult(+li.dataset.i);
  });
  $('#results').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.res')) pickResult(+e.target.dataset.i); });

  $('#library').addEventListener('click', async (e) => {
    const recs = renderLibrary.recs || [];
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const rec = recs.find((r) => r.id === del.dataset.del);
      await DB.del(del.dataset.del).catch(() => {});
      renderLibrary();
      if (rec) toast(`Removed “${rec.song.title}”`, { label: 'Undo', fn: () => DB.put(rec).then(renderLibrary) });
      return;
    }
    const li = e.target.closest('.res');
    if (li && recs[+li.dataset.i]) openSong(recs[+li.dataset.i].song, recs[+li.dataset.i]);
  });

  $('#backBtn').onclick = () => { if (history.state && history.state.song) history.back(); else goHome(); };
  $('#brand').onclick = (e) => { e.preventDefault(); if (!$('#home').hidden) return; $('#backBtn').click(); };
  window.addEventListener('popstate', () => { if (location.hash !== '#song') goHome(); });

  $('#lyricsChip').onclick = () => {
    if (S.lyricState === 'loading') return;
    if (S.lyricState === 'error') { loadLyrics(); return; }
    if (S.candidates.length > 1) {
      S.lyricIdx = (S.lyricIdx + 1) % S.candidates.length;
      applyLyric(S.candidates[S.lyricIdx]);
      saveSoon();
      const c = S.lyric;
      toast(`Lyrics version ${S.lyricIdx + 1} of ${S.candidates.length}: ${c.artistName} · ${fmt(c.duration)}${c.syncedLyrics ? '' : ' (not timed)'}`);
      return;
    }
    if (!S.lines.length) {
      const q = prompt('Search lyrics by title and artist:', S.song ? `${S.song.title} ${S.song.artist}` : '');
      if (q) loadLyrics(q);
    }
  };
  $('#lyrics').addEventListener('submit', (e) => {
    if (e.target.id !== 'lyricSearch') return;
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) loadLyrics(q);
  });
  $('#previewBtn').onclick = (e) => togglePreview(S.song.preview, e.currentTarget);
  $('#changeMusicBtn').onclick = showSourcePicker;

  // file
  $('#fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) loadFile(f);
  });
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
    const f = [...e.dataTransfer.files].find((x) => /^audio\/|^video\/mp4/.test(x.type) || /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i.test(x.name));
    if (!f) { toast("That doesn't look like an audio file."); return; }
    handleLooseFile(f);
  });

  // youtube
  $('#ytKind').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.ytKind = b.dataset.kind;
    $$('#ytKind button').forEach((x) => x.classList.toggle('on', x === b));
    refreshYT();
  });
  $('#ytResults').addEventListener('click', (e) => {
    const li = e.target.closest('[data-yt]');
    if (li) loadYouTube(li.dataset.yt, li.dataset.title);
  });
  $('#ytForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = ytId($('#ytUrl').value);
    if (!id) { toast("That doesn't look like a YouTube link."); return; }
    loadYouTube(id);
  });
  $('#ytPaste').onclick = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      $('#ytUrl').value = txt;
      if (ytId(txt)) loadYouTube(ytId(txt)); else toast('No YouTube link on the clipboard. Copy one first.');
    } catch {
      $('#ytUrl').focus();
      toast('Long-press the box and choose Paste.');
    }
  };

  // dock
  $('#playBtn').onclick = togglePlay;
  $('#back10').onclick = () => seekBy(-10);
  $('#fwd10').onclick = () => seekBy(10);
  const seek = $('#seek');
  seek.addEventListener('input', () => {
    seeking = true;
    const dur = S.engine ? S.engine.duration : 0;
    seek.style.setProperty('--v', seek.value / 10 + '%');
    $('#tCur').textContent = fmt((seek.value / 1000) * dur);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    if (S.engine) { S.engine.seek((seek.value / 1000) * S.engine.duration); LV.idx = -2; TV.key = ''; setTimeout(bcTick, 80); }
  });
  $('#vocal').addEventListener('input', (e) => {
    S.vocal = e.target.value / 100;
    store.set('vocal', S.vocal);
    if (S.engine) S.engine.setVocal(S.vocal);
    updateVocalLabel();
  });
  $('#offMinus').onclick = () => setOffset(S.offset - 0.25);
  $('#offPlus').onclick = () => setOffset(S.offset + 0.25);
  $('#syncBtn').onclick = () => setSyncMode(!S.syncMode);
  $('#keyDown').onclick = () => requestKey(S.keyTarget - 1);
  $('#keyUp').onclick = () => requestKey(S.keyTarget + 1);
  $('#voiceBtn').onclick = () => { renderVoices(); $('#voiceSheet').hidden = false; };
  $('#voiceSheet').addEventListener('click', (e) => { const b = e.target.closest('[data-voice]'); if (b) chooseVoice(b.dataset.voice); });
  $('#voiceNone').onclick = () => chooseVoice('');
  $('#syncDone').onclick = () => setSyncMode(false);
  $('#lyrics').addEventListener('click', (e) => {
    const ly = e.target.closest('.ly[data-i]');
    if (!ly || !S.synced || !S.engine) return;
    const L = S.lines[+ly.dataset.i];
    if (S.syncMode) {
      setSyncMode(false);
      const o = S.engine.currentTime - L.t;
      setOffset(o, `Timing set: lyrics ${o >= 0 ? '+' : '−'}${Math.abs(o).toFixed(1)}s`);
    } else {
      S.engine.seek(Math.max(0, L.t + S.offset - 0.6));
      LV.idx = -2;
      if (!S.engine.playing) togglePlay();
      setTimeout(bcTick, 80);
    }
  });
  $('#tvModeBtn').onclick = enterTV;
  $('#tvWinBtn').onclick = () => {
    const w = window.open('./?tv', 'karaoke-tv', 'popup,width=1280,height=720');
    if (!w) { toast('Pop-up blocked. Allow pop-ups for this site, or use TV mode.'); return; }
    setTimeout(() => { bcSong(); bcTick(); }, 600);
    toast('Drag the new window onto the TV screen, then click it to go full-screen.');
  };

  // TV controls
  $('#tvExit').onclick = exitTV;
  $('#tvPlay').onclick = () => { togglePlay(); tvPoke(); };
  $('#tvBack').onclick = () => { seekBy(-10); tvPoke(); };
  $('#tvFwd').onclick = () => { seekBy(10); tvPoke(); };
  $('#tvFull').onclick = () => { fullscreen(!(document.fullscreenElement || document.webkitFullscreenElement)); tvPoke(); };
  TV.root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') tvPoke(); });
  TV.root.addEventListener('click', (e) => { if (!e.target.closest('button')) tvPoke(); });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if ((e.target.matches && e.target.matches('input:not([type=range]), textarea')) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!S.engine) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5); }
    else if (e.key === '[') setOffset(S.offset - 0.25);
    else if (e.key === ']') setOffset(S.offset + 0.25);
    else if (e.key === '-') requestKey(S.keyTarget - 1);
    else if (e.key === '=' || e.key === '+') requestKey(S.keyTarget + 1);
    else if (e.key === 't' || e.key === 'f') { if (S.tvOn) exitTV(); else enterTV(); }
    else if (e.key === 'Escape' && S.tvOn) exitTV();
    if (S.tvOn) tvPoke();
  });

  // sheets
  const openSheet = (id) => { $('#' + id).hidden = false; };
  $('#tvHelpBtn').onclick = () => openSheet('tvHelp');
  $('#settingsBtn').onclick = () => openSheet('settings');
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openSheet(o.dataset.open); return; }
    const sheet = e.target.closest('.sheet');
    if (sheet && (e.target === sheet || e.target.closest('[data-close]'))) sheet.hidden = true;
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.sheet').forEach((s) => { s.hidden = true; }); });
  $('#helpTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#helpTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('#tvHelp [data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  });
  if (/Macintosh/.test(navigator.userAgent) && !('ontouchend' in document)) $('#helpTabs [data-tab="mac"]').click();
  else if (!/iPhone|iPad|Macintosh/.test(navigator.userAgent)) $('#helpTabs [data-tab="other"]').click();

  // settings
  $$('#strengthSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === S.strength));
  $('#strengthSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.strength = +b.dataset.v; store.set('strength', S.strength);
    $$('#strengthSeg button').forEach((x) => x.classList.toggle('on', x === b));
    if (S.engine && S.engine.kind === 'file' && S.source) toast('Re-run vocal removal on this song now?', { label: 'Re-run', fn: () => { $('#settings').hidden = true; loadFile(S.source.blob, S.source.name); } });
  });
  $('#ytKey').value = store.get('ytKey', '');
  $('#keyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    store.set('ytKey', $('#ytKey').value.trim());
    toast($('#ytKey').value.trim() ? 'Saved. YouTube search is on.' : 'YouTube key removed.');
    $('#settings').hidden = true;
    refreshYT();
  });
  $('#clearLib').onclick = async () => {
    if (!confirm('Delete all saved songs from this device?')) return;
    await DB.clear().catch(() => {});
    renderLibrary();
    toast('My songs cleared.');
  };

  bc && bc.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'hello') { bcSong(); bcTick(); } });
  window.addEventListener('pagehide', () => bcSend({ type: 'bye' }));

  if (location.hash === '#song') history.replaceState(null, '', location.pathname + location.search);
  renderLibrary();
  requestAnimationFrame(frame);
  $('#q').focus({ preventScroll: true });
}

function pickResult(i) {
  const r = lastResults[i];
  if (!r) return;
  DB.get(r.id).then((rec) => openSong(r, rec), () => openSong(r));
}

function goHome() {
  stopPreview();
  resetEngine();
  setSyncMode(false);
  S.song = null; S.source = null;
  showView('home');
  renderLibrary();
}

/** A file dropped/opened before choosing a song: guess the song from its name. */
function handleLooseFile(f) {
  if (S.song && !$('#song').hidden) { loadFile(f); return; }
  const guess = f.name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s.\-_]+/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  S.pendingFile = f;
  $('#q').value = guess;
  doSearch(guess).then(() => toast('Pick the matching song: your file will load with it.'));
}

/* ------------------------------------------------------------------ go */
if (IS_RECEIVER) startReceiver();
else initController();

// test hooks
window.__karaoke = { S, fitKey, VOICES, parseLRC, timeLines, cleanTitle, mainArtist, ytId, scoreLyric, lineIndexAt, openSong, loadFile, TV };
})();
