import { describe, expect, it } from "vitest";
import scenario from "../../scenarios/mexican-place-des-arts.ts";
import { SOUND_NAMES } from "../../src/lib/assets.ts";
import { choreographyFor } from "../../src/lib/choreography.ts";
import { SAMPLE_RATE, SOUNDS, wavBytes } from "./sfx.ts";

const dbfs = (v: number) => 20 * Math.log10(v);

describe("the interface sounds", () => {
  for (const name of SOUND_NAMES) {
    describe(name, () => {
      const samples = SOUNDS[name]();
      const peak = Math.max(...Array.from(samples, Math.abs));

      it("is short, and never clips", () => {
        expect(samples.length / SAMPLE_RATE).toBeLessThanOrEqual(1.5);
        expect(peak).toBeLessThan(1);
      });

      it("sits well below full scale", () => {
        expect(dbfs(peak)).toBeLessThanOrEqual(-5.9);
        expect(dbfs(peak)).toBeGreaterThan(-20);
      });

      it("starts and ends in silence, so it cannot pop", () => {
        expect(Math.abs(samples[0]!)).toBeLessThan(1e-6);
        expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1e-6);
      });

      it("is the same on every run", () => {
        expect(SOUNDS[name]()).toEqual(samples);
      });
    });
  }

  it("the chime rings on, the click is over almost at once", () => {
    const energyAfter = (samples: Float32Array, seconds: number) => {
      let sum = 0;
      for (let i = Math.round(seconds * SAMPLE_RATE); i < samples.length; i++) sum += samples[i]! ** 2;
      return sum;
    };
    expect(energyAfter(SOUNDS.click(), 0.02)).toBeLessThan(0.01 * energyAfter(SOUNDS.click(), 0));
    expect(energyAfter(SOUNDS.chime(), 0.3)).toBeGreaterThan(0.2 * energyAfter(SOUNDS.chime(), 0));
  });
});

describe("wavBytes", () => {
  it("writes a 16-bit mono PCM WAV of the right length", () => {
    const bytes = wavBytes(new Float32Array([0, 0.5, -0.5, 1]));
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(50, true)).toBe(32767);
  });
});

describe("sound cues", () => {
  const { chor } = choreographyFor(scenario);

  it("clicks on every click the pointer makes", () => {
    const clicks = chor.cues.filter((c) => c.sound === "click").map((c) => c.frame);
    for (const click of chor.clicks) {
      expect(clicks.some((f) => Math.abs(f - click.frame) <= 2)).toBe(true);
    }
  });

  it("taps a key for every character typed", () => {
    expect(chor.cues.filter((c) => c.sound === "key")).toHaveLength(scenario.search.request.length);
  });

  it("keeps every cue inside the walkthrough", () => {
    for (const cue of chor.cues) {
      expect(cue.frame).toBeGreaterThanOrEqual(0);
      expect(cue.frame).toBeLessThan(chor.totalFrames);
      expect(cue.volume).toBeGreaterThan(0);
      expect(cue.volume).toBeLessThanOrEqual(1);
    }
  });
});
