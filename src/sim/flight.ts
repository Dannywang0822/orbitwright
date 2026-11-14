import { fuelTanks, nozzleBlock, splitLowestStage } from "./assembly.ts";
import { applyHeat } from "./heat.ts";
import { MOON, accelAt, moonAt } from "./world.ts";
import {
  CELL_H,
  CELL_W,
  G0,
  PLANET,
  add,
  airDensity,
  angleOf,
  clamp,
  dot,
  len,
  mul,
  norm,
  nose,
  rotCw,
  sub,
  wrapPi,
  type Vec,
} from "./math.ts";
import { PARTS, type PartKind, type Placed } from "./parts.ts";
import { analyzeOrbit, stableOrbit, type OrbitSnapshot } from "./orbit.ts";
import { warpBlock } from "./warp.ts";

export interface SimPart {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
  fuel: number;
  localX: number;
  localY: number;
  halfW: number;
  halfH: number;
  /** False only after the player switches this engine off. Missing means on. */
  engineEnabled?: boolean;
  /** Heat units. Compared with heatToleranceOf. Missing means 0. */
  heat?: number;
}

export interface Vessel {
  parts: SimPart[];
  pos: Vec;
  vel: Vec;
  angle: number;
  angVel: number;
  throttle: number;
  com: Vec;
  mass: number;
  inertia: number;
  hasCom: boolean;
  engineOut: Record<string, number>;
}

export interface Debris {
  vessel: Vessel;
  asleep: boolean;
}

export type Phase = "rail" | "flight" | "landed" | "crashed";

/** Measured Parachute.prefab: maxDeployHeight 2500 m, maxDeployVelocity 250 m/s, both difficulties. */
export const CHUTE_MAX_ALT = 2_500;
export const CHUTE_MAX_SPEED = 250;
/** Measured drag keys for deploy states 0 / 1 / 2. State meaning (closed / reefed / full) is inferred. */
export const CHUTE_DRAG = [0, 15, 250] as const;
/**
 * The force formula was not recovered. Full-open drag is scaled so it matches
 * the 720 that already landed on 青芽星. Balance estimate, not a measured force.
 */
export const CHUTE_DRAG_SCALE = 720 / 250;

export interface FlightState {
  easy: boolean;
  sas: boolean;
  blueprint: Placed[];
  vessel: Vessel;
  debris: Debris[];
  phase: Phase;
  chuteOpen: boolean;
  /** 0 closed, 1 reefed, 2 full. A test that only sets chuteOpen still gets full drag. */
  chuteStage: 0 | 1 | 2;
  time: number;
  altitude: number;
  speed: number;
  verticalSpeed: number;
  maxAlt: number;
  reachedHigh: boolean;
  orbit: OrbitSnapshot;
  orbitHold: number;
  fuelMass: number;
  fuelCap: number;
  twr: number;
  deltaV: number;
  padY: number;
  fx: string[];
  safeSpeed: number;
  /** Which surface the ship is sitting on, if phase is landed. */
  landedOn: "planet" | "moon" | null;
  /** Nearest body used for the altitude reading. Planet unless inside the moon's sphere. */
  body: "planet" | "moon";
}

export interface FlightInput {
  throttle: number;
  steer: number;
  stage: boolean;
  chute: boolean;
  /** Limits how fast a held turn button can spin the ship. The button still only turns the way the player holds. */
  turnCap?: number;
}

export interface ActionResult {
  ok: boolean;
  reason: string;
}

const SUB = 2;

function toSim(p: Placed): SimPart {
  const d = PARTS[p.kind];
  return {
    id: p.id,
    kind: p.kind,
    x: p.x,
    y: p.y,
    fuel: d.fuel,
    localX: (p.x + d.w / 2) * CELL_W,
    localY: -((p.y + d.h / 2) * CELL_H),
    halfW: (d.w * CELL_W) / 2,
    halfH: (d.h * CELL_H) / 2,
    engineEnabled: true,
    heat: 0,
  };
}

function emptyVessel(parts: SimPart[]): Vessel {
  return {
    parts,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    angle: 0,
    angVel: 0,
    throttle: 0,
    com: { x: 0, y: 0 },
    mass: 1,
    inertia: 1,
    hasCom: false,
    engineOut: {},
  };
}

function partMass(p: SimPart): number {
  return PARTS[p.kind].dry + p.fuel;
}

function applyMass(v: Vessel, preserve: boolean): void {
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (const p of v.parts) {
    const m = partMass(p);
    mass += m;
    sx += m * p.localX;
    sy += m * p.localY;
  }
  mass = Math.max(mass, 1);
  const com = { x: sx / mass, y: sy / mass };
  if (preserve && v.hasCom) {
    const shift = rotCw(sub(com, v.com), v.angle);
    v.pos = add(v.pos, shift);
  }
  let inertia = 0;
  for (const p of v.parts) {
    const m = partMass(p);
    const dx = p.localX - com.x;
    const dy = p.localY - com.y;
    inertia += m * (dx * dx + dy * dy);
    inertia += (m * (p.halfW * p.halfW + p.halfH * p.halfH)) / 3;
  }
  v.com = com;
  v.mass = mass;
  v.inertia = Math.max(inertia, 8);
  v.hasCom = true;
}

export function partWorld(v: Vessel, p: SimPart): Vec {
  const rel = rotCw({ x: p.localX - v.com.x, y: p.localY - v.com.y }, v.angle);
  return add(v.pos, rel);
}

export function nozzleWorld(v: Vessel, p: SimPart): Vec {
  const rel = rotCw({ x: p.localX - v.com.x, y: p.localY - v.com.y - p.halfH }, v.angle);
  return add(v.pos, rel);
}

function planetClearance(v: Vessel): number {
  let best = Infinity;
  for (const p of v.parts) {
    const pts = [
      { x: -p.halfW, y: -p.halfH },
      { x: p.halfW, y: -p.halfH },
      { x: 0, y: -p.halfH },
    ];
    for (const c of pts) {
      const body = { x: p.localX - v.com.x + c.x, y: p.localY - v.com.y + c.y };
      const world = add(v.pos, rotCw(body, v.angle));
      best = Math.min(best, len(world) - PLANET.radius);
    }
  }
  return best;
}

function lowestClearance(v: Vessel): number {
  return planetClearance(v);
}

function moonClearance(v: Vessel, time: number): number {
  const moon = moonAt(time);
  let best = Infinity;
  for (const p of v.parts) {
    const pts = [
      { x: -p.halfW, y: -p.halfH },
      { x: p.halfW, y: -p.halfH },
      { x: 0, y: -p.halfH },
    ];
    for (const c of pts) {
      const body = { x: p.localX - v.com.x + c.x, y: p.localY - v.com.y + c.y };
      const world = add(v.pos, rotCw(body, v.angle));
      best = Math.min(best, len(sub(world, moon.pos)) - MOON.radius);
    }
  }
  return best;
}

function frontalWidth(parts: SimPart[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.localX - p.halfW);
    maxX = Math.max(maxX, p.localX + p.halfW);
  }
  return Math.max(1, maxX - minX);
}

function thrustFactor(easy: boolean): number {
  return easy ? 1.12 : 1;
}

function landingLimit(state: FlightState): number {
  let v = state.easy ? 6 : 5;
  if (state.chuteOpen) v += 1.5;
  if (state.vessel.parts.some((p) => PARTS[p.kind].legs)) v += 2;
  return v;
}

function sync(state: FlightState): void {
  const v = state.vessel;
  applyMass(v, false);
  const moon = moonAt(state.time);
  const toMoon = sub(v.pos, moon.pos);
  const moonDist = len(toMoon);
  const onMoon = moonDist < MOON.soi;
  state.body = onMoon ? "moon" : "planet";
  if (onMoon) {
    const outward = mul(toMoon, 1 / Math.max(moonDist, 1));
    const rel = sub(v.vel, moon.vel);
    state.altitude = moonClearance(v, state.time);
    state.speed = len(rel);
    state.verticalSpeed = dot(rel, outward);
  } else {
    state.altitude = planetClearance(v);
    state.speed = len(v.vel);
    const outward = norm(v.pos);
    state.verticalSpeed = dot(v.vel, outward);
  }
  state.orbit = analyzeOrbit(v.pos, v.vel);
  let fuel = 0;
  let cap = 0;
  for (const p of v.parts) {
    const d = PARTS[p.kind];
    if (d.fuel > 0 || p.fuel > 0) {
      fuel += p.fuel;
      cap += d.fuel;
    }
  }
  state.fuelMass = fuel;
  state.fuelCap = cap;
  const factor = thrustFactor(state.easy);
  let thrust = 0;
  let flow = 0;
  const tanks = new Set<string>();
  for (const e of v.parts) {
    if (!PARTS[e.kind].engine) continue;
    if (e.engineEnabled === false) continue;
    if (nozzleBlock(v.parts, e) !== "clear") continue;
    const d = PARTS[e.kind];
    const t = d.thrust * factor;
    thrust += t;
    if (d.isp > 0) flow += t / (d.isp * G0);
    for (const tank of fuelTanks(v.parts, e)) tanks.add(tank.id);
  }
  let burnable = 0;
  for (const id of tanks) {
    const p = v.parts.find((x) => x.id === id);
    if (p) burnable += p.fuel;
  }
  state.twr = v.mass > 0 ? thrust / (v.mass * PLANET.g) : 0;
  const mDry = v.mass - burnable;
  state.deltaV = flow > 0 && burnable > 0 && mDry > 1 ? (thrust / flow) * Math.log(v.mass / mDry) : 0;
  state.safeSpeed = landingLimit(state);
  if (state.body === "planet" && state.altitude > state.maxAlt) state.maxAlt = state.altitude;
  if (state.body === "planet" && state.altitude >= 1200) state.reachedHigh = true;
}

function seat(v: Vessel): void {
  for (let i = 0; i < 8; i++) {
    const gap = lowestClearance(v);
    if (gap >= 0.3) break;
    v.pos = add(v.pos, mul(norm(v.pos), 0.35 - gap));
  }
  v.vel = { x: 0, y: 0 };
  v.angVel = 0;
}

function seatOnMoon(v: Vessel, time: number): void {
  const moon = moonAt(time);
  const outward = norm(sub(v.pos, moon.pos));
  const gap = moonClearance(v, time);
  v.pos = add(v.pos, mul(outward, 0.4 - gap));
  v.vel = { ...moon.vel };
  v.angVel = 0;
}

function consumeThrust(v: Vessel, steer: number, dt: number, easy: boolean): { fx: number; fy: number; torque: number } {
  const factor = thrustFactor(easy);
  const gimbal = clamp(steer, -1, 1) * 0.18;
  let fx = 0;
  let fy = 0;
  let torque = 0;
  v.engineOut = {};
  const engines = v.parts.filter((p) => PARTS[p.kind].engine && p.engineEnabled !== false && nozzleBlock(v.parts, p) === "clear");
  engines.sort((a, b) => b.y - a.y);
  for (const e of engines) {
    const d = PARTS[e.kind];
    const full = d.thrust * factor * v.throttle;
    if (full <= 0 || d.isp <= 0) {
      v.engineOut[e.id] = 0;
      continue;
    }
    const need = (full / (d.isp * G0)) * dt;
    const got = drawFuel(v.parts, e, need);
    const frac = need > 1e-9 ? got / need : 0;
    const F = full * frac;
    v.engineOut[e.id] = frac * v.throttle;
    const fbx = -Math.sin(gimbal) * F;
    const fby = Math.cos(gimbal) * F;
    const rel = { x: e.localX - v.com.x, y: e.localY - v.com.y };
    torque += rel.y * fbx - rel.x * fby;
    const fw = rotCw({ x: fbx, y: fby }, v.angle);
    fx += fw.x;
    fy += fw.y;
  }
  return { fx, fy, torque };
}

function drawFuel(parts: SimPart[], engine: SimPart, need: number): number {
  let got = 0;
  for (const t of fuelTanks(parts, engine)) {
    const live = parts.find((p) => p.id === t.id);
    if (!live) continue;
    const take = Math.min(live.fuel, need - got);
    if (take <= 0) continue;
    live.fuel -= take;
    got += take;
    if (got >= need - 1e-9) break;
  }
  return got;
}

function aeroArea(v: Vessel, chuteStage: number, easy: boolean): number {
  const spd = len(v.vel);
  let aoa = 0;
  if (spd > 2) {
    const n = nose(v.angle);
    const hat = mul(v.vel, 1 / spd);
    aoa = Math.acos(clamp(dot(n, hat), -1, 1));
  }
  const w = frontalWidth(v.parts);
  let cd = 0.42 * w * 1.15 * (1 + 0.9 * Math.sin(aoa) ** 2);
  if (chuteStage > 0) {
    const key = chuteStage >= 2 ? 2 : 1;
    let count = 0;
    for (const p of v.parts) if (PARTS[p.kind].chute) count += 1;
    cd += CHUTE_DRAG[key] * CHUTE_DRAG_SCALE * Math.max(1, count) * (easy ? 1.08 : 1);
  }
  return cd;
}

function integrateVessel(
  v: Vessel,
  steer: number,
  dt: number,
  easy: boolean,
  sas: boolean,
  chuteStage: number,
  phase: Phase,
  padY: number,
  simTime: number,
  turnCap = 1.2,
): void {
  applyMass(v, true);
  const thrust = consumeThrust(v, steer, dt, easy);
  const g = accelAt(v.pos, simTime);
  let fx = g.x * v.mass + thrust.fx;
  let fy = g.y * v.mass + thrust.fy;
  const alt = len(v.pos) - PLANET.radius;
  const rho = airDensity(alt) * (easy ? 0.8 : 1);
  const spd = len(v.vel);
  if (rho > 0 && spd > 0.05) {
    let fd = 0.5 * rho * aeroArea(v, chuteStage, easy) * spd * spd;
    const maxF = (spd / dt) * v.mass * 0.92;
    if (fd > maxF) fd = maxF;
    fx += (-v.vel.x / spd) * fd;
    fy += (-v.vel.y / spd) * fd;
  }
  const I = v.inertia;
  const steerN = clamp(steer, -1, 1);
  const tMag = easy ? I * 2.15 : 12_000 + I * 0.42;
  const torque = thrust.torque + steerN * tMag;
  v.vel.x += (fx / v.mass) * dt;
  v.vel.y += (fy / v.mass) * dt;
  v.pos.x += v.vel.x * dt;
  v.pos.y += v.vel.y * dt;
  v.angVel += (torque / I) * dt;
  const cap = clamp(turnCap, 0.05, 1.2);
  v.angVel = clamp(v.angVel, -cap, cap);
  const holding = sas && Math.abs(steerN) < 0.12;
  const damp = holding ? (easy ? 4.8 : 3.1) : 0.35;
  v.angVel *= Math.exp(-damp * dt);
  v.angle = wrapPi(v.angle + v.angVel * dt);
  if (phase === "rail") {
    v.pos.x = 0;
    v.vel.x = 0;
    v.angle = 0;
    v.angVel = 0;
    if (v.pos.y < padY) {
      v.pos.y = padY;
      if (v.vel.y < 0) v.vel.y = 0;
    }
  }
}

function integrateDebris(d: Debris, dt: number, simTime: number): void {
  if (d.asleep) return;
  const v = d.vessel;
  applyMass(v, true);
  const g = accelAt(v.pos, simTime);
  let fx = g.x * v.mass;
  let fy = g.y * v.mass;
  const alt = len(v.pos) - PLANET.radius;
  const rho = airDensity(alt);
  const spd = len(v.vel);
  if (rho > 0 && spd > 0.05) {
    const cd = aeroArea(v, 0, false);
    let fd = 0.5 * rho * cd * spd * spd;
    const maxF = (spd / dt) * v.mass * 0.9;
    if (fd > maxF) fd = maxF;
    fx += (-v.vel.x / spd) * fd;
    fy += (-v.vel.y / spd) * fd;
  }
  v.vel.x += (fx / v.mass) * dt;
  v.vel.y += (fy / v.mass) * dt;
  v.pos.x += v.vel.x * dt;
  v.pos.y += v.vel.y * dt;
  v.angle += v.angVel * dt;
  if (lowestClearance(v) < 0) {
    seat(v);
    d.asleep = true;
  }
}

function placeOnPad(state: FlightState): void {
  const v = state.vessel;
  v.angle = 0;
  v.angVel = 0;
  v.vel = { x: 0, y: 0 };
  v.pos = { x: 0, y: PLANET.radius + 80 };
  applyMass(v, false);
  const gap = lowestClearance(v);
  v.pos.y -= gap - 0.35;
  state.padY = v.pos.y;
  state.phase = "rail";
}

export function createFlight(parts: Placed[], easy: boolean, sas = true): FlightState {
  const blueprint = parts.map((p) => ({ ...p }));
  const vessel = emptyVessel(blueprint.map(toSim));
  const state: FlightState = {
    easy,
    sas,
    blueprint,
    vessel,
    debris: [],
    phase: "rail",
    chuteOpen: false,
    chuteStage: 0,
    time: 0,
    altitude: 0,
    speed: 0,
    verticalSpeed: 0,
    maxAlt: 0,
    reachedHigh: false,
    orbit: analyzeOrbit({ x: 0, y: PLANET.radius }, { x: 0, y: 0 }),
    orbitHold: 0,
    fuelMass: 0,
    fuelCap: 0,
    twr: 0,
    deltaV: 0,
    padY: 0,
    fx: [],
    safeSpeed: easy ? 6 : 5,
    landedOn: null,
    body: "planet",
  };
  placeOnPad(state);
  sync(state);
  state.maxAlt = state.altitude;
  state.reachedHigh = false;
  return state;
}

export function retryFlight(state: FlightState): FlightState {
  const next = createFlight(state.blueprint, state.easy, state.sas);
  next.fx.push("retry");
  return next;
}

function refit(v: Vessel, anchor: SimPart, world: Vec, angle: number): void {
  applyMass(v, false);
  const rel = rotCw({ x: anchor.localX - v.com.x, y: anchor.localY - v.com.y }, angle);
  v.pos = sub(world, rel);
  v.angle = angle;
}

export function tryStage(state: FlightState): ActionResult {
  if (state.phase === "landed" || state.phase === "crashed") return { ok: false, reason: "现在不能分离" };
  const split = splitLowestStage(state.vessel.parts);
  if (!split) return { ok: false, reason: "没有可以分离的级" };
  const anchor = split.kept.find((p) => PARTS[p.kind].pod) ?? split.kept[0];
  const dAnchor = split.dropped[0];
  if (!anchor || !dAnchor) return { ok: false, reason: "没有可以分离的级" };
  const worldA = partWorld(state.vessel, anchor);
  const worldD = partWorld(state.vessel, dAnchor);
  const angle = state.vessel.angle;
  const angVel = state.vessel.angVel;
  const vel = { ...state.vessel.vel };
  state.vessel.parts = split.kept;
  refit(state.vessel, anchor, worldA, angle);
  state.vessel.angVel = angVel;
  state.vessel.vel = vel;
  const debris = emptyVessel(split.dropped);
  refit(debris, dAnchor, worldD, angle);
  debris.angVel = angVel * 0.4;
  debris.vel = { ...vel };
  let dir = sub(debris.pos, state.vessel.pos);
  if (len(dir) < 0.15) dir = mul(nose(angle), -1);
  dir = norm(dir);
  const rel = 2.3;
  const mu = (state.vessel.mass * debris.mass) / Math.max(1, state.vessel.mass + debris.mass);
  debris.vel = add(debris.vel, mul(dir, (rel * mu) / debris.mass));
  state.vessel.vel = add(state.vessel.vel, mul(dir, -(rel * mu) / state.vessel.mass));
  state.debris.push({ vessel: debris, asleep: false });
  state.fx.push("stage");
  sync(state);
  if (state.altitude < 30 && state.speed < 14) {
    state.vessel.angle = 0;
    state.vessel.angVel = 0;
    state.vessel.vel = { x: 0, y: 0 };
    state.vessel.pos = { x: 0, y: PLANET.radius + 80 };
    applyMass(state.vessel, false);
    const gap = lowestClearance(state.vessel);
    state.vessel.pos.y -= gap - 0.35;
    state.padY = state.vessel.pos.y;
    state.phase = "rail";
    sync(state);
  } else if (state.phase === "rail") {
    state.phase = "flight";
  }
  return { ok: true, reason: "分离成功" };
}

function liveChuteStage(state: FlightState): 0 | 1 | 2 {
  if (state.chuteStage > 0) return state.chuteStage;
  return state.chuteOpen ? 2 : 0;
}

export function tryChute(state: FlightState): ActionResult {
  if (liveChuteStage(state) >= 2) return { ok: true, reason: "降落伞已经打开" };
  if (state.body === "moon") return { ok: false, reason: "月芽旁边没有空气" };
  if (!state.vessel.parts.some((p) => PARTS[p.kind].chute)) return { ok: false, reason: "没有降落伞" };
  if (state.altitude > PLANET.atmHeight || state.altitude > CHUTE_MAX_ALT) {
    return { ok: false, reason: state.altitude > PLANET.atmHeight ? "这里没有空气" : "太高了，降到 2500 米再开" };
  }
  if (state.speed > CHUTE_MAX_SPEED) return { ok: false, reason: "太快了，先减速" };
  const next = (liveChuteStage(state) === 1 ? 2 : 1) as 1 | 2;
  state.chuteStage = next;
  state.chuteOpen = true;
  state.fx.push("chute");
  return { ok: true, reason: next === 1 ? "降落伞拉出来了" : "降落伞打开了" };
}

function resolveContact(state: FlightState): void {
  if (state.phase !== "flight") return;
  const moonGap = moonClearance(state.vessel, state.time);
  const planetGap = planetClearance(state.vessel);
  if (moonGap < 0 && moonGap < planetGap) {
    const moon = moonAt(state.time);
    const outward = norm(sub(state.vessel.pos, moon.pos));
    const rel = sub(state.vessel.vel, moon.vel);
    const closing = -dot(rel, outward);
    const vRad = dot(rel, outward);
    const tangential = Math.hypot(rel.x - outward.x * vRad, rel.y - outward.y * vRad);
    const tilt = Math.acos(clamp(dot(nose(state.vessel.angle), outward), -1, 1));
    const limit = state.safeSpeed;
    const tiltLimit = state.easy ? 1.05 : 0.72;
    const gentle = closing < limit && tangential < limit * 1.45 && tilt < tiltLimit;
    if (closing <= 0) {
      state.vessel.pos = add(state.vessel.pos, mul(outward, 0.3 - moonGap));
      return;
    }
    if (gentle) {
      seatOnMoon(state.vessel, state.time);
      state.phase = "landed";
      state.landedOn = "moon";
      state.fx.push("land");
      sync(state);
      return;
    }
    state.phase = "crashed";
    state.fx.push("crash");
    return;
  }
  if (planetGap >= 0) return;
  const outward = norm(state.vessel.pos);
  const closing = -dot(state.vessel.vel, outward);
  const vRad = dot(state.vessel.vel, outward);
  const tx = state.vessel.vel.x - outward.x * vRad;
  const ty = state.vessel.vel.y - outward.y * vRad;
  const tangential = Math.hypot(tx, ty);
  const tilt = Math.acos(clamp(dot(nose(state.vessel.angle), outward), -1, 1));
  const limit = state.safeSpeed;
  const tiltLimit = state.easy ? 1.05 : 0.72;
  const gentle = closing < limit && tangential < limit * 1.45 && tilt < tiltLimit;
  if (gentle) {
    seat(state.vessel);
    state.phase = "landed";
    state.landedOn = "planet";
    state.fx.push("land");
    sync(state);
    return;
  }
  state.phase = "crashed";
  state.fx.push("crash");
}

export function stepFlight(state: FlightState, input: FlightInput, dt: number): void {
  if (state.phase === "landed" && state.landedOn === "moon" && input.throttle > 0.08) {
    state.phase = "flight";
  } else if (state.phase === "landed" && state.landedOn === "moon") {
    seatOnMoon(state.vessel, state.time + dt);
    const steerN = clamp(input.steer, -1, 1);
    const rate = input.turnCap ?? 0.9;
    state.vessel.angle = wrapPi(state.vessel.angle + steerN * dt * rate);
    state.vessel.angVel = 0;
    state.time += dt;
    sync(state);
    return;
  } else if (state.phase === "landed" || state.phase === "crashed") {
    state.time += dt;
    return;
  }
  if (input.stage) {
    const staged = tryStage(state);
    if (!staged.ok) state.fx.push(`msg:${staged.reason}`);
  }
  if (input.chute) {
    const opened = tryChute(state);
    if (!opened.ok) state.fx.push(`msg:${opened.reason}`);
  }
  state.vessel.throttle = clamp(input.throttle, 0, 1);
  const h = dt / SUB;
  let simTime = state.time;
  for (let i = 0; i < SUB; i++) {
    integrateVessel(
      state.vessel,
      input.steer,
      h,
      state.easy,
      state.sas,
      liveChuteStage(state),
      state.phase,
      state.padY,
      simTime,
      input.turnCap,
    );
    for (const d of state.debris) integrateDebris(d, h, simTime);
    simTime += h;
  }
  state.time = simTime;
  sync(state);
  applyHeat(state, dt);
  if (state.phase === "rail" && state.altitude > 16 && state.verticalSpeed > 0.3) state.phase = "flight";
  resolveContact(state);
  if (stableOrbit(state.orbit) && state.phase === "flight" && state.body === "planet") state.orbitHold += dt;
  else state.orbitHold = 0;
}

export function debugPlace(state: FlightState, altitude: number, vel: Vec): void {
  const v = state.vessel;
  v.angle = 0;
  v.angVel = 0;
  v.throttle = 0;
  v.pos = { x: 0, y: PLANET.radius + altitude + 40 };
  v.vel = { x: 0, y: 0 };
  applyMass(v, false);
  const gap = lowestClearance(v);
  v.pos.y -= gap - altitude;
  v.vel = { x: vel.x, y: vel.y };
  state.phase = "flight";
  sync(state);
}

export function warpAllowed(state: FlightState): boolean {
  return warpBlock(state, 2) === null;
}

export function flightHint(state: FlightState): string {
  if (state.phase === "landed" && state.landedOn === "moon") return "月芽上可以再起飞";
  if (state.phase === "landed") return "轻轻落地了";
  if (state.phase === "crashed") return "再试一次就好";
  if (state.body === "moon" && state.verticalSpeed < -8) return "朝飞行的反方向减速";
  if (state.body === "moon") return "已经到月芽旁边了";
  if (state.phase === "rail" && state.vessel.throttle < 0.15) return "把右边油门推上去";
  if (state.chuteOpen && state.altitude < PLANET.atmHeight) return "降落伞打开了";
  if (
    !state.chuteOpen &&
    state.verticalSpeed < -6 &&
    state.altitude < PLANET.atmHeight &&
    state.altitude > 250 &&
    state.speed <= CHUTE_MAX_SPEED &&
    state.altitude <= CHUTE_MAX_ALT
  ) {
    return "可以开伞";
  }
  if (state.verticalSpeed < -12 && state.altitude < 8_000 && !state.chuteOpen) return "正在下落";
  if (state.altitude > PLANET.atmHeight + 200) return "外面几乎没有空气";
  if (Math.abs(state.vessel.angle) > 0.9 && state.speed > 25 && state.altitude < PLANET.atmHeight) return "头歪太多啦";
  if (state.fuelCap > 0 && state.fuelMass / state.fuelCap < 0.12) return "燃料不多了";
  return state.sas ? "稳住开着" : "";
}

export function progradeAngle(state: FlightState): number {
  if (state.speed < 1) return 0;
  return angleOf(state.vessel.vel);
}
