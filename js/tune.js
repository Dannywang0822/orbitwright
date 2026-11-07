// Tunables for 星匠 Orbitwright v1.
// Units: km, km/s, tonnes, kN, seconds. Isp_g already includes g0,
// so fuel rate (t/s) = T / Isp_g and Δv (m/s) = Isp_g * ln(m0/m1).
var OW = (typeof window !== "undefined" ? window : globalThis).OW || {};
(typeof window !== "undefined" ? window : globalThis).OW = OW;

OW.TUNE = {
  // Earth / Moon. EARTH_MOON_DIST is the compressed v1 distance (draft was 384400).
  RE: 6371,
  RM: 1737,
  MU_E: 398600,
  MU_M: 4903,
  EARTH_MOON_DIST: 280000, // TUNABLE km, Earth center → Moon center
  SOI_M: 45000, // km, UI + guidance; physics stays two-body everywhere

  // Earth atmosphere only. h >= ATM_TOP → no drag, no q-breakup.
  ATM_TOP: 70,
  RHO0: 1.225,
  SCALE_H: 7.5,
  CDA: 0.8, // TUNABLE Cd*A (m²). Fd = 0.5*Cd*ρ*v²*A

  // TUNABLE dynamic pressure limit (kPa). Breakup when q > qMax and AoA > AOA_BREAK.
  // Nearly vertical flight relaxes qMax (see Q_RELAX).
  QMAX: 40,
  Q_RELAX: 2.5,
  Q_RELAX_TILT: 20 * Math.PI / 180,
  AOA_BREAK: 25 * Math.PI / 180,

  // TUNABLE soft-landing sink rate. 0.003 km/s = 3 m/s.
  VSAFE: 0.003,
  // Earth impact is a crash above this sink rate even with legs (spec: 2 m/s).
  VSAFE_EARTH: 0.002,
  UPRIGHT: 25 * Math.PI / 180,
  TIP_PAD: 50 * Math.PI / 180,

  // Orbit checkpoint (Earth): h > ORBIT_H, |fpa| < ORBIT_FPA, speed in [LO, HI] * vc, held ORBIT_HOLD s.
  ORBIT_H: 100,
  ORBIT_FPA: 15 * Math.PI / 180,
  ORBIT_V_LO: 0.85,
  ORBIT_V_HI: 1.15,
  ORBIT_HOLD: 8,

  MAX_ANG_RATE: 120 * Math.PI / 180, // rad/s
  MAX_ANG_ACC: 8.0, // rad/s², how fast the stick can reach MAX_ANG_RATE
  ANG_DAMP: 1.1, // 1/s when the stick is released

  G_SURFACE: 9.81, // m/s², TWR only. Flight uses μ/r².
  WORLD_LIMIT: 1.2e6, // km from Earth center
  PAD_TWR_TIME: 3,

  // Time warp. 1 / 5 / 25 match the spec. COAST_WARP is an extra deep-space
  // step so the multi-day Earth–Moon coast stays playable (25× would be hours).
  COAST_WARP: 4000, // TUNABLE
  // HUD half-width around the computed lead (π − ω·t_transfer). Spec: ±35°.
  WINDOW_HALF: 35 * Math.PI / 180,

  SUBSTEP_NEAR: 0.05,
  SUBSTEP_FAR: 1.0,
};
