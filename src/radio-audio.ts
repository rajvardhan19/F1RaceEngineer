/** True when a rendered clip contains real sound. Some GPU/precision combinations return silence. */
export function audible(audio: Float32Array) {
  let energy = 0;
  for (const v of audio) energy += v * v;
  return audio.length > 0 && Math.sqrt(energy / audio.length) > 0.005;
}
