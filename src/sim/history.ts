import type { FlightState } from "./flight.ts";

export interface FlightSnapshot {
  at: number;
  state: FlightState;
}

/** Keep a little more than 30s so Revert 30s can land on a stored frame. */
const KEEP_SECONDS = 45;

export function cloneFlight(state: FlightState): FlightState {
  const copy = structuredClone(state);
  copy.fx = [];
  return copy;
}

/**
 * One snapshot about every sim second. Time going backward (a revert, a retry)
 * drops the log so the next flight does not restore the previous one.
 */
export class FlightHistory {
  private shots: FlightSnapshot[] = [];
  private nextAt = 0;

  note(state: FlightState): void {
    if (state.time + 0.2 < this.nextAt) {
      this.shots = [];
      this.nextAt = 0;
    }
    if (state.time < this.nextAt) return;
    this.shots.push({ at: state.time, state: cloneFlight(state) });
    this.nextAt = state.time + 1;
    const cutoff = state.time - KEEP_SECONDS;
    this.shots = this.shots.filter((s) => s.at >= cutoff);
  }

  /** Newest snapshot at or before `now - seconds`. Null if the flight is too young. */
  revert(now: number, seconds: number): FlightState | null {
    const target = now - seconds;
    let pick: FlightSnapshot | null = null;
    for (const shot of this.shots) {
      if (shot.at <= target + 0.05) pick = shot;
    }
    if (!pick) return null;
    const restored = cloneFlight(pick.state);
    restored.fx = ["rewind"];
    return restored;
  }
}
