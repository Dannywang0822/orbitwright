import { describe, expect, it } from "vitest";
import approachSnap from "./fixtures/android14-approach.json";
import nodepartSnap from "./fixtures/android14-nodepart-coast.json";
import steepSnap from "./fixtures/android14-steep-coast.json";
import { createFlight, stepFlight } from "../src/sim/flight.ts";
import { clusterRocket, orbiterRocket, starterRocket } from "../src/sim/parts.ts";
import { SLOW_TURN_RATE, turnCapFor } from "../src/sim/nav.ts";
import { MOON } from "../src/sim/world.ts";

describe("old moon coasts stay a written record", () => {
  it("does not treat the 92 km recording as the live moon", () => {
    const approach = approachSnap as { moonX: number; moonY: number; freshClosest: number; note: string };
    const oldDistance = Math.hypot(approach.moonX, approach.moonY);
    expect(oldDistance).toBeGreaterThan(80_000);
    expect(oldDistance).toBeLessThan(100_000);
    expect(approach.freshClosest).toBeGreaterThan(12_000);
    expect(approach.freshClosest).toBeLessThan(18_000);
    expect(approach.note).toContain("4700");
    expect((nodepartSnap as { note: string }).note).toContain("20 km");
    expect((steepSnap as { note: string }).note).toContain("13.1");
    expect(MOON.semiMajorAxis).toBeGreaterThan(1_000_000);
    expect(MOON.soi).toBeGreaterThan(MOON.radius * 20);
  });
});

describe("slow turn is a fixed rate", () => {
  it("spins at the published rate while the sentence says 慢慢 and does not chase the marker", () => {
    const state = createFlight(orbiterRocket(), true);
    state.phase = "flight";
    state.vessel.pos = { x: 0, y: 80_000 };
    state.vessel.vel = { x: 200, y: 0 };
    state.altitude = 38_000;
    state.vessel.angle = 0.4;
    const before = state.vessel.angle;
    const text = "按住向右，慢慢对准月芽";
    expect(turnCapFor({ id: "burn", text, aim: "moon", throttle: 0, hold: 0.2, mark: null, green: false })).toBe(SLOW_TURN_RATE);
    const dt = 1 / 60;
    for (let i = 0; i < 42; i++) {
      stepFlight(state, { throttle: 0, steer: 1, stage: false, chute: false, turnCap: SLOW_TURN_RATE }, dt);
    }
    const turned = state.vessel.angle - before;
    expect(turned).toBeGreaterThan(0.1);
    expect(turned).toBeLessThan(SLOW_TURN_RATE * 0.7 + 0.06);
    expect(turnCapFor({ id: "ascent", text: "油门推满", aim: "prograde", throttle: 1, hold: 0.2, mark: null, green: false })).toBeUndefined();
  });
});

describe("older rockets still fly", () => {
  it("lists the starter and the cluster as editable rockets", () => {
    expect(starterRocket().some((p) => p.kind === "pod")).toBe(true);
    expect(clusterRocket().filter((p) => p.kind === "booster").length).toBeGreaterThan(1);
  });
});
