/**
 * Values taken from the extracted original tables.
 * flightUse "no" means the number is real but must not drive a flying part
 * until a later change explicitly approves it.
 */
export const VALUE_CLASS = "confirmed-extracted" as const;

export const BOOSTER_DRY_PERCENT = 0.2;
export const TUT1_SIZE = { width: 2, height: 2.5 };
export const TUT3_SIZE = { width: 2, height: 5 };

/** wetMass = height × width × 2 tonnes. The tonne totals are calculated, not stored. */
export function boosterMassTonnes(width: number, height: number, dryPercent = BOOSTER_DRY_PERCENT): { wet: number; dry: number; fuel: number } {
  const wet = height * width * 2;
  const dry = wet * dryPercent;
  return { wet, dry, fuel: wet - dry };
}

/** Earth startHeatingVelocityMultiplier. Already used as a multiplier, not a guessed force. */
export const EARTH_HEAT_SPEED_MULTIPLIER = 1;

export const CONFIRMED = {
  class: VALUE_CLASS,
  solidBooster: {
    isp: 60,
    dryMassPercent: BOOSTER_DRY_PERCENT,
    tut1: TUT1_SIZE,
    tut3: TUT3_SIZE,
    flightUse: "no" as const,
  },
  earthHeatSpeedMultiplier: {
    value: EARTH_HEAT_SPEED_MULTIPLIER,
    flightUse: "yes" as const,
  },
} as const;
