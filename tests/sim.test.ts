import { describe, expect, it } from "vitest";
import { analyze, fuelTanks, mirrorX, placementIssue, splitLowestStage } from "../src/sim/assembly.ts";
import {
  createFlight,
  debugPlace,
  retryFlight,
  stepFlight,
  tryChute,
  tryStage,
  type FlightInput,
  type FlightState,
} from "../src/sim/flight.ts";
import { PLANET, circularSpeed, gravityAccel, len, rotCw } from "../src/sim/math.ts";
import { analyzeOrbit, stableOrbit } from "../src/sim/orbit.ts";
import { PARTS, clusterRocket, hopperRocket, orbiterRocket, starterRocket, type Placed } from "../src/sim/parts.ts";

const FULL: FlightInput = { throttle: 1, steer: 0, stage: false, chute: false };
const IDLE: FlightInput = { throttle: 0, steer: 0, stage: false, chute: false };

function run(state: FlightState, seconds: number, input: FlightInput | ((s: FlightState) => FlightInput)): FlightState {
  const dt = 1 / 60;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const inp = typeof input === "function" ? input(state) : input;
    stepFlight(state, inp, dt);
    if (state.phase === "crashed" || state.phase === "landed") break;
  }
  return state;
}

function fuelOf(state: FlightState, id: string): number {
  return state.vessel.parts.find((p) => p.id === id)?.fuel ?? -1;
}

describe("math", () => {
  it("rotates the nose from up to the right", () => {
    const n = rotCw({ x: 0, y: 1 }, Math.PI / 2);
    expect(n.x).toBeCloseTo(1, 5);
    expect(n.y).toBeCloseTo(0, 5);
  });

  it("gravity points inward with magnitude mu/r^2", () => {
    const pos = { x: 0, y: PLANET.radius + 1000 };
    const g = gravityAccel(pos);
    expect(g.y).toBeLessThan(0);
    expect(g.x).toBeCloseTo(0, 6);
    expect(Math.abs(g.y)).toBeCloseTo(PLANET.mu / (pos.y * pos.y), 6);
  });
});

describe("assembly", () => {
  it("accepts the starter and the other ready rockets", () => {
    for (const parts of [starterRocket(), hopperRocket(), orbiterRocket(), clusterRocket()]) {
      const report = analyze(parts, true);
      expect(report.ok, report.errors.join(" / ")).toBe(true);
      expect(report.twr).toBeGreaterThan(1.2);
    }
  });

  it("makes a heavy rocket too heavy to launch", () => {
    const parts: Placed[] = [
      ...starterRocket(),
      { id: "extra-a", kind: "tank_l", x: 2, y: 8 },
      { id: "extra-b", kind: "tank_l", x: 8, y: 8 },
      { id: "extra-c", kind: "tank_l", x: 2, y: 12 },
    ];
    const report = analyze(parts, true);
    expect(report.ok).toBe(false);
    expect(report.twr).toBeLessThan(analyze(starterRocket(), true).twr);
  });

  it("keeps easy and normal delta-v the same", () => {
    const a = analyze(starterRocket(), true);
    const b = analyze(starterRocket(), false);
    expect(a.deltaV).toBeCloseTo(b.deltaV, 3);
    expect(a.twr).toBeGreaterThan(b.twr);
  });

  it("does not let fuel cross a separator", () => {
    const parts = starterRocket();
    const lower = parts.find((p) => p.id === "st-eng-l")!;
    const upper = parts.find((p) => p.id === "st-eng-s")!;
    const lowerIds = fuelTanks(parts, lower).map((p) => p.id);
    const upperIds = fuelTanks(parts, upper).map((p) => p.id);
    expect(lowerIds).toContain("st-tank-m");
    expect(lowerIds).not.toContain("st-tank-s");
    expect(upperIds).toContain("st-tank-s");
    expect(upperIds).not.toContain("st-tank-m");
  });

  it("drops both side boosters before the core stage", () => {
    const first = splitLowestStage(clusterRocket());
    expect(first).not.toBeNull();
    expect(first!.dropped.map((p) => p.id).sort()).toEqual(["cl-boost-l", "cl-boost-r"]);
    expect(first!.kept.some((p) => p.id === "cl-eng-l")).toBe(true);
    const boost = clusterRocket().find((p) => p.id === "cl-boost-l")!;
    const eng = clusterRocket().find((p) => p.id === "cl-eng-l")!;
    expect(boost.y + PARTS.booster.h).toBe(eng.y + PARTS.engine_l.h);
    expect(PARTS.booster.h).toBe(PARTS.tank_m.h + PARTS.engine_l.h);
    expect(first!.kept.some((p) => p.id === "cl-pod")).toBe(true);
    const second = splitLowestStage(first!.kept);
    expect(second!.dropped.some((p) => p.id === "cl-eng-l")).toBe(true);
    expect(second!.kept.some((p) => p.id === "cl-eng-s")).toBe(true);
    expect(second!.kept.some((p) => p.id === "cl-boost-l")).toBe(false);
  });

  it("mirrors a side part across the rocket center", () => {
    expect(mirrorX("booster", 4)).toBe(7);
    expect(mirrorX("booster", 7)).toBe(4);
    expect(mirrorX("tank_m", 5)).toBe(5);
  });

  it("stages the bottom engine away and frees the upper nozzle", () => {
    const split = splitLowestStage(starterRocket());
    expect(split).not.toBeNull();
    expect(split!.dropped.some((p) => p.id === "st-eng-l")).toBe(true);
    expect(split!.dropped.some((p) => p.id === "st-sep")).toBe(true);
    expect(split!.kept.some((p) => p.id === "st-pod")).toBe(true);
    expect(split!.kept.some((p) => p.id === "st-eng-s")).toBe(true);
    expect(split!.kept.some((p) => p.id === "st-eng-l")).toBe(false);
  });

  it("requires the pod first and refuses overlaps", () => {
    expect(placementIssue([], "tank_s", 4, 4, undefined, "new")).toMatch(/指挥舱/);
    const pod = starterRocket()[0]!;
    expect(placementIssue([pod], "pod", 2, 2, undefined, "new")).toMatch(/已经有/);
    expect(placementIssue([pod], "chute", pod.x, pod.y, undefined, "new")).toMatch(/已经有零件/);
  });
});

describe("orbit", () => {
  it("reads a circular orbit", () => {
    const r = PLANET.radius + 14_000;
    const v = circularSpeed(r);
    const o = analyzeOrbit({ x: 0, y: r }, { x: v, y: 0 });
    expect(o.kind).toBe("ellipse");
    expect(o.apoapsisAlt ?? 0).toBeCloseTo(14_000, -2);
    expect(o.periapsisAlt ?? 0).toBeCloseTo(14_000, -2);
    expect(stableOrbit(o)).toBe(true);
  });

  it("keeps a coasting orbit from hitting the air for three minutes", () => {
    const state = createFlight(starterRocket(), true);
    debugPlace(state, 15_000, { x: 0, y: 0 });
    const r = len(state.vessel.pos);
    state.vessel.vel = { x: circularSpeed(r), y: 0 };
    run(state, 180, IDLE);
    const now = len(state.vessel.pos);
    expect(state.phase).toBe("flight");
    expect(Math.abs(now - r) / r).toBeLessThan(0.04);
  });
});

describe("flight", () => {
  it("lifts the starter, burns only the lower tank, then stages", () => {
    const state = createFlight(starterRocket(), true);
    const upper0 = fuelOf(state, "st-tank-s");
    run(state, 12, FULL);
    expect(state.phase).toBe("flight");
    expect(state.altitude).toBeGreaterThan(80);
    expect(fuelOf(state, "st-tank-m")).toBeLessThan(PARTS.tank_m.fuel - 10);
    expect(fuelOf(state, "st-tank-s")).toBeCloseTo(upper0, 3);
    const staged = tryStage(state);
    expect(staged.ok).toBe(true);
    expect(state.vessel.parts.some((p) => p.id === "st-eng-l")).toBe(false);
    expect(state.vessel.parts.some((p) => p.id === "st-eng-s")).toBe(true);
    const before = fuelOf(state, "st-tank-s");
    run(state, 3, FULL);
    expect(fuelOf(state, "st-tank-s")).toBeLessThan(before - 1);
  });

  it("does not burn or thrust while the throttle command is zero", () => {
    const state = createFlight(starterRocket(), true);
    run(state, 1.5, FULL);
    const fuel = fuelOf(state, "st-tank-m");
    const outs = Object.values(state.vessel.engineOut).reduce((sum, v) => sum + v, 0);
    expect(outs).toBeGreaterThan(0.2);
    run(state, 2, IDLE);
    expect(fuelOf(state, "st-tank-m")).toBeCloseTo(fuel, 5);
    expect(Object.values(state.vessel.engineOut).every((v) => v === 0)).toBe(true);
  });

  it("lands a vertical chute descent and still crashes a fast impact", () => {
    const fast = createFlight(starterRocket(), true);
    debugPlace(fast, 6, { x: 0, y: -25 });
    run(fast, 3, IDLE);
    expect(fast.phase).toBe("crashed");
    const chute = createFlight(clusterRocket(), true);
    chute.chuteOpen = true;
    debugPlace(chute, 90, { x: 0, y: 0 });
    run(chute, 40, IDLE);
    expect(chute.phase).toBe("landed");
    expect(chute.chuteOpen).toBe(true);
    const again = retryFlight(chute);
    expect(again.phase).toBe("rail");
    expect(again.chuteOpen).toBe(false);
  });

  it("refuses the chute when still too fast", () => {
    const state = createFlight(starterRocket(), true);
    debugPlace(state, 800, { x: 0, y: 280 });
    expect(state.speed).toBeGreaterThan(230);
    const opened = tryChute(state);
    expect(opened.ok).toBe(false);
    expect(state.chuteOpen).toBe(false);
  });
  it("steers the nose when asked", () => {
    const state = createFlight(starterRocket(), true);
    run(state, 4, FULL);
    expect(state.phase).toBe("flight");
    run(state, 2.2, { throttle: 0.45, steer: 1, stage: false, chute: false });
    expect(state.vessel.angle).toBeGreaterThan(0.25);
  });

  it("lands a slow parachute return and crashes a fast one", () => {
    const soft = createFlight(hopperRocket(), true);
    debugPlace(soft, 1_600, { x: 0, y: -25 });
    expect(tryChute(soft).ok).toBe(true);
    expect(tryChute(soft).ok).toBe(true);
    expect(soft.chuteStage).toBe(2);
    run(soft, 520, IDLE);
    expect(soft.phase, `alt ${soft.altitude} vs ${soft.verticalSpeed}`).toBe("landed");

    const hard = createFlight(hopperRocket(), false);
    hard.chuteOpen = false;
    debugPlace(hard, 400, { x: 0, y: -40 });
    run(hard, 30, IDLE);
    expect(hard.phase).toBe("crashed");
  });

  it("refuses a parachute in space and refills on retry", () => {
    const state = createFlight(starterRocket(), true);
    run(state, 8, FULL);
    const burned = fuelOf(state, "st-tank-m");
    debugPlace(state, PLANET.atmHeight + 500, { x: 40, y: 10 });
    expect(tryChute(state).ok).toBe(false);
    const again = retryFlight(state);
    expect(again.phase).toBe("rail");
    expect(fuelOf(again, "st-tank-m")).toBeGreaterThan(burned + 10);
    expect(again.altitude).toBeLessThan(2);
  });

  it("can hop high and come home under a parachute", () => {
    const state = createFlight(hopperRocket(), true);
    let opened = false;
    run(state, 640, (s) => {
      if (!opened && s.maxAlt > 1_200 && s.verticalSpeed < -8 && s.altitude <= 2_500 && s.speed <= 250) {
        opened = true;
        return { throttle: 0, steer: 0, stage: false, chute: true };
      }
      if (opened && s.chuteStage === 1 && s.altitude <= 2_500 && s.speed <= 250) {
        return { throttle: 0, steer: 0, stage: false, chute: true };
      }
      if (s.maxAlt < 1_600 && s.verticalSpeed > -1) return FULL;
      return IDLE;
    });
    expect(state.maxAlt).toBeGreaterThan(1_200);
    expect(state.chuteOpen).toBe(true);
    expect(state.phase, `alt ${state.altitude.toFixed(0)} vs ${state.verticalSpeed.toFixed(1)}`).toBe("landed");
  });

  it("reaches a stable orbit with a scripted gravity turn", () => {
    const state = createFlight(orbiterRocket(), true);
    run(state, 220, (s) => {
      const alt = s.altitude;
      const apo = s.orbit.apoapsisAlt ?? 0;
      const peri = s.orbit.periapsisAlt ?? -1e9;
      let throttle = 1;
      let target = 0;
      if (alt > 250) target = Math.min(1.42, ((alt - 250) / 4_000) * 1.42);
      const nearApo = apo > 12_000 && alt > 10_000 && s.verticalSpeed < 18 && alt > apo - 3_500;
      if (peri > 7_000 && apo > 7_000) throttle = 0;
      else if (nearApo) {
        throttle = 1;
        target = Math.atan2(s.vessel.vel.x, s.vessel.vel.y);
      } else if (apo > 14_500) {
        throttle = 0;
        target = Math.atan2(s.vessel.vel.x, s.vessel.vel.y);
      }
      const err = wrapAngle(target - s.vessel.angle);
      const steer = Math.max(-1, Math.min(1, err * 2.2 - s.vessel.angVel * 1.2));
      return { throttle, steer, stage: false, chute: false };
    });
    expect(state.orbitHold, `apo ${state.orbit.apoapsisAlt} peri ${state.orbit.periapsisAlt} alt ${state.altitude}`).toBeGreaterThan(3);
    expect(state.phase).toBe("flight");
  });
});

function wrapAngle(a: number): number {
  let x = a;
  const tau = Math.PI * 2;
  x = ((x + Math.PI) % tau + tau) % tau - Math.PI;
  return x;
}
