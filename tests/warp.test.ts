import { describe, expect, it } from "vitest";
import { createFlight, debugPlace, stepFlight } from "../src/sim/flight.ts";
import { hopperRocket } from "../src/sim/parts.ts";
import { MOON, moonAt, MOON_SCALE } from "../src/sim/world.ts";
import {
  EARTH_TIMEWARP_HEIGHT,
  MOON_TIMEWARP_HEIGHT,
  MOON_WARP_HEIGHT,
  PLANET_WARP_HEIGHT,
  WARP_LADDER_NOTE,
  WARP_RATES,
  appliedWarp,
  stepWarp,
  warpBlock,
  warpCenterText,
  warpMark,
  warpRefuseText,
  warpStepBudget,
} from "../src/sim/warp.ts";

const coast = { throttle: 0, steer: 0, stage: false, chute: false };

function nearMoon(alt: number): ReturnType<typeof createFlight> {
  const state = createFlight(hopperRocket(), true);
  const moon = moonAt(state.time);
  state.phase = "flight";
  state.vessel.pos = { x: moon.pos.x, y: moon.pos.y + MOON.radius + alt };
  state.vessel.vel = { x: moon.vel.x, y: moon.vel.y };
  stepFlight(state, coast, 1 / 60);
  return state;
}

describe("time warp heights and the center mark", () => {
  it("keeps the measured heights and does not invent a higher ladder", () => {
    expect(EARTH_TIMEWARP_HEIGHT).toBe(25_000);
    expect(MOON_TIMEWARP_HEIGHT).toBe(5_000);
    expect(PLANET_WARP_HEIGHT).toBeCloseTo(25_000 * MOON_SCALE.length, 4);
    expect(MOON_WARP_HEIGHT).toBeCloseTo(5_000 * MOON_SCALE.length, 4);
    expect(WARP_RATES).toEqual([1, 2, 5]);
    expect(Math.max(...WARP_RATES)).toBe(5);
    expect(WARP_LADDER_NOTE).toBe("未还原，未套用");
    expect(stepWarp(1, 1)).toBe(2);
    expect(stepWarp(2, 1)).toBe(5);
    expect(stepWarp(5, 1)).toBe(5);
    expect(stepWarp(5, -1)).toBe(2);
    expect(stepWarp(2, -1)).toBe(1);
  });

  it("shows ×5 in the center only while a higher rate is actually running", () => {
    expect(warpMark(5)).toBe("×5");
    expect(warpCenterText(5)).toBe("×5");
    expect(warpCenterText(2)).toBe("×2");
    expect(warpCenterText(1)).toBeNull();
  });

  it("refuses high warp below each body's timewarpHeight and says why", () => {
    const low = createFlight(hopperRocket(), true);
    debugPlace(low, 1_000, { x: 20, y: 0 });
    expect(low.altitude).toBeLessThan(PLANET_WARP_HEIGHT);
    expect(warpBlock(low, 5)).toBe("height");
    expect(appliedWarp(low, 5)).toBe(1);
    expect(warpRefuseText("height", low)).toContain(`${Math.round(PLANET_WARP_HEIGHT)} 米`);
    expect(warpRefuseText("height", low)).toContain("青芽星");

    const high = createFlight(hopperRocket(), true);
    debugPlace(high, 8_000, { x: 30, y: 0 });
    expect(high.altitude).toBeGreaterThan(PLANET_WARP_HEIGHT);
    expect(warpBlock(high, 5)).toBeNull();
    expect(appliedWarp(high, 5)).toBe(5);
    expect(warpCenterText(appliedWarp(high, 5))).toBe("×5");

    high.vessel.throttle = 0.4;
    expect(warpBlock(high, 5)).toBe("engines");
    expect(warpRefuseText("engines", high)).toBe("发动机关掉以后才能加快时间");
    expect(appliedWarp(high, 5)).toBe(1);
    expect(warpCenterText(appliedWarp(high, 5))).toBeNull();
  });

  it("uses the moon height and does not heat the rule with an atmosphere the moon does not have", () => {
    const low = nearMoon(80);
    expect(low.body).toBe("moon");
    expect(low.altitude).toBeLessThan(MOON_WARP_HEIGHT);
    expect(warpBlock(low, 2)).toBe("height");
    expect(warpRefuseText("height", low)).toContain("月芽");
    expect(warpRefuseText("height", low)).toContain(`${Math.round(MOON_WARP_HEIGHT)} 米`);

    const high = nearMoon(2_000);
    expect(high.body).toBe("moon");
    expect(high.altitude).toBeGreaterThan(MOON_WARP_HEIGHT);
    expect(warpBlock(high, 5)).toBeNull();
  });

  it("stops a fast frame from crossing the air or the ground", () => {
    const up = warpStepBudget(5, 40_000, 900);
    const down = warpStepBudget(5, 120, 900);
    expect(down).toBeLessThan(up);
    expect((down * 900) / 60).toBeLessThanOrEqual(120 * 0.2 + 1);

    const state = createFlight(hopperRocket(), true);
    debugPlace(state, 200, { x: 0, y: -600 });
    const budget = warpStepBudget(5, state.altitude, state.speed);
    const before = state.altitude;
    for (let i = 0; i < budget; i++) stepFlight(state, coast, 1 / 60);
    expect(state.altitude).toBeGreaterThan(-8);
    expect(before - state.altitude).toBeLessThan(before * 0.55);
  });
});
