import { EARTH_HEAT_SPEED_MULTIPLIER } from "./confirmed.ts";
import { HEAT_BALANCE } from "./estimates.ts";
import { PLANET, airDensity } from "./math.ts";
import { heatToleranceOf, PARTS, type PartKind } from "./parts.ts";
import type { FlightState, SimPart } from "./flight.ts";

export { EARTH_HEAT_SPEED_MULTIPLIER };

/**
 * 加热开始的速度没有从原版里测到，只测到了倍率。
 * 这个门槛是平衡估计，非原版实测公式。
 * 稀薄空气按现有密度少加一些热。
 */
export const BALANCE_HEAT_SPEED = HEAT_BALANCE.speed;

/**
 * 海平面、两倍门槛速度时，每秒增加的耐热单位。
 * 平衡估计，非原版实测公式。原版加热积分没有还原。
 */
export const BALANCE_HEAT_RATE = HEAT_BALANCE.rate;

export function heatSpeedGate(): number {
  return BALANCE_HEAT_SPEED * EARTH_HEAT_SPEED_MULTIPLIER;
}

export interface TempBar {
  id: string;
  name: string;
  heat: number;
  tolerance: number;
}

/** Up to three bars, hottest first. Cold parts are omitted. UI-08: 120×20 each, with the part name. */
export function temperatureBars(parts: SimPart[]): TempBar[] {
  return [...parts]
    .filter((p) => (p.heat ?? 0) > 0.02)
    .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0))
    .slice(0, 3)
    .map((p) => ({
      id: p.id,
      name: PARTS[p.kind].name,
      heat: p.heat ?? 0,
      tolerance: heatToleranceOf(p.kind),
    }));
}

export const TEMP_BAR = { w: 120, h: 20, max: 3 };

/** Markup for the flight HUD. At most three bars, only parts that have started heating. */
export function temperatureMarkup(parts: SimPart[]): string {
  return temperatureBars(parts)
    .map((bar) => {
      const pct = Math.max(0, Math.min(100, Math.round((bar.heat / bar.tolerance) * 100)));
      return `<span class="sfs-temp-bar" data-part="${bar.id}" style="width:${TEMP_BAR.w}px;height:${TEMP_BAR.h}px"><em>${bar.name}</em><i style="width:${pct}%"></i></span>`;
    })
    .join("");
}

/**
 * Raise heat only in the home planet's air, and only above the gate.
 * The Moon has no atmosphere, so a ship on the Moon does not heat.
 * Difficulty fields minHeatVelocityMultiplier and heatVelocityMultiplier were
 * not mapped, and the drag constants 0.02 / 0.01 have no known meaning.
 * Those numbers are not used here.
 * Parts hotter than their measured heatTolerance are removed.
 * Pod loss ends the flight.
 */
export function applyHeat(state: FlightState, dt: number): void {
  if (state.phase !== "flight" || state.body === "moon") return;
  if (state.altitude > PLANET.atmHeight) return;
  const gate = heatSpeedGate();
  if (state.speed <= gate) return;
  const rho = airDensity(state.altitude);
  if (rho <= 0) return;
  const excess = (state.speed - gate) / gate;
  const rise = excess * (rho / PLANET.rho0) * BALANCE_HEAT_RATE * dt;
  for (const p of state.vessel.parts) p.heat = (p.heat ?? 0) + rise;
  const kept: SimPart[] = [];
  let pod = false;
  for (const p of state.vessel.parts) {
    if ((p.heat ?? 0) > heatToleranceOf(p.kind as PartKind)) continue;
    kept.push(p);
    if (PARTS[p.kind].pod) pod = true;
  }
  if (kept.length === state.vessel.parts.length) return;
  state.vessel.parts = kept;
  state.vessel.hasCom = false;
  state.fx.push("heat");
  if (!pod) {
    state.phase = "crashed";
    state.fx.push("crash");
  }
}
