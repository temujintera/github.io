/* Key changer: shifts pitch without changing tempo, so lyrics stay in time.
 *
 * Phase-vocoder time-stretch (with peak phase-locking for a cleaner sound)
 * followed by resampling back to the original length. Left and right get
 * the same phase rotation, which keeps the stereo image intact.
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
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
  return function fft(re, im, inverse) {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k], s = sgn * sin[k], a = j + half;
          const tr = re[a] * c - im[a] * s, ti = re[a] * s + im[a] * c;
          re[a] = re[j] - tr; im[a] = im[j] - ti; re[j] += tr; im[j] += ti;
        }
      }
    }
  };
}

const TWO_PI = 2 * Math.PI;
const wrap = (x) => x - TWO_PI * Math.round(x / TWO_PI);

/**
 * Pitch-shift a stereo pair by `semitones`, keeping the length.
 * @returns {[Float32Array, Float32Array]}
 */
function pitchShift(L, R, sr, semitones, onProgress) {
  const len = L.length;
  if (!semitones) return [Float32Array.from(L), Float32Array.from(R)];
  const N = sr >= 32000 ? 4096 : 2048;
  const half = N / 2;
  const Ha = N / 4;
  const Hs = Math.round(Ha * Math.pow(2, semitones / 12));
  const r = Hs / Ha; // exact ratio actually applied
  const fft = makeFFT(N);

  const win = new Float64Array(N);
  for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos((TWO_PI * n) / N);

  const frames = Math.ceil((len + N - Ha) / Ha) + 1;
  const pad = N * 2;
  const outLen = Math.ceil(frames * Hs + pad * 2);
  const sL = new Float32Array(outLen), sR = new Float32Array(outLen), wsum = new Float32Array(outLen);

  const re = new Float64Array(N), im = new Float64Array(N);
  const xlr = new Float64Array(half + 1), xli = new Float64Array(half + 1), xrr = new Float64Array(half + 1), xri = new Float64Array(half + 1);
  const mag = new Float64Array(half + 1), phase = new Float64Array(half + 1);
  const prevPhase = new Float64Array(half + 1), outPhase = new Float64Array(half + 1), prevOut = new Float64Array(half + 1);
  const peakOf = new Int32Array(half + 1);
  const omega = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) omega[k] = (TWO_PI * k) / N;

  // Frame m: input starts at pa, output (stretched timeline, aligned so input time t ↔ t·r) at ps.
  const c0 = (Ha - N / 2) * r - N / 2;
  let lastReport = -1;

  for (let m = 0; m < frames; m++) {
    const pa = m * Ha - (N - Ha);
    for (let n = 0; n < N; n++) {
      const i = pa + n;
      if (i >= 0 && i < len) { re[n] = L[i] * win[n]; im[n] = R[i] * win[n]; } else { re[n] = 0; im[n] = 0; }
    }
    fft(re, im, false);

    for (let k = 0; k <= half; k++) {
      const nk = (N - k) & (N - 1);
      const zr = re[k], zi = im[k], cr = re[nk], ci = -im[nk];
      xlr[k] = (zr + cr) / 2; xli[k] = (zi + ci) / 2;
      xrr[k] = (zi - ci) / 2; xri[k] = -(zr - cr) / 2;
      const mr = xlr[k] + xrr[k], mi = xli[k] + xri[k];
      mag[k] = mr * mr + mi * mi;
      phase[k] = Math.atan2(mi, mr);
    }

    if (m === 0) {
      for (let k = 0; k <= half; k++) outPhase[k] = phase[k];
    } else {
      // Peaks of the (mid) spectrum; every other bin follows its nearest peak.
      let lastPeak = -1, any = false;
      for (let k = 0; k <= half; k++) peakOf[k] = -1;
      for (let k = 2; k <= half - 2; k++) {
        const v = mag[k];
        if (v > mag[k - 1] && v > mag[k - 2] && v >= mag[k + 1] && v >= mag[k + 2] && v > 1e-12) {
          const dphi = wrap(phase[k] - prevPhase[k] - omega[k] * Ha);
          outPhase[k] = prevOut[k] + (omega[k] + dphi / Ha) * Hs;
          if (lastPeak >= 0) {
            // boundary at the lowest bin between the two peaks
            let b = lastPeak, low = Infinity;
            for (let j = lastPeak + 1; j < k; j++) if (mag[j] < low) { low = mag[j]; b = j; }
            for (let j = lastPeak + 1; j < k; j++) peakOf[j] = j < b ? lastPeak : k;
          } else {
            for (let j = 0; j < k; j++) peakOf[j] = k;
          }
          peakOf[k] = k;
          lastPeak = k; any = true;
        }
      }
      if (any) {
        for (let j = lastPeak + 1; j <= half; j++) peakOf[j] = lastPeak;
        for (let k = 0; k <= half; k++) {
          const p = peakOf[k];
          if (p !== k) outPhase[k] = outPhase[p] + (phase[k] - phase[p]);
        }
      } else {
        for (let k = 0; k <= half; k++) {
          const dphi = wrap(phase[k] - prevPhase[k] - omega[k] * Ha);
          outPhase[k] = prevOut[k] + (omega[k] + dphi / Ha) * Hs;
        }
      }
    }

    for (let k = 0; k <= half; k++) {
      prevPhase[k] = phase[k];
      prevOut[k] = outPhase[k] = wrap(outPhase[k]);
      const th = outPhase[k] - phase[k], c = Math.cos(th), s = Math.sin(th);
      const lr = xlr[k] * c - xli[k] * s, li = xlr[k] * s + xli[k] * c;
      const rr = xrr[k] * c - xri[k] * s, ri = xrr[k] * s + xri[k] * c;
      const nk = (N - k) & (N - 1);
      re[k] = lr - ri; im[k] = li + rr;
      if (k > 0 && k < half) { re[nk] = lr + ri; im[nk] = -li + rr; }
    }
    fft(re, im, true);

    const ps = Math.round(m * Hs + c0) + pad;
    for (let n = 0; n < N; n++) {
      const i = ps + n;
      if (i < 0 || i >= outLen) continue;
      const w = win[n];
      sL[i] += (re[n] / N) * w;
      sR[i] += (im[n] / N) * w;
      wsum[i] += w * w;
    }

    if (onProgress) {
      const pct = Math.floor((m / frames) * 100);
      if (pct !== lastReport) { lastReport = pct; onProgress(pct / 100); }
    }
  }

  // Normalise the overlap-add (Hann² sum), guarding the thin edges.
  const full = (1.5 * N) / (4 * Hs);
  const floor = full * 0.25;
  for (let i = 0; i < outLen; i++) {
    const w = wsum[i] > floor ? wsum[i] : full;
    sL[i] /= w; sR[i] /= w;
  }

  // Resample the stretched signal back to the original length (Catmull-Rom).
  const oL = new Float32Array(len), oR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = i * r + pad;
    const j = Math.floor(x), f = x - j;
    if (j < 1 || j + 2 >= outLen) continue;
    const f2 = f * f, f3 = f2 * f;
    const a = -0.5 * f3 + f2 - 0.5 * f, b = 1.5 * f3 - 2.5 * f2 + 1, c = -1.5 * f3 + 2 * f2 + 0.5 * f, d = 0.5 * f3 - 0.5 * f2;
    oL[i] = a * sL[j - 1] + b * sL[j] + c * sL[j + 1] + d * sL[j + 2];
    oR[i] = a * sR[j - 1] + b * sR[j] + c * sR[j + 1] + d * sR[j + 2];
  }
  return [oL, oR];
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (e) => {
    const { id, L, R, sampleRate, semitones } = e.data;
    try {
      const [oL, oR] = pitchShift(L, R, sampleRate, semitones, (p) => self.postMessage({ type: 'progress', id, p }));
      self.postMessage({ type: 'done', id, L: oL, R: oR }, [oL.buffer, oR.buffer]);
    } catch (err) {
      self.postMessage({ type: 'error', id, message: String((err && err.message) || err) });
    }
  };
}

if (typeof module !== 'undefined') module.exports = { pitchShift };
