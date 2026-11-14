import { PLANET, dot, len, norm, type Vec } from "./math.ts";

export interface OrbitSnapshot {
  kind: "ellipse" | "hyperbola" | "radial";
  eccentricity: number;
  apoapsisAlt: number | null;
  periapsisAlt: number | null;
  period: number | null;
  points: Vec[];
  apoPoint: Vec | null;
  periPoint: Vec | null;
}

function empty(): OrbitSnapshot {
  return {
    kind: "radial",
    eccentricity: 1,
    apoapsisAlt: null,
    periapsisAlt: null,
    period: null,
    points: [],
    apoPoint: null,
    periPoint: null,
  };
}

export function analyzeOrbit(pos: Vec, vel: Vec): OrbitSnapshot {
  const r = len(pos);
  if (r < 1) return empty();
  const v2 = dot(vel, vel);
  const h = pos.x * vel.y - pos.y * vel.x;
  const eps = v2 / 2 - PLANET.mu / r;
  const radialVel = dot(pos, vel) / r;

  if (Math.abs(h) < 500) {
    const snap = empty();
    snap.kind = "radial";
    if (eps < -1e-6) {
      const ra = -PLANET.mu / eps;
      snap.apoapsisAlt = ra - PLANET.radius;
    }
    const dir = norm(pos);
    const ra = snap.apoapsisAlt != null ? snap.apoapsisAlt + PLANET.radius : r * 1.3;
    const outward = radialVel >= 0;
    for (let i = 0; i <= 40; i++) {
      const rr = outward ? r + ((ra - r) * i) / 40 : r - ((r - PLANET.radius) * i) / 40;
      if (rr < PLANET.radius * 0.98) break;
      snap.points.push({ x: dir.x * rr, y: dir.y * rr });
    }
    return snap;
  }

  const ex = (vel.y * h) / PLANET.mu - pos.x / r;
  const ey = (-vel.x * h) / PLANET.mu - pos.y / r;
  const e = Math.hypot(ex, ey);
  const bound = eps < -1e-4 && e < 0.999;

  if (!bound) {
    const snap = empty();
    snap.kind = "hyperbola";
    snap.eccentricity = e;
    snap.periapsisAlt = null;
    snap.apoapsisAlt = null;
    sampleConic(pos, vel, h, ex, ey, e, Math.max(e, 1.0001), snap.points, false);
    return snap;
  }

  const a = -PLANET.mu / (2 * eps);
  const rp = a * (1 - e);
  const ra = a * (1 + e);
  const snap: OrbitSnapshot = {
    kind: "ellipse",
    eccentricity: e,
    apoapsisAlt: ra - PLANET.radius,
    periapsisAlt: rp - PLANET.radius,
    period: Math.PI * 2 * Math.sqrt((a * a * a) / PLANET.mu),
    points: [],
    apoPoint: null,
    periPoint: null,
  };
  if (e < 1e-3) {
    const n = 96;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2;
      snap.points.push({ x: Math.cos(ang) * a, y: Math.sin(ang) * a });
    }
    snap.periPoint = { x: a, y: 0 };
    snap.apoPoint = { x: -a, y: 0 };
    return snap;
  }
  const periAng = Math.atan2(ey, ex);
  snap.periPoint = { x: Math.cos(periAng) * rp, y: Math.sin(periAng) * rp };
  snap.apoPoint = { x: Math.cos(periAng + Math.PI) * ra, y: Math.sin(periAng + Math.PI) * ra };
  sampleConic(pos, vel, h, ex, ey, e, e, snap.points, true);
  return snap;
}

function sampleConic(
  pos: Vec,
  vel: Vec,
  h: number,
  ex: number,
  ey: number,
  eForAngle: number,
  eShape: number,
  out: Vec[],
  ellipse: boolean,
): void {
  const r = len(pos);
  const p = (h * h) / PLANET.mu;
  const eUse = Math.max(eForAngle, 1e-6);
  const cosNu = clampDot((ex * pos.x + ey * pos.y) / (eUse * r));
  const radialVel = dot(pos, vel) / r;
  let nu = Math.acos(cosNu);
  if (radialVel < 0) nu = -nu;
  const sign = h >= 0 ? 1 : -1;
  const steps = ellipse ? 160 : 80;
  const span = ellipse ? Math.PI * 2 : Math.PI * 0.85;
  for (let i = 0; i <= steps; i++) {
    const vnu = nu + sign * (span * i) / steps;
    const denom = 1 + eShape * Math.cos(vnu);
    if (denom <= 0.05) break;
    const rr = p / denom;
    if (!Number.isFinite(rr) || rr > PLANET.radius * 12) break;
    const ang = Math.atan2(ey, ex) + vnu;
    out.push({ x: rr * Math.cos(ang), y: rr * Math.sin(ang) });
    if (rr < PLANET.radius * 0.99 && i > 2) break;
  }
}

function clampDot(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

export function stableOrbit(o: OrbitSnapshot): boolean {
  return (
    o.kind === "ellipse" &&
    (o.periapsisAlt ?? -1) > PLANET.atmHeight + 250 &&
    (o.apoapsisAlt ?? -1) > PLANET.atmHeight + 250 &&
    o.eccentricity < 0.92
  );
}
