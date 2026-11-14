/**
 * Numbers the flight still uses because the original figure was not recovered,
 * or because applying the recovered figure breaks a tuned flight.
 * These are not extracted measurements.
 */
export const VALUE_CLASS = "unverified-estimate" as const;

export const FLYING_SOLID_BOOSTER = {
  dryKg: 110,
  fuelKg: 400,
  isp: 240,
  thrustN: 11_500,
} as const;

/** Heating gate and rate. The original integral was not recovered. */
export const HEAT_BALANCE = {
  speed: 400,
  rate: 0.35,
} as const;

export const ESTIMATES = {
  class: VALUE_CLASS,
  solidBooster: FLYING_SOLID_BOOSTER,
  heat: HEAT_BALANCE,
} as const;
