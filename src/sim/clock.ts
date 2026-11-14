/** One wake never replays a long gap. Background and pause drop the gap instead. */
export const MAX_WAKE_SECONDS = 0.25;

export function consumeWake(
  acc: number,
  gapSeconds: number,
  warp: number,
  pausedOrHidden: boolean,
): { acc: number; sim: number } {
  if (pausedOrHidden) return { acc: 0, sim: 0 };
  const wake = gapSeconds > 0 ? Math.min(MAX_WAKE_SECONDS, gapSeconds) : 0;
  const rate = warp > 0 ? warp : 1;
  let left = acc + wake * rate;
  const guard = Math.min(90, Math.ceil(8 * rate));
  let sim = 0;
  let n = 0;
  const step = 1 / 60;
  while (left >= step && n < guard) {
    left -= step;
    sim += step;
    n += 1;
  }
  return { acc: left, sim };
}
