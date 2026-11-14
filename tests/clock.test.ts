import { describe, expect, it } from "vitest";
import { consumeWake } from "../src/sim/clock.ts";

function run(seconds: number, gap: number, warp: number): number {
  let acc = 0;
  let sim = 0;
  const n = Math.round(seconds / gap);
  for (let i = 0; i < n; i++) {
    const wake = consumeWake(acc, gap, warp, false);
    acc = wake.acc;
    sim += wake.sim;
  }
  return sim;
}

describe("flight clock", () => {
  it("keeps real time while frames arrive steadily", () => {
    expect(run(5, 0.05, 1)).toBeGreaterThan(4.7);
    expect(run(5, 0.05, 1)).toBeLessThan(5.2);
    expect(run(4, 0.05, 2)).toBeGreaterThan(7.5);
    expect(run(4, 0.05, 2)).toBeLessThan(8.4);
    expect(run(3, 0.05, 5)).toBeGreaterThan(14);
    expect(run(3, 0.05, 5)).toBeLessThan(15.6);
  });

  it("does not replay a long gap, a pause, or a hidden page", () => {
    const late = consumeWake(0, 10, 5, false);
    expect(late.sim).toBeLessThan(1.5);
    expect(late.sim).toBeGreaterThan(0);
    const paused = consumeWake(1.2, 30, 5, true);
    expect(paused.sim).toBe(0);
    expect(paused.acc).toBe(0);
    const hidden = consumeWake(0.4, 20, 1, true);
    expect(hidden.sim).toBe(0);
  });

  it("a warp change only applies to the new wake", () => {
    let acc = 0;
    let sim = 0;
    for (let i = 0; i < 20; i++) {
      const wake = consumeWake(acc, 0.05, 1, false);
      acc = wake.acc;
      sim += wake.sim;
    }
    const before = sim;
    const jumped = consumeWake(acc, 0.05, 5, false);
    expect(jumped.sim).toBeLessThan(0.3);
    expect(jumped.sim).toBeGreaterThan(0.15);
    expect(before).toBeGreaterThan(0.8);
  });
});
