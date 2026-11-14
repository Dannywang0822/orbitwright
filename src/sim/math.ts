/** Original balance for 青芽星. Not copied from any commercial sim. */

export interface Vec {
  x: number;
  y: number;
}

export const G0 = 9.80665;

export const PLANET = {
  name: "青芽星",
  radius: 42_000,
  g: 6,
  mu: 6 * 42_000 * 42_000,
  atmHeight: 6_500,
  scaleHeight: 1_300,
  rho0: 1.2,
};

/** Grid width stays 1.1 m. Height is 1.2× so the same saved cell layout is longer, not squashed. */
export const CELL_W = 1.1;
export const CELL_H = 1.32;
export const CELL = CELL_W;
export const GRID_COLS = 12;
export const GRID_ROWS = 22;

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(a: Vec, s: number): Vec {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

export function len(a: Vec): number {
  return Math.hypot(a.x, a.y);
}

export function norm(a: Vec): Vec {
  const l = len(a);
  if (l < 1e-8) return { x: 0, y: 1 };
  return { x: a.x / l, y: a.y / l };
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function wrapPi(a: number): number {
  let x = a;
  const tau = Math.PI * 2;
  x = ((x + Math.PI) % tau + tau) % tau - Math.PI;
  return x;
}

/** Clockwise if +y is up. Angle 0 keeps +y as +y; positive turns +y toward +x. */
export function rotCw(p: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

export function nose(angle: number): Vec {
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

export function angleOf(v: Vec): number {
  return Math.atan2(v.x, v.y);
}

export function gravityAccel(pos: Vec): Vec {
  const r = Math.max(1, len(pos));
  const g = PLANET.mu / (r * r);
  return mul(norm(pos), -g);
}

export function airDensity(altitude: number): number {
  if (altitude >= PLANET.atmHeight) return 0;
  const h = Math.max(0, altitude);
  const rho = PLANET.rho0 * Math.exp(-h / PLANET.scaleHeight);
  const edge = PLANET.atmHeight * 0.12;
  if (h > PLANET.atmHeight - edge) {
    const t = (PLANET.atmHeight - h) / edge;
    return rho * t * t;
  }
  return rho;
}

export function circularSpeed(radius: number): number {
  return Math.sqrt(PLANET.mu / radius);
}
