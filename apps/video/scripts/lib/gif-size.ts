/**
 * The GIF's pixel size, as close to `wanted` wide as keeps both sides even —
 * the H.264 intermediate it is rendered through refuses odd dimensions — and
 * the render scale that produces it from a `width`×`height` composition.
 */
export function gifSize(
  wanted: number,
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const target = Math.min(wanted, width);
  for (let w = target - (target % 2); w >= 2; w -= 2) {
    const h = (height * w) / width;
    if (Number.isInteger(h) && h % 2 === 0) return { width: w, height: h, scale: w / width };
  }
  return { width, height, scale: 1 };
}
