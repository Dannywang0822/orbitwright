import { describe, expect, it } from "vitest";
import coastFixture from "./fixtures/android14-coast.json";
import { createFlight, debugPlace, stepFlight, type FlightState } from "../src/sim/flight.ts";
import { orbiterRocket } from "../src/sim/parts.ts";
import { consumeWake } from "../src/sim/clock.ts";
import { MOON, PREDICT_DT, moonAt, predictApproach } from "../src/sim/world.ts";

type DeviceSnap = {
  sim: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  fuel: number;
  easy: boolean;
  sas: boolean;
  commandThrottle: number;
  parts: { id: string; fuel: number }[];
  moonX: number;
  moonY: number;
  freshClosest: number;
  freshAt: number;
  freshRel: number;
};

function restoreDevice(snap: DeviceSnap): FlightState {
  const state = createFlight(orbiterRocket(), snap.easy, snap.sas);
  state.time = snap.sim;
  state.phase = "flight";
  state.vessel.pos = { x: snap.x, y: snap.y };
  state.vessel.vel = { x: snap.vx, y: snap.vy };
  state.vessel.angle = snap.angle;
  state.vessel.angVel = snap.angVel;
  for (const part of state.vessel.parts) {
    const src = snap.parts.find((p) => p.id === part.id);
    if (src) part.fuel = src.fuel;
  }
  return state;
}

describe("coast prediction", () => {
  it("does not report a pass through the centre of the moon", () => {
    const t = 100;
    const moon = moonAt(t);
    const r = Math.hypot(moon.pos.x, moon.pos.y);
    const out = { x: moon.pos.x / r, y: moon.pos.y / r };
    const gap = 12_000;
    const pos = { x: moon.pos.x + out.x * gap, y: moon.pos.y + out.y * gap };
    const vel = { x: moon.vel.x - out.x * 80, y: moon.vel.y - out.y * 80 };
    const pass = predictApproach(pos, vel, t, 600, PREDICT_DT);
    expect(pass.closest).toBeGreaterThanOrEqual(MOON.radius - 1);
    expect(pass.closest).toBeLessThan(MOON.soi);
    const escapeNearCentre = Math.sqrt((2 * MOON.mu) / 180);
    expect(pass.relSpeed).toBeLessThan(escapeNearCentre * 0.75);
  });

  it("keeps one future encounter for an unpowered coast, at 1× and at 5× stepping", () => {
    const state = createFlight(orbiterRocket(), true);
    const dt = 1 / 60;
    debugPlace(state, 18_000, { x: 260, y: 20 });
    state.vessel.throttle = 0;
    const fuel = state.fuelMass;
    expect(state.vessel.throttle).toBe(0);

    const flown = structuredClone(state);
    flown.fx = [];
    let best = 1e12;
    let bestAt = flown.time;
    let bestRel = 0;
    const first = predictApproach(state.vessel.pos, state.vessel.vel, state.time, 120, PREDICT_DT);
    for (let n = 0; n < 60 * 120 && flown.phase === "flight"; n++) {
      stepFlight(flown, { throttle: 0, steer: 0, stage: false, chute: false }, dt);
      const moon = moonAt(flown.time);
      const d = Math.hypot(flown.vessel.pos.x - moon.pos.x, flown.vessel.pos.y - moon.pos.y);
      const rs = Math.hypot(flown.vessel.vel.x - moon.vel.x, flown.vessel.vel.y - moon.vel.y);
      if (d < best) {
        best = d;
        bestAt = flown.time;
        bestRel = rs;
      }
    }
    expect(flown.fuelMass).toBeCloseTo(fuel, 6);
    expect(flown.vessel.throttle).toBe(0);
    expect(Math.abs(first.closest - best)).toBeLessThan(1_500);
    expect(Math.abs(first.at - bestAt)).toBeLessThan(8);
    expect(Math.abs(first.relSpeed - bestRel)).toBeLessThan(20);
    expect(best).toBeGreaterThan(MOON.radius);

    const steady = (warp: number) => {
      let acc = 0;
      let sim = 0;
      for (let i = 0; i < 40; i++) {
        const wake = consumeWake(acc, 0.05, warp, false);
        acc = wake.acc;
        sim += wake.sim;
      }
      return sim;
    };
    const at1 = steady(1);
    const at5 = steady(5);
    expect(at1).toBeGreaterThan(1.8);
    expect(at1).toBeLessThan(2.2);
    expect(at5).toBeGreaterThan(at1 * 4.5);
    expect(at5).toBeLessThan(at1 * 5.5);
    const single = structuredClone(state);
    single.fx = [];
    const grouped = structuredClone(state);
    grouped.fx = [];
    const zero = { throttle: 0, steer: 0, stage: false, chute: false };
    for (let i = 0; i < 240; i++) stepFlight(single, zero, dt);
    for (let w = 0; w < 30; w++) for (let k = 0; k < 8; k++) stepFlight(grouped, zero, dt);
    expect(grouped.time).toBeCloseTo(single.time, 6);
    expect(grouped.fuelMass).toBeCloseTo(single.fuelMass, 6);
    expect(Math.hypot(grouped.vessel.pos.x - single.vessel.pos.x, grouped.vessel.pos.y - single.vessel.pos.y)).toBeLessThan(1e-4);
    expect(Math.hypot(grouped.vessel.vel.x - single.vessel.vel.x, grouped.vessel.vel.y - single.vessel.vel.y)).toBeLessThan(1e-6);
  }, 180_000);

  it("replays the Android 14 coast: residual thrust walks it, zero throttle does not", () => {
    const raw = coastFixture as { release: DeviceSnap; later: DeviceSnap };
    const release = raw.release;
    const later = raw.later;
    const recordedMoon = Math.hypot(release.moonX, release.moonY);
    expect(recordedMoon).toBeGreaterThan(80_000);
    expect(recordedMoon).toBeLessThan(100_000);
    expect(Math.hypot(moonAt(release.sim).pos.x, moonAt(release.sim).pos.y)).toBeGreaterThan(recordedMoon * 5);
    expect(release.commandThrottle).toBeGreaterThan(0);
    expect(release.commandThrottle).toBeLessThan(0.02);
    expect(later.sim).toBeGreaterThan(release.sim);

    const dt = 1 / 60;
    const steps = Math.round((later.sim - release.sim) * 60);
    const coast = (throttle: number) => {
      const state = restoreDevice(release);
      for (let i = 0; i < steps; i++) stepFlight(state, { throttle, steer: 0, stage: false, chute: false }, dt);
      const pred = predictApproach(state.vessel.pos, state.vessel.vel, state.time, 400, PREDICT_DT);
      return { state, pred };
    };
    const held = coast(release.commandThrottle);
    const stopped = coast(0);
    expect(held.state.fuelMass).toBeLessThan(release.fuel - 0.01);
    expect(Math.abs(stopped.state.fuelMass - release.fuel)).toBeLessThan(1e-6);
    const flown = structuredClone(stopped.state);
    flown.fx = [];
    let best = 1e12;
    let bestAt = flown.time;
    let bestRel = 0;
    for (let i = 0; i < 60 * 400 && flown.phase === "flight"; i++) {
      stepFlight(flown, { throttle: 0, steer: 0, stage: false, chute: false }, dt);
      const m = moonAt(flown.time);
      const d = Math.hypot(flown.vessel.pos.x - m.pos.x, flown.vessel.pos.y - m.pos.y);
      const rs = Math.hypot(flown.vessel.vel.x - m.vel.x, flown.vessel.vel.y - m.vel.y);
      if (d < best) {
        best = d;
        bestAt = flown.time;
        bestRel = rs;
      }
      if (best < 2_000_000 && d > best + 40_000) break;
    }
    expect(Math.abs(stopped.pred.closest - best)).toBeLessThan(2_000);
    expect(Math.abs(stopped.pred.at - bestAt)).toBeLessThan(8);
    expect(Math.abs(stopped.pred.relSpeed - bestRel)).toBeLessThan(20);
  });
});
