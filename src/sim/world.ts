import { PLANET, add, len, mul, norm, sub, type Vec } from "./math.ts";

/**
 * 月芽 keeps the measured ratios of Spaceflight Simulator 1.6.00.22 Normal,
 * scaled onto 青芽星. The home planet stays at its own radius and gravity,
 * because the rockets are tuned for it.
 *
 * Measured (TA:Earth / TA:Moon, Normal): Earth R 314970 m, g 9.8;
 * Moon R 86500 m, g 1.42, semi-major axis 11200000 m, e 0.055,
 * argument of periapsis 304°, direction 1 (clockwise), multiplierSOI 1.35.
 * Inferred: μ = g R², and SOI = multiplierSOI × a × (μ_moon/μ_earth)^0.4.
 * The 0.4 exponent is the Laplace form; it was not recovered from IL2CPP.
 * meanAnomaly0 is a balance estimate so the first transfer is soon. It is not in the extract.
 *
 * lengthScale = R_青芽 / R_Earth. gravityScale = g_青芽 / g_Earth.
 * Every length uses lengthScale, every surface gravity uses gravityScale,
 * so circular-speed ratios stay (velocity scale is √(gravityScale × lengthScale)).
 */
const SFS_EARTH_R = 314_970;
const SFS_EARTH_G = 9.8;
const SFS_MOON_R = 86_500;
const SFS_MOON_G = 1.42;
const SFS_MOON_A = 11_200_000;
const SFS_MOON_E = 0.055;
const SFS_ARG_PERI = (304 * Math.PI) / 180;
const SFS_SOI_MULT = 1.35;

const lengthScale = PLANET.radius / SFS_EARTH_R;
const gravityScale = PLANET.g / SFS_EARTH_G;
const moonRadius = SFS_MOON_R * lengthScale;
const moonSma = SFS_MOON_A * lengthScale;
const moonG = SFS_MOON_G * gravityScale;
const moonMu = moonG * moonRadius * moonRadius;
const muRatio = (SFS_MOON_G * SFS_MOON_R * SFS_MOON_R) / (SFS_EARTH_G * SFS_EARTH_R * SFS_EARTH_R);
const moonSoi = SFS_SOI_MULT * moonSma * muRatio ** 0.4;

export const MOON_SCALE = {
  length: lengthScale,
  gravity: gravityScale,
  velocity: Math.sqrt(gravityScale * lengthScale),
};

export const MOON = {
  name: "月芽",
  radius: moonRadius,
  mu: moonMu,
  g: moonG,
  soi: moonSoi,
  /** Alias of the semi-major axis, kept for older callers. */
  orbitRadius: moonSma,
  semiMajorAxis: moonSma,
  eccentricity: SFS_MOON_E,
  argumentOfPeriapsis: SFS_ARG_PERI,
  meanAnomaly0: 5.5,
};

export function moonMotion(): number {
  const a = MOON.semiMajorAxis;
  return Math.sqrt(PLANET.mu / (a * a * a));
}

function wrapTau(angle: number): number {
  const t = Math.PI * 2;
  return ((angle % t) + t) % t;
}

function keplerE(mean: number, ecc: number): number {
  let E = mean;
  for (let i = 0; i < 8; i++) {
    const f = E - ecc * Math.sin(E) - mean;
    const d = 1 - ecc * Math.cos(E);
    E -= f / d;
  }
  return E;
}

export function moonAt(time: number): { pos: Vec; vel: Vec } {
  const a = MOON.semiMajorAxis;
  const ecc = MOON.eccentricity;
  const n = moonMotion();
  // Clockwise, matching the rockets that leave the pad toward +x.
  const mean = wrapTau(MOON.meanAnomaly0 + n * time);
  const E = keplerE(mean, ecc);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const denom = 1 - ecc * cosE;
  const factor = Math.sqrt(1 - ecc * ecc);
  const xp = a * (cosE - ecc);
  const yp = -a * factor * sinE;
  // Increasing mean anomaly with the perifocal y axis flipped is clockwise,
  // matching rockets that leave the pad toward +x. direction 1 in the extract.
  const vxp = (-a * n * sinE) / denom;
  const vyp = (-a * n * factor * cosE) / denom;
  const w = MOON.argumentOfPeriapsis;
  const c = Math.cos(w);
  const s = Math.sin(w);
  return {
    pos: { x: xp * c - yp * s, y: xp * s + yp * c },
    vel: { x: vxp * c - vyp * s, y: vxp * s + vyp * c },
  };
}

/** Planet gravity plus the moving moon. Same function for the flight step and the map prediction. */
export function accelAt(pos: Vec, time: number): Vec {
  const r = Math.max(1, len(pos));
  const planet = mul(norm(pos), -PLANET.mu / (r * r));
  const moon = moonAt(time);
  const rel = sub(pos, moon.pos);
  const d = Math.max(1, len(rel));
  return add(planet, mul(norm(rel), -MOON.mu / (d * d)));
}

export interface Approach {
  closest: number;
  at: number;
  relSpeed: number;
  /** Lowest planet-center distance before the closest moon approach. */
  minPlanetBefore: number;
  /** Seconds the search was asked to look ahead. A closest time near this end is not a finished pass. */
  horizon: number;
  point: Vec;
  moonPoint: Vec;
  samples: Vec[];
}

/**
 * Step used by the number the player sees. 1/30 s matches a throttle-off flight
 * coast; the old 0.8 s step reported a close, fast pass when the coast was not.
 */
export const PREDICT_DT = 1 / 30;

/** Coast the same gravity forward. Encounter is closest approach at one shared time, not a line crossing. */
export function predictApproach(pos: Vec, vel: Vec, time: number, seconds = 900, dt = 2): Approach {
  let p = { ...pos };
  let v = { ...vel };
  let t = time;
  let closest = Infinity;
  let at = time;
  let relSpeed = 0;
  let minPlanetBefore = len(p);
  let seenPlanet = len(p);
  let point = { ...pos };
  let moonPoint = moonAt(time).pos;
  const samples: Vec[] = [{ ...p }];
  const steps = Math.max(1, Math.ceil(seconds / dt));
  for (let i = 0; i < steps; i++) {
    const a = accelAt(p, t);
    const vNext = { x: v.x + a.x * dt, y: v.y + a.y * dt };
    const pNext = { x: p.x + vNext.x * dt, y: p.y + vNext.y * dt };
    t += dt;
    const moon = moonAt(t);
    const rel = sub(pNext, moon.pos);
    const dist = len(rel);
    // Inside the moon the 1/r^2 spike reports a pass of a few hundred metres
    // at escape speed. That number is not a flyby. Stop at the surface.
    if (dist <= MOON.radius) {
      if (MOON.radius < closest) {
        minPlanetBefore = seenPlanet;
        closest = MOON.radius;
        at = t;
        relSpeed = len(sub(vNext, moon.vel));
        point = { ...pNext };
        moonPoint = moon.pos;
      }
      break;
    }
    v = vNext;
    p = pNext;
    if (i % Math.max(1, Math.round(8 / dt)) === 0) samples.push({ ...p });
    const planetR = len(p);
    if (dist < closest) {
      minPlanetBefore = seenPlanet;
      closest = dist;
      at = t;
      relSpeed = len(sub(v, moon.vel));
      point = { ...p };
      moonPoint = moon.pos;
    }
    seenPlanet = Math.min(seenPlanet, planetR);
    if (planetR < PLANET.radius) break;
  }
  return { closest, at, relSpeed, minPlanetBefore, horizon: seconds, point, moonPoint, samples };
}

export function isEncounter(approach: Approach): boolean {
  return approach.closest < MOON.soi;
}
