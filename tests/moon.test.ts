import { describe, expect, it } from "vitest";
import { createFlight, debugPlace, stepFlight, type FlightState } from "../src/sim/flight.ts";
import { PLANET, len, sub } from "../src/sim/math.ts";
import { starterRocket } from "../src/sim/parts.ts";
import { navCue } from "../src/sim/nav.ts";
import { MOON, isEncounter, moonAt, predictApproach } from "../src/sim/world.ts";

const IDLE = { throttle: 0, steer: 0, stage: false, chute: false };

function ship(): FlightState {
  const state = createFlight(starterRocket(), true);
  state.phase = "flight";
  return state;
}

function run(state: FlightState, seconds: number, input = IDLE): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) stepFlight(state, input, 1 / 30);
}

describe("moon scaled from the measured 1.6 ratios", () => {
  it("keeps radius, orbit and sphere in the measured proportions", () => {
    expect(MOON.radius / PLANET.radius).toBeCloseTo(86_500 / 314_970, 4);
    expect(MOON.semiMajorAxis / PLANET.radius).toBeCloseTo(11_200_000 / 314_970, 4);
    expect(MOON.soi / MOON.radius).toBeGreaterThan(20);
    expect(MOON.soi).toBeLessThan(MOON.semiMajorAxis);
    expect(MOON.g / PLANET.g).toBeCloseTo(1.42 / 9.8, 4);
    const r = Math.hypot(moonAt(0).pos.x, moonAt(0).pos.y);
    expect(r).toBeGreaterThan(MOON.semiMajorAxis * (1 - MOON.eccentricity) - 1);
    expect(r).toBeLessThan(MOON.semiMajorAxis * (1 + MOON.eccentricity) + 1);
  });

  it("does not call a same-path different-time crossing an encounter", () => {
    const moon = moonAt(0);
    const side = { x: -moon.pos.y, y: moon.pos.x };
    const hat = { x: side.x / len(side), y: side.y / len(side) };
    const speed = Math.sqrt(PLANET.mu / MOON.orbitRadius);
    const pos = { x: hat.x * MOON.orbitRadius, y: hat.y * MOON.orbitRadius };
    // Same clockwise direction as the moon, a quarter orbit away, so the paths cross in space and not in time.
    const vel = { x: hat.y * speed, y: -hat.x * speed };
    const approach = predictApproach(pos, vel, 0, 700, 2);
    expect(approach.closest).toBeGreaterThan(MOON.soi * 2);
    expect(isEncounter(approach)).toBe(false);
  });

  it("shows an encounter only when the ship and moon meet at one time", () => {
    const moon = moonAt(0);
    const away = { x: moon.pos.x / len(moon.pos), y: moon.pos.y / len(moon.pos) };
    const pos = {
      x: moon.pos.x + away.x * (MOON.soi + 400),
      y: moon.pos.y + away.y * (MOON.soi + 400),
    };
    const vel = {
      x: moon.vel.x - away.x * 40,
      y: moon.vel.y - away.y * 40,
    };
    const approach = predictApproach(pos, vel, 0, 400, 1);
    expect(isEncounter(approach)).toBe(true);
    expect(approach.closest).toBeLessThan(MOON.soi);
  });

  it("lets a fast pass leave the sphere instead of capturing", () => {
    const state = ship();
    const moon = moonAt(0);
    const away = { x: moon.pos.x / len(moon.pos), y: moon.pos.y / len(moon.pos) };
    state.vessel.pos = {
      x: moon.pos.x + away.x * (MOON.soi - 400),
      y: moon.pos.y + away.y * (MOON.soi - 400),
    };
    state.vessel.vel = { x: moon.vel.x + away.x * 260, y: moon.vel.y + away.y * 260 };
    state.time = 0;
    run(state, 20);
    const later = moonAt(state.time);
    expect(len(sub(state.vessel.pos, later.pos))).toBeGreaterThan(MOON.soi);
    expect(state.phase).toBe("flight");
  });

  it("captures after a retrograde burn inside the sphere", () => {
    const state = ship();
    const moon = moonAt(0);
    const away = { x: moon.pos.x / len(moon.pos), y: moon.pos.y / len(moon.pos) };
    const r = MOON.radius + 8_000;
    state.vessel.pos = { x: moon.pos.x + away.x * r, y: moon.pos.y + away.y * r };
    const tangential = { x: -away.y, y: away.x };
    const fast = 140;
    state.vessel.vel = {
      x: moon.vel.x + tangential.x * fast,
      y: moon.vel.y + tangential.y * fast,
    };
    state.time = 0;
    const circular = Math.sqrt(MOON.mu / r);
    state.vessel.vel = {
      x: moon.vel.x + tangential.x * circular,
      y: moon.vel.y + tangential.y * circular,
    };
    run(state, 200);
    const moonNow = moonAt(state.time);
    expect(len(sub(state.vessel.pos, moonNow.pos))).toBeLessThan(MOON.soi);
    expect(state.phase).toBe("flight");
  });

  it("keeps position and speed continuous across the sphere edge", () => {
    const state = ship();
    const moon = moonAt(0);
    const away = { x: moon.pos.x / len(moon.pos), y: moon.pos.y / len(moon.pos) };
    state.vessel.pos = {
      x: moon.pos.x + away.x * (MOON.soi + 30),
      y: moon.pos.y + away.y * (MOON.soi + 30),
    };
    state.vessel.vel = { x: moon.vel.x - away.x * 20, y: moon.vel.y - away.y * 20 };
    state.time = 0;
    const before = { ...state.vessel.pos };
    const speed = len(state.vessel.vel);
    stepFlight(state, IDLE, 1 / 30);
    const jump = len(sub(state.vessel.pos, before));
    expect(jump).toBeLessThan(speed * (1 / 30) + 5);
    expect(Math.abs(len(state.vessel.vel) - speed)).toBeLessThan(30);
  });

  it("soft-lands on the moon and flies back out of the sphere", () => {
    const state = ship();
    const moon = moonAt(0);
    const away = { x: moon.pos.x / len(moon.pos), y: moon.pos.y / len(moon.pos) };
    state.vessel.pos = {
      x: moon.pos.x + away.x * (MOON.radius + 18),
      y: moon.pos.y + away.y * (MOON.radius + 18),
    };
    state.vessel.vel = { x: moon.vel.x - away.x * 0.4, y: moon.vel.y - away.y * 0.4 };
    state.vessel.angle = Math.atan2(away.x, away.y);
    state.time = 0;
    state.phase = "flight";
    run(state, 40);
    expect(state.phase).toBe("landed");
    expect(state.landedOn).toBe("moon");
    const sitting = moonAt(state.time);
    const up = sub(state.vessel.pos, sitting.pos);
    state.vessel.angle = Math.atan2(up.x, up.y);
    state.vessel.angVel = 0;
    run(state, 55, { throttle: 1, steer: 0, stage: false, chute: false });
    const moonNow = moonAt(state.time);
    expect(state.phase).toBe("flight");
    expect(len(sub(state.vessel.pos, moonNow.pos)) - MOON.radius).toBeGreaterThan(2_000);
  });
});

describe("orbit wait names a button the player can see", () => {
  it("says which way to hold while the nose is off the direction of flight", () => {
    const state = createFlight(starterRocket(), true);
    state.phase = "flight";
    state.body = "planet";
    state.altitude = 16_000;
    state.time = 0;
    state.orbit.periapsisAlt = 9_000;
    state.orbit.apoapsisAlt = 17_000;
    state.vessel.pos = { x: 58_000, y: 0 };
    state.vessel.vel = { x: 0, y: -400 };
    state.vessel.angle = 1.2;
    const cue = navCue(state);
    expect(cue.text.includes("按住向右")).toBe(true);
    expect(cue.throttle).toBe(0);
  });
});

describe("earth landing still uses the planet", () => {
  it("does not treat a slow earth drop as a moon landing", () => {
    const state = createFlight(starterRocket(), true);
    debugPlace(state, 30, { x: 0, y: -2 });
    state.chuteOpen = true;
    run(state, 20);
    expect(state.landedOn).toBe("planet");
    expect(state.phase).toBe("landed");
  });
});
