// The video's interface sounds, synthesised rather than sampled: no third-
// party audio to license, and the same bytes on every machine. Each is short,
// quiet and band-limited — texture under the picture, not effects.

import type { SoundName } from "../../src/lib/assets.ts";

export const SAMPLE_RATE = 48_000;

/** A seeded PRNG, so the "noise" in a sound is identical on every run. */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

/** Scales so the loudest sample sits at `peakDb` dBFS. */
function normalise(samples: Float32Array, peakDb: number): Float32Array {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return samples;
  const gain = 10 ** (peakDb / 20) / peak;
  for (let i = 0; i < samples.length; i++) samples[i]! *= gain;
  return samples;
}

/**
 * Fades at both ends, so no sound starts or stops with a click of its own:
 * a quarter of a millisecond in — enough to avoid a step, short enough to
 * keep a tap's attack — and two out.
 */
function edges(samples: Float32Array): Float32Array {
  const fadeIn = Math.min(Math.round(0.00025 * SAMPLE_RATE), samples.length >> 1);
  const fadeOut = Math.min(Math.round(0.002 * SAMPLE_RATE), samples.length >> 1);
  for (let i = 0; i < fadeIn; i++) samples[i]! *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) samples[samples.length - 1 - i]! *= i / fadeOut;
  return samples;
}

/** A trackpad click: a very short high-passed noise tick over a small tone. */
function click(): Float32Array {
  const out = buffer(0.05);
  const rand = noise(7);
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const n = rand();
    const hp = n - prev; // first difference: a gentle high-pass
    prev = n;
    out[i] = hp * Math.exp(-t / 0.0012) * 0.6 + Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.004);
  }
  return normalise(edges(out), -6);
}

/** A key: like the click, softer and a little higher. */
function key(): Float32Array {
  const out = buffer(0.04);
  const rand = noise(11);
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const n = rand();
    const hp = n - prev;
    prev = n;
    out[i] = hp * Math.exp(-t / 0.001) * 0.5 + Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-t / 0.0025) * 0.6;
  }
  return normalise(edges(out), -11);
}

/** The pin landing: a round tone falling in pitch. */
function pop(): Float32Array {
  const out = buffer(0.2);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const freq = 420 + 780 * Math.exp(-t / 0.025);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / 0.045);
    out[i] = Math.sin(phase) * env;
  }
  return normalise(edges(out), -7);
}

/** Air moving: noise through a band-pass that sweeps up, swelling and fading. */
function whoosh(): Float32Array {
  const out = buffer(0.6);
  const rand = noise(23);
  // A two-pole resonant band-pass whose centre moves over the sound.
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const centre = 350 + 1500 * p * p;
    const w = (2 * Math.PI * centre) / SAMPLE_RATE;
    const r = 0.93;
    const x = rand();
    const y = x * (1 - r) + 2 * r * Math.cos(w) * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    out[i] = y * Math.sin(Math.PI * p) ** 2;
  }
  return normalise(edges(out), -13);
}

/** Research complete: two soft bell partials, the second a beat later. */
function chime(): Float32Array {
  const out = buffer(1.4);
  const tones: Array<[number, number, number]> = [
    [1318.5, 0, 1], // E6
    [1975.5, 0.09, 0.7], // B6
    [2637, 0.09, 0.18], // an overtone for shimmer
  ];
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (const [freq, delay, level] of tones) {
      const u = t - delay;
      if (u < 0) continue;
      v += Math.sin(2 * Math.PI * freq * u) * level * Math.min(1, u / 0.004) * Math.exp(-u / 0.38);
    }
    out[i] = v;
  }
  return normalise(edges(out), -9);
}

export const SOUNDS: Record<SoundName, () => Float32Array> = { click, key, pop, whoosh, chime };

/** 16-bit mono PCM in a WAV container. */
export function wavBytes(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
