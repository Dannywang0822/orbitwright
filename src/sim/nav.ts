import { PLANET } from "./math.ts";
import { PARTS } from "./parts.ts";
import { stepFlight, type FlightState } from "./flight.ts";
import { MOON, PREDICT_DT, moonAt, predictApproach, type Approach } from "./world.ts";

export interface NavCue {
  id: "ascent" | "burn" | "coast" | "brake" | "fall" | "touch" | "aim" | "climb" | "raise" | "return" | "wait";
  text: string;
  /** Point the nose here. Null means keep the current prograde of the planet. */
  aim: "prograde" | "up" | "retro-moon" | "moon" | "out" | "tangent" | null;
  throttle: number;
  /** Seconds to hold this cue before reading the line again. */
  hold: number;
  /** Draw a mark at this fraction of the throttle pad. The player still moves the pad. */
  mark: number | null;
  /** The coast from the current speed already meets the moon closely. Release the throttle. */
  green: boolean;
  /** Turn buttons move the nose more slowly, so a late release stays near the marker. */
  fine?: boolean;
}

function relMoon(state: FlightState) {
  const moon = moonAt(state.time);
  const rx = state.vessel.pos.x - moon.pos.x;
  const ry = state.vessel.pos.y - moon.pos.y;
  const vx = state.vessel.vel.x - moon.vel.x;
  const vy = state.vessel.vel.y - moon.vel.y;
  const d = Math.max(1, Math.hypot(rx, ry));
  const v2 = vx * vx + vy * vy;
  const h = rx * vy - ry * vx;
  const eps = v2 / 2 - MOON.mu / d;
  const ex = (vy * h) / MOON.mu - rx / d;
  const ey = (-vx * h) / MOON.mu - ry / d;
  const e = Math.hypot(ex, ey);
  const bound = eps < 0 && e < 0.995;
  const a = bound ? -MOON.mu / (2 * eps) : 0;
  return {
    d,
    rs: Math.sqrt(v2),
    bound,
    peri: bound ? a * (1 - e) : 1e9,
    radial: (vx * rx + vy * ry) / d,
  };
}

function turnWord(angle: number, target: number, band = 0.2): "" | "按住向右" | "按住向左" {
  const err = wrapAngle(target - angle);
  if (err > band) return "按住向右";
  if (err < -band) return "按住向左";
  return "";
}

let passKey = "";
let passCache: Approach | null = null;
let seenAt = -1;
let transferDone = false;
let rounded = false;
/** Once the brake has dropped to the half mark, do not light full thrust again. */
let softOnly = false;
/** Fixed once a sideways aim starts, so a near-stop cannot flip it 180°. */
let roundSign = 0;
let marginAt = -1;
let marginOk = false;
/** Set after a moon landing, so the next burn is the return rather than another transfer. */
let beenOnMoon = false;
/** The parking orbit has been up high, so the transfer burn waits for the next low point. */
let sawApo = false;
/** Once the low point arrives, keep burning even as the ship climbs. */
let transferArmed = false;

function resetGuidance(state: FlightState): void {
  if (state.time + 0.2 < seenAt) {
    transferDone = false;
    rounded = false;
    softOnly = false;
    roundSign = 0;
    marginAt = -1;
    marginOk = false;
    beenOnMoon = false;
    sawApo = false;
    transferArmed = false;
    passCache = null;
    passKey = "";
  }
  seenAt = state.time;
}

/** Future coast of the current velocity. Same step the "预计" number uses. */
function coastPass(state: FlightState): Approach {
  const dist = lenToMoon(state);
  const far = dist > MOON.soi * 2;
  const bucket = transferDone ? 10 : 0.5;
  const keyTime = Math.floor(state.time / bucket);
  const key = String(keyTime);
  if (passCache && key === passKey) return passCache;
  passKey = key;
  const step = transferDone ? 2 : far ? 1 : PREDICT_DT;
  passCache = predictApproach(state.vessel.pos, state.vessel.vel, state.time, far ? 16_000 : 1_200, step);
  return passCache;
}

/**
 * True when one more second of the white-line burn is still a slow pass.
 * The release sentence is only shown while this is true, so a 0.7s late finger
 * is still inside the pass. Checked twice a second.
 */
function hasMargin(state: FlightState): boolean {
  if (state.time - marginAt < 0.5 && marginAt >= 0) return marginOk;
  marginAt = state.time;
  const s = structuredClone(state);
  s.fx = [];
  s.vessel.angle = Math.atan2(s.vessel.vel.x, s.vessel.vel.y);
  s.vessel.angVel = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) stepFlight(s, { throttle: 0.1, steer: 0, stage: false, chute: false }, dt);
  const later = predictApproach(s.vessel.pos, s.vessel.vel, s.time, 16_000, 1);
  const alt = later.closest - MOON.radius;
  marginOk =
    alt > 4_000 &&
    later.closest < MOON.soi &&
    later.relSpeed < 800 &&
    later.minPlanetBefore > PLANET.radius + 2_000;
  return marginOk;
}

function slowPass(pass: Approach, time: number): boolean {
  const alt = pass.closest - MOON.radius;
  return (
    alt > 5_000 &&
    pass.closest < MOON.soi &&
    pass.relSpeed < 800 &&
    pass.at > time + 30 &&
    pass.at < time + pass.horizon - 300 &&
    pass.minPlanetBefore > PLANET.radius + 2_000
  );
}

/** A pass that already meets the moon inside the sphere, so the periapsis raise can wait. */
function gentlePass(state: FlightState, pass: Approach): boolean {
  return slowPass(pass, state.time);
}

function cue(partial: Omit<NavCue, "hold" | "mark" | "green"> & Partial<NavCue>): NavCue {
  return { hold: 0.2, mark: null, green: false, ...partial };
}

/**
 * When the sentence says 慢慢, a held turn button spins at this fixed rate.
 * It does not steer toward the marker. Letting go is still the player's action.
 * 0.22 rad/s times a 0.7s late release is about 9 degrees.
 */
export const SLOW_TURN_RATE = 0.22;

export function turnCapFor(shown: NavCue): number | undefined {
  return shown.text.includes("慢慢") ? SLOW_TURN_RATE : undefined;
}

/** Full-throttle acceleration of the ship that is flying, m/s². */
function fullAccel(state: FlightState): number {
  return Math.max(6, state.twr * PLANET.g);
}

/**
 * Brake the moon-relative speed down to `settle` without reversing.
 * Full thrust is only the sentence while one second of it — the 0.7s finger
 * plus the aim wandering — still leaves speed above `settle`. The rest is the
 * half mark. A 0.7s late release on half is a few m/s, not a reversed burn.
 */
function brakeThrottle(state: FlightState, rs: number, settle = 20): NavCue {
  const accel = fullAccel(state);
  const tail = accel * 1.05;
  if (!softOnly && rs > settle + tail) {
    const sec = Math.max(1, Math.ceil((rs - (settle + tail)) / accel));
    return cue({
      id: "brake",
      text: `慢慢推满减速，大约还要 ${sec} 秒`,
      aim: "retro-moon",
      throttle: 1,
      fine: true,
    });
  }
  if (rs > settle) {
    softOnly = true;
    return cue({
      id: "brake",
      text: "慢慢把油门收到一半",
      aim: "retro-moon",
      throttle: 0.5,
      mark: 0.5,
      fine: true,
    });
  }
  softOnly = true;
  return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
}

function moonAngleOf(state: FlightState): number {
  const moon = moonAt(state.time);
  return Math.atan2(moon.pos.x - state.vessel.pos.x, moon.pos.y - state.vessel.pos.y);
}

function retroAngle(state: FlightState): number {
  const moon = moonAt(state.time);
  return Math.atan2(-(state.vessel.vel.x - moon.vel.x), -(state.vessel.vel.y - moon.vel.y));
}

/** Sideways, matching whatever way the ship is already drifting around the moon. */
function tangentAngle(state: FlightState): number {
  const moon = moonAt(state.time);
  const rx = state.vessel.pos.x - moon.pos.x;
  const ry = state.vessel.pos.y - moon.pos.y;
  const vx = state.vessel.vel.x - moon.vel.x;
  const vy = state.vessel.vel.y - moon.vel.y;
  if (roundSign === 0) {
    const speed = Math.hypot(vx, vy);
    const h = rx * vy - ry * vx;
    // Below 20 m/s the sign of the angular momentum chatters and the aim flips.
    roundSign = speed < 20 ? -1 : h >= 0 ? 1 : -1;
  }
  return Math.atan2(-ry * roundSign, rx * roundSign);
}

function landingCue(state: FlightState, q: { rs: number; radial: number }): NavCue {
  const coast = cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: "out", throttle: 0, green: true, hold: 0.3 });
  const moon = moonAt(state.time);
  const up = Math.atan2(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
  const turn = turnWord(state.vessel.angle, up, 0.3);
  if (state.altitude < 4_000 && state.altitude > 250 && q.rs > 9) {
    const retro = turnWord(state.vessel.angle, retroAngle(state), 0.35);
    if (retro) return cue({ id: "brake", text: `慢慢关掉油门，${retro}，慢慢掉头`, aim: "retro-moon", throttle: 0, fine: true });
    const text = q.rs > 16 ? "慢慢把油门收到一半，朝上减速" : "慢慢把油门推到白线，朝上减速";
    return cue({ id: "brake", text, aim: "retro-moon", throttle: q.rs > 16 ? 0.5 : 0.06, mark: q.rs > 16 ? 0.5 : 0.06, fine: true });
  }
  if (state.altitude > 2_500) {
    if (turn) return cue({ id: "touch", text: `慢慢关掉油门，${turn}，把头朝上`, aim: "out", throttle: 0, fine: true });
    return coast;
  }
  if (q.radial < -6 && state.altitude < 1_800) {
    const text = turn ? `慢慢${turn}，把油门收到一半，朝上减速` : "慢慢把油门收到一半，朝上减速";
    return cue({ id: "touch", text, aim: "out", throttle: 0.5, mark: 0.5, fine: true, hold: 0.15 });
  }
  if (q.radial < -2.5 && state.altitude < 900) {
    const text = turn ? `慢慢${turn}，把油门推到白线，朝上减速` : "慢慢把油门推到白线，朝上减速";
    return cue({ id: "touch", text, aim: "out", throttle: 0.06, mark: 0.06, fine: true, hold: 0.1 });
  }
  if (turn && state.altitude < 4_000) return cue({ id: "touch", text: `慢慢关掉油门，${turn}，把头朝上`, aim: "out", throttle: 0, fine: true });
  return coast;
}

/** Burn against the moon's orbit so the path home dips into the air. */
function returnHomeCue(state: FlightState): NavCue {
  const moon = moonAt(state.time);
  if (state.altitude < 1_500) {
    const up = Math.atan2(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
    const turn = turnWord(state.vessel.angle, up, 0.3);
    if (turn) return cue({ id: "climb", text: `慢慢关掉油门，${turn}，把头朝上`, aim: "out", throttle: 0, fine: true });
    return cue({
      id: "climb",
      text: "慢慢回到白线，先离开月面",
      aim: "out",
      throttle: 0.1,
      mark: 0.1,
      fine: true,
    });
  }
  const aim = Math.atan2(-moon.vel.x, -moon.vel.y);
  const turn = turnWord(state.vessel.angle, aim, 0.35);
  if (turn) {
    return cue({ id: "climb", text: `慢慢${turn}，把头转向回家`, aim: null, throttle: 0, fine: true });
  }
  const peri = state.orbit.periapsisAlt ?? 1e9;
  if (peri > 4_000 && state.fuelMass > 2) {
    return cue({
      id: "climb",
      text: "慢慢回到白线，飞回家",
      aim: null,
      throttle: 0.1,
      mark: 0.1,
      fine: true,
      hold: 0.3,
    });
  }
  return cue({ id: "coast", text: "关掉油门，可以加快", aim: null, throttle: 0, green: true, hold: 0.4 });
}

function lowerStageDry(state: FlightState): boolean {
  const flying = state.phase === "flight" || (state.phase === "landed" && state.landedOn === "moon");
  if (!flying || state.fuelMass <= 1) return false;
  const seps = state.vessel.parts.filter((p) => PARTS[p.kind].separator);
  if (seps.length === 0) return false;
  const line = Math.max(...seps.map((p) => p.y));
  let below = 0;
  for (const p of state.vessel.parts) if (p.y > line) below += p.fuel;
  return below < 1;
}

export function navCue(state: FlightState, warp = 1): NavCue {
  resetGuidance(state);
  // A finished moon orbit must stay on coast even after it drifts past the
  // sphere line. The transfer burn out here is what throws the ship away.
  if (rounded && state.phase === "flight") {
    return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
  }
  if (lowerStageDry(state)) {
    return cue({ id: "ascent", text: "按下分离", aim: null, throttle: 0, hold: 0.3 });
  }
  const peri = state.orbit.periapsisAlt ?? -1e9;
  const apo = state.orbit.apoapsisAlt ?? -1e9;
  if (state.phase === "landed" && state.landedOn === "moon") {
    beenOnMoon = true;
    return returnHomeCue(state);
  }
  if (beenOnMoon && state.phase === "flight" && state.body === "moon") {
    return returnHomeCue(state);
  }
  if (beenOnMoon && state.phase === "flight" && state.body === "planet" && lenToMoon(state) > MOON.soi) {
    const back = state.orbit.periapsisAlt ?? 1e9;
    if (back > 4_000) {
      const retro = Math.atan2(-state.vessel.vel.x, -state.vessel.vel.y);
      const turn = turnWord(state.vessel.angle, retro, 0.25);
      if (turn) return cue({ id: "return", text: `慢慢关掉油门，${turn}，慢慢掉头`, aim: null, throttle: 0, fine: true });
      return cue({ id: "return", text: "慢慢推满，把近点降到大气里", aim: null, throttle: 1, fine: true });
    }
    if (state.altitude > 2_500 && state.verticalSpeed < 0) {
      return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
    return cue({ id: "fall", text: "可以开伞", aim: null, throttle: 0, green: true, hold: 0.3 });
  }
  if (state.body === "moon" || lenToMoon(state) < MOON.soi + 300) {
    const q = relMoon(state);
    const alt = q.d - MOON.radius;
    if (beenOnMoon && state.phase === "flight") {
      if (alt < 30_000 || q.rs < 110) {
        const moon = moonAt(state.time);
        const out = Math.atan2(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
        const turn = turnWord(state.vessel.angle, out, 0.25);
        if (turn) return cue({ id: "climb", text: `慢慢关掉油门，${turn}，把头朝外`, aim: "out", throttle: 0, fine: true });
        return cue({ id: "climb", text: "慢慢推油门离开", aim: "out", throttle: 1, hold: 0.3, fine: true });
      }
      return cue({ id: "coast", text: "关掉油门，可以加快", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
    if (alt < 8_000) return landingCue(state, q);
    if (q.rs < 8) {
      return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
    if (alt > 40_000) {
      if (alt > 250_000 && q.radial > 2) {
        const turn = turnWord(state.vessel.angle, retroAngle(state), 0.35);
        if (turn) return cue({ id: "brake", text: `慢慢关掉油门，${turn}，慢慢掉头`, aim: "retro-moon", throttle: 0, fine: true });
        return brakeThrottle(state, q.rs, 12);
      }
      if (q.rs > 55) {
        const turn = turnWord(state.vessel.angle, retroAngle(state), 0.35);
        if (turn) return cue({ id: "brake", text: `慢慢关掉油门，${turn}，慢慢掉头`, aim: "retro-moon", throttle: 0, fine: true });
        return brakeThrottle(state, q.rs, 24);
      }
      if (q.rs < 12 && q.radial > -4) {
        const turn = turnWord(state.vessel.angle, moonAngleOf(state), 0.35);
        if (turn) return cue({ id: "burn", text: `慢慢${turn}，对准月芽`, aim: "moon", throttle: 0, fine: true });
        return cue({
          id: "burn",
          text: "慢慢把油门推到白线，飞向月芽",
          aim: "moon",
          throttle: 0.06,
          mark: 0.06,
          fine: true,
        });
      }
      return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
    const settle = Math.max(6, Math.sqrt((2 * MOON.mu) / q.d) * 0.35);
    if (q.rs > settle + 4) {
      const turn = turnWord(state.vessel.angle, retroAngle(state), 0.35);
      if (turn) {
        return cue({
          id: "brake",
          text: `慢慢关掉油门，${turn}，慢慢掉头`,
          aim: "retro-moon",
          throttle: 0,
          fine: true,
        });
      }
      return brakeThrottle(state, q.rs, settle);
    }
    return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
  }
  if (transferDone && state.phase === "flight" && state.body === "planet") {
    const dist = lenToMoon(state);
    if (dist < MOON.soi * 1.6 && dist > MOON.soi && warp > 1.1) {
      return cue({ id: "coast", text: "点 ◀◀ 回到 1×", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
    if (dist < MOON.soi * 1.5 && dist > MOON.soi && state.fuelMass > 20) {
      const q = relMoon(state);
      if (q.radial > 2 && q.rs > 12) {
        const turn = turnWord(state.vessel.angle, retroAngle(state), 0.35);
        if (turn) return cue({ id: "brake", text: `慢慢关掉油门，${turn}，慢慢掉头`, aim: "retro-moon", throttle: 0, fine: true });
        return brakeThrottle(state, q.rs, 8);
      }
      const turn = turnWord(state.vessel.angle, moonAngleOf(state), 0.35);
      if (turn) return cue({ id: "burn", text: `慢慢${turn}，对准月芽`, aim: "moon", throttle: 0, fine: true });
      if (q.rs < 30) {
        return cue({
          id: "burn",
          text: "慢慢把油门推到白线，飞向月芽",
          aim: "moon",
          throttle: 0.06,
          mark: 0.06,
          fine: true,
        });
      }
      return cue({ id: "fall", text: "慢慢关掉油门，保持滑行", aim: null, throttle: 0, green: true, hold: 0.4 });
    }
  }
  if (
    state.phase === "flight" &&
    state.body === "planet" &&
    state.altitude > 20_000 &&
    (state.orbit.apoapsisAlt ?? 0) > 30_000 &&
    (state.orbit.periapsisAlt ?? 0) < 7_000 &&
    lenToMoon(state) > MOON.soi + 1_500 &&
    !transferDone
  ) {
    if (!gentlePass(state, coastPass(state))) {
      return { id: "raise", text: "顺向加速抬高近点", aim: "prograde", throttle: 1, hold: 0.3, mark: null, green: false };
    }
  }
  if (peri > 8_000 && apo > 8_000 && state.phase === "flight") {
    const dist = lenToMoon(state);
    if (state.altitude > 18_000) sawApo = true;
    const atPeri = sawApo && state.altitude < 12_000 && state.verticalSpeed > 10 && state.verticalSpeed < 50;
    if (atPeri) transferArmed = true;
    if (!transferDone && !transferArmed) {
      const prograde = Math.atan2(state.vessel.vel.x, state.vessel.vel.y);
      const turn = turnWord(state.vessel.angle, prograde, 0.3);
      return cue({
        id: "coast",
        text: turn ? `慢慢${turn}，滑到近点再推` : "慢慢关掉油门，滑到近点再推",
        aim: "prograde",
        throttle: 0,
        green: true,
        hold: 0.4,
        fine: true,
      });
    }
    if (transferDone && dist > MOON.soi * 3) {
      return cue({
        id: "coast",
        text: "关掉油门，可以加快",
        aim: "prograde",
        throttle: 0,
        green: true,
        hold: 0.4,
      });
    }
    const pass = coastPass(state);
    if (transferDone && pass.closest > MOON.soi * 2) transferDone = false;
    if (slowPass(pass, state.time) && hasMargin(state)) transferDone = true;
    if (transferDone) {
      const near = dist < MOON.soi * 1.6;
      return cue({
        id: "coast",
        text: near ? "点 ◀◀ 回到 1×" : "关掉油门，可以加快",
        aim: "prograde",
        throttle: 0,
        green: true,
        hold: 0.4,
      });
    }
    const prograde = Math.atan2(state.vessel.vel.x, state.vessel.vel.y);
    const turn = turnWord(state.vessel.angle, prograde, 0.25);
    if (turn) {
      return cue({
        id: "burn",
        text: `${turn}，慢慢回到白线`,
        aim: "prograde",
        throttle: 0.1,
        hold: 0.3,
        mark: 0.1,
        fine: true,
      });
    }
    return cue({
      id: "burn",
      text: "慢慢回到 1×，油门推到白线",
      aim: "prograde",
      throttle: 0.1,
      hold: 0.3,
      mark: 0.1,
      fine: true,
    });
  }
  const climbing = state.altitude > 250 ? Math.min(1.42, ((state.altitude - 250) / 4000) * 1.42) : 0;
  const prograde = Math.atan2(state.vessel.vel.x, state.vessel.vel.y);
  const nearApo = apo > 12_000 && state.altitude > 10_000 && state.verticalSpeed < 18 && state.altitude > apo - 3_500;
  if (nearApo && peri < 8_000) {
    const turn = turnWord(state.vessel.angle, prograde);
    const text = turn ? `${turn}，顺向补油` : "顺向补油";
    return { id: "ascent", text, aim: "prograde", throttle: 1, hold: 0.35, mark: null, green: false };
  }
  if (apo > 16_000 && peri < 8_000) {
    const turn = turnWord(state.vessel.angle, prograde);
    return { id: "ascent", text: turn ? `${turn}，关掉油门` : "关掉油门", aim: "prograde", throttle: 0, hold: 0.4, mark: null, green: false };
  }
  const turn = turnWord(state.vessel.angle, climbing);
  const text = turn ? `${turn}，油门推满` : "油门推满";
  return { id: "ascent", text, aim: "prograde", throttle: 1, hold: 0.35, mark: null, green: false };
}

function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  return ((a + Math.PI) % t + t) % t - Math.PI;
}

function lenToMoon(state: FlightState): number {
  const moon = moonAt(state.time);
  return Math.hypot(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
}

export function navAimAngle(state: FlightState, cue: NavCue): number {
  if (cue.aim === "out") {
    const moon = moonAt(state.time);
    return Math.atan2(state.vessel.pos.x - moon.pos.x, state.vessel.pos.y - moon.pos.y);
  }
  if (cue.aim === "retro-moon") {
    const moon = moonAt(state.time);
    return Math.atan2(-(state.vessel.vel.x - moon.vel.x), -(state.vessel.vel.y - moon.vel.y));
  }
  if (cue.aim === "moon") {
    const moon = moonAt(state.time);
    return Math.atan2(moon.pos.x - state.vessel.pos.x, moon.pos.y - state.vessel.pos.y);
  }
  if (cue.aim === "tangent") return tangentAngle(state);
  if (cue.aim === "prograde") return Math.atan2(state.vessel.vel.x, state.vessel.vel.y);
  return state.vessel.angle;
}
