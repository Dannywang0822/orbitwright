import { describe, expect, it } from "vitest";
import { CONFIRMED, VALUE_CLASS as CONFIRMED_CLASS, boosterMassTonnes } from "../src/sim/confirmed.ts";
import { ESTIMATES, FLYING_SOLID_BOOSTER, VALUE_CLASS as ESTIMATE_CLASS } from "../src/sim/estimates.ts";
import { PARTS } from "../src/sim/parts.ts";
import { estimateLabelErrors } from "../src/pack/value-class.ts";

describe("extracted values stay out of the flying booster", () => {
  it("keeps the formula in the confirmed table and marks it not for flight", () => {
    expect(CONFIRMED_CLASS).toBe("confirmed-extracted");
    expect(CONFIRMED.solidBooster.flightUse).toBe("no");
    expect(CONFIRMED.solidBooster.isp).toBe(60);
    expect(boosterMassTonnes(2, 5)).toEqual({ wet: 20, dry: 4, fuel: 16 });
  });

  it("labels the flying booster as an estimate and uses only those numbers", () => {
    expect(ESTIMATE_CLASS).toBe("unverified-estimate");
    expect(ESTIMATES.class).not.toBe("confirmed-extracted");
    expect(PARTS.booster.dry).toBe(FLYING_SOLID_BOOSTER.dryKg);
    expect(PARTS.booster.fuel).toBe(FLYING_SOLID_BOOSTER.fuelKg);
    expect(PARTS.booster.isp).toBe(FLYING_SOLID_BOOSTER.isp);
    expect(PARTS.booster.thrust).toBe(FLYING_SOLID_BOOSTER.thrustN);
    expect(PARTS.booster.isp).not.toBe(CONFIRMED.solidBooster.isp);
    expect(PARTS.booster.dry).not.toBe(boosterMassTonnes(2, 5).dry * 1000);
  });

  it("stops when an estimate file is relabeled as extracted", () => {
    const mislabeled = 'export const VALUE_CLASS = "confirmed-extracted"\n';
    expect(estimateLabelErrors(mislabeled, 'import { FLYING_SOLID_BOOSTER } from "./estimates.ts";\n').join("\n")).toContain("已提取");
    const copied = 'import { boosterMassTonnes } from "./confirmed.ts";\n';
    expect(estimateLabelErrors('export const VALUE_CLASS = "unverified-estimate"\n', copied).join("\n")).toContain("未批准");
  });
});
