/* Vocal remover — runs off the main thread.
 *
 * Most commercial mixes put the lead vocal in the centre of the stereo
 * image. For every short slice of audio this works through the spectrum one
 * frequency at a time, finds the parts that are identical in the left and
 * right channels (centre-panned), and subtracts them, but only in the vocal
 * range. Bass and kick drum (below ~150 Hz) and anything panned left/right are
 * left alone.
 *
 * Output: an instrumental stem and a "guide vocal" stem (original minus
 * instrumental), so the player can blend the vocals back in with a slider.
 */
'use strict';

function makeFFT(N) {
  const levels = Math.round(Math.log2(N));
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0, x = i;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N);
    sin[i] = Math.sin((2 * Math.PI * i) / N);
  }
  return function fft(re, im, inverse) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k], s = sgn * sin[k];
          const a = j + half;
          const tr = re[a] * c - im[a] * s;
          const ti = re[a] * s + im[a] * c;
          re[a] = re[j] - tr; im[a] = im[j] - ti;
          re[j] += tr; im[j] += ti;
        }
      }
    }
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Is the file effectively mono (left == right)? Then centre removal would wipe everything. */
function isMono(L, R) {
  let side = 0, mid = 0;
  const stride = Math.max(1, Math.floor(L.length / 400000));
  for (let i = 0; i < L.length; i += stride) {
    const s = L[i] - R[i], m = L[i] + R[i];
    side += s * s; mid += m * m;
  }
  return mid === 0 || side / mid < 1e-4;
}

/**
 * @param {Float32Array} L left channel
 * @param {Float32Array} R right channel
 * @param {number} sr sample rate
 * @param {{strength?:number, lowCut?:number, highCut?:number}} opts
 * @returns {{instL:Float32Array, instR:Float32Array}} — L and R are overwritten with the vocal stem
 */
function separate(L, R, sr, opts, onProgress) {
  const strength = opts.strength == null ? 0.85 : opts.strength; // 0..1
  // Below this the centre is left alone (bass, kick). Gentle keeps more low end; Max digs deeper.
  const lowCut = opts.lowCut || 400 - 290 * strength; // 0.6 → 226 Hz, 0.85 → 154 Hz, 1 → 110 Hz
  const highCut = opts.highCut || 12000;
  // Threshold on L/R similarity: lower = more aggressive.
  const t0 = 0.86 - 0.36 * strength; // strength 1 → 0.50, strength 0.5 → 0.68
  const t1 = 0.985 - 0.05 * strength;

  const N = sr >= 32000 ? 4096 : 2048;
  const H = N / 4;
  const half = N / 2;
  const len = L.length;
  const fft = makeFFT(N);

  const win = new Float64Array(N);
  for (let n = 0; n < N; n++) win[n] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
  // sqrt-Hann analysis × sqrt-Hann synthesis = Hann; Hann at 75 % overlap sums to 2.
  const olaScale = 1 / (2 * N); // includes the 1/N of the inverse FFT

  const band = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    const f = (k * sr) / N;
    band[k] = smoothstep(lowCut * 0.65, lowCut, f) * (1 - smoothstep(highCut, highCut * 1.5, f)) * Math.min(1, strength * 1.15);
  }

  const re = new Float64Array(N), im = new Float64Array(N);
  const sim = new Float64Array(half + 1);
  const prevMask = new Float64Array(half + 1);
  const instL = new Float32Array(len), instR = new Float32Array(len);

  const frames = Math.ceil((len + N - H) / H);
  let lastReport = -1;

  for (let f = 0; f < frames; f++) {
    const p = f * H - (N - H);
    // Pack L + iR into one complex FFT.
    for (let n = 0; n < N; n++) {
      const i = p + n;
      if (i >= 0 && i < len) { re[n] = L[i] * win[n]; im[n] = R[i] * win[n]; }
      else { re[n] = 0; im[n] = 0; }
    }
    fft(re, im, false);

    // Unpack and measure how "centre" each bin is.
    for (let k = 0; k <= half; k++) {
      const nk = (N - k) & (N - 1);
      const zr = re[k], zi = im[k], cr = re[nk], ci = -im[nk];
      const lr = (zr + cr) / 2, li = (zi + ci) / 2;
      const rr = (zi - ci) / 2, ri = -(zr - cr) / 2;
      const cross = lr * rr + li * ri; // Re(L·conj(R))
      const pw = lr * lr + li * li + rr * rr + ri * ri;
      sim[k] = pw > 1e-12 ? (2 * cross) / pw : 0;
    }

    for (let k = 0; k <= half; k++) {
      const nk = (N - k) & (N - 1);
      const zr = re[k], zi = im[k], cr = re[nk], ci = -im[nk];
      const lr = (zr + cr) / 2, li = (zi + ci) / 2;
      const rr = (zi - ci) / 2, ri = -(zr - cr) / 2;

      const s = k > 0 && k < half ? 0.25 * sim[k - 1] + 0.5 * sim[k] + 0.25 * sim[k + 1] : sim[k];
      let m = band[k] * smoothstep(t0, t1, s);
      m = 0.65 * m + 0.35 * prevMask[k]; // light temporal smoothing → less "warble"
      prevMask[k] = m;

      // Centre estimate and removal.
      const cr2 = m * (lr + rr) / 2, ci2 = m * (li + ri) / 2;
      const olr = lr - cr2, oli = li - ci2, orr = rr - cr2, ori = ri - ci2;

      // Repack L' + iR' (Hermitian halves).
      re[k] = olr - ori; im[k] = oli + orr;
      if (k > 0 && k < half) { re[nk] = olr + ori; im[nk] = -oli + orr; }
    }

    fft(re, im, true);
    for (let n = 0; n < N; n++) {
      const i = p + n;
      if (i >= 0 && i < len) {
        const w = win[n] * olaScale;
        instL[i] += re[n] * w;
        instR[i] += im[n] * w;
      }
    }

    if (onProgress) {
      const pct = Math.floor((f / frames) * 100);
      if (pct !== lastReport) { lastReport = pct; onProgress(pct / 100); }
    }
  }

  // The vocal stem is whatever was removed.
  for (let i = 0; i < len; i++) { L[i] -= instL[i]; R[i] -= instR[i]; }
  return { instL, instR };
}


/**
 * Estimate the sung melody's range from the vocal stem (YIN pitch tracking on
 * loud frames). Returns MIDI note numbers {lo, mid, hi} or null.
 */
function melodyRange(VL, VR, sr) {
  const D = Math.max(1, Math.round(sr / 11025)), fs = sr / D;
  const n = Math.floor(VL.length / D);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < D; j++) s += VL[i * D + j] + VR[i * D + j];
    x[i] = s / (2 * D);
  }
  const W = 512, hop = 441, minLag = Math.floor(fs / 1000), maxLag = Math.ceil(fs / 75);
  const frames = [];
  for (let p = 0; p + W + maxLag < n; p += hop) {
    let e = 0;
    for (let i = 0; i < W; i++) e += x[p + i] * x[p + i];
    frames.push({ p, e });
  }
  if (frames.length < 20) return null;
  const energies = frames.map((f) => f.e).sort((a, b) => a - b);
  const gate = energies[Math.floor(energies.length * 0.9)] * 0.15;
  const d = new Float64Array(maxLag + 1);
  const notes = [];
  for (const f of frames) {
    if (f.e < gate) continue;
    const p = f.p;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const v = x[p + i] - x[p + i + tau]; s += v * v; }
      d[tau] = s;
    }
    let run = 0, tau = -1;
    for (let t = 1; t <= maxLag; t++) {
      run += d[t];
      const c = run > 0 ? (d[t] * t) / run : 1;
      if (t >= minLag && c < 0.15) {
        // walk to the local minimum
        let best = t, bc = c, rr = run;
        for (let u = t + 1; u <= maxLag; u++) {
          rr += d[u];
          const cu = (d[u] * u) / rr;
          if (cu < bc) { bc = cu; best = u; } else break;
        }
        tau = best;
        break;
      }
    }
    if (tau > 0) {
      const hz = fs / tau;
      if (hz >= 75 && hz <= 1000) notes.push(69 + 12 * Math.log2(hz / 440));
    }
  }
  if (notes.length < 30) return null;
  notes.sort((a, b) => a - b);
  const q = (v) => notes[Math.floor(v * (notes.length - 1))];
  return { lo: q(0.1), mid: q(0.5), hi: q(0.9), n: notes.length };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { L, R, sampleRate, opts } = e.data;
    try {
      if (isMono(L, R)) {
        self.postMessage({ type: 'mono' });
        return;
      }
      const t = Date.now();
      const { instL, instR } = separate(L, R, sampleRate, opts || {}, (p) => self.postMessage({ type: 'progress', p }));
      let range = null;
      try { range = melodyRange(L, R, sampleRate); } catch (e) { /* optional */ }
      self.postMessage(
        { type: 'done', instL, instR, vocL: L, vocR: R, range, ms: Date.now() - t },
        [instL.buffer, instR.buffer, L.buffer, R.buffer]
      );
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  };
}

if (typeof module !== 'undefined') module.exports = { separate, isMono, makeFFT, melodyRange };
