import type { FlightState } from "./flight.ts";
import { PLANET } from "./math.ts";
import { MOON_SCALE } from "./world.ts";

/** TA:Earth timewarpHeight. Measured meters, before the home-planet length scale. */
export const EARTH_TIMEWARP_HEIGHT = 25_000;
/** TA:Moon timewarpHeight. Measured meters, before the same length scale. */
export const MOON_TIMEWARP_HEIGHT = 5_000;

/**
 * 青芽星 and 月芽 already convert original lengths with MOON_SCALE.length
 * (R_青芽 / R_Earth). timewarpHeight is a length from the same planet files,
 * so it uses that existing scale. This is not a new warp formula.
 */
export const PLANET_WARP_HEIGHT = EARTH_TIMEWARP_HEIGHT * MOON_SCALE.length;
export const MOON_WARP_HEIGHT = MOON_TIMEWARP_HEIGHT * MOON_SCALE.length;

/**
 * 原版倍速倍率表，以及难度类 maxPhysicsTimewarpIndex 和数组的对应关系，都没有还原。
 * 未还原，未套用。这里只保留游戏里已经在走的 1、2、5，不补 10、50、100 这类没测到的档。
 */
export const WARP_LADDER_NOTE = "未还原，未套用" as const;
export const WARP_RATES = [1, 2, 5] as const;

export type WarpRate = (typeof WARP_RATES)[number];

export function stepWarp(current: number, dir: 1 | -1): WarpRate {
  const rates: readonly number[] = WARP_RATES;
  let index = rates.indexOf(current);
  if (index < 0) index = 0;
  const next = Math.min(rates.length - 1, Math.max(0, index + dir));
  return WARP_RATES[next] ?? 1;
}

/** UI-28. The center of the screen shows the live multiplier, for example ×5. */
export function warpMark(rate: number): string {
  return `×${rate}`;
}

export function warpCenterText(rate: number): string | null {
  if (!(rate > 1)) return null;
  return warpMark(rate);
}

export type WarpBlock = "engines" | "height" | "falling" | "low-fast" | "hold";

export function warpHeightFloor(body: FlightState["body"]): number {
  return body === "moon" ? MOON_WARP_HEIGHT : PLANET_WARP_HEIGHT;
}

/** Why a requested rate above 1× cannot be used. Null means the rate may run. */
export function warpBlock(state: FlightState, want: number): WarpBlock | null {
  if (!(want > 1)) return null;
  if (state.phase !== "flight" && state.phase !== "rail") return "hold";
  if (state.vessel.throttle > 0.03) return "engines";
  if (state.altitude < warpHeightFloor(state.body)) return "height";
  if (state.body === "planet" && state.altitude < PLANET.atmHeight + 400 && state.verticalSpeed < -8) return "falling";
  if (state.altitude < 2_500 && state.speed > 45) return "low-fast";
  return null;
}

export function warpRefuseText(block: WarpBlock, state: FlightState): string {
  if (block === "height") {
    const floor = Math.round(warpHeightFloor(state.body));
    const where = state.body === "moon" ? "月芽" : "青芽星";
    return `${where}要到 ${floor} 米以上才能加快时间`;
  }
  if (block === "falling") return "正在掉进大气，先不要加快";
  if (block === "low-fast") return "离地面太近，先不要加快";
  if (block === "hold") return "现在不能加快时间";
  return "发动机关掉以后才能加快时间";
}

export function appliedWarp(state: FlightState, want: number): number {
  return warpBlock(state, want) ? 1 : want;
}

/**
 * How many 1/60 s steps one frame may take.
 * The cap is ours, so a fast pass cannot swallow the remaining air or the
 * ground clearance in a single frame. It is not an original timewarp constant.
 * One step is the floor, because the integrator already runs at 1/60 s.
 */
export function warpStepBudget(rate: number, altitude: number, speed: number): number {
  const clockGuard = Math.min(90, Math.ceil(8 * Math.max(rate, 1)));
  if (!(altitude > 0) || !(speed > 1)) return clockGuard;
  const clearance = Math.max(4, altitude * 0.2);
  const perStep = speed / 60;
  const byGround = Math.max(1, Math.floor(clearance / perStep));
  return Math.min(clockGuard, byGround);
}
