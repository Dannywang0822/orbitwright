// Headless closed-loop check. Not part of the page.
//   node tools/flightcheck.mjs
import fs from "fs";
import vm from "vm";

const context = {
  console,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  JSON,
  isFinite,
  performance: { now: () => Date.now() },
};
vm.createContext(context);
for (const f of ["js/tune.js", "js/parts.js", "js/craft.js", "js/physics.js"]) {
  const code = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
  vm.runInContext(code, context, { filename: f });
}
const OW = context.OW;
OW.DEBUG = true;

function fmt(n, d) {
  if (!isFinite(n)) return "inf";
  return n.toFixed(d == null ? 1 : d);
}

function metricsLine(name, craft) {
  const m = OW.metrics(craft, "full");
  console.log(
    name,
    "mass", fmt(m.mass, 2),
    "Tsl", fmt(m.Tsl, 0),
    "TWR", fmt(m.twr, 2),
    "dv", fmt(m.dvAtm, 0), "/", fmt(m.dvVac, 0), "/", fmt(m.dvTotal, 0), "m/s",
    "stab", m.stabText,
    "ok", m.ok,
    "warn", m.warnings.join(" | "),
    "err", m.errors.join(" | ")
  );
  return m;
}

let failed = 0;
function expect(cond, msg) {
  if (!cond) {
    failed++;
    console.log("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const starter = OW.craftFromTemplate("starter");
const moon = OW.craftFromTemplate("moon");
const ms = metricsLine("starter", starter);
const mm = metricsLine("moon   ", moon);
expect(ms.ok && ms.twr > 1.3, "starter is legal and TWR >= 1.3");
expect(mm.ok && mm.dvTotal > ms.dvTotal, "moon ship has more Δv than the starter");
expect(ms.dvTotal > 9000, "starter Δv above 9 km/s (orbit ballpark)");

function simulate(craft, opts) {
  const v = OW.buildVehicle(craft);
  const world = { t: 0, moon0: opts.moon0 == null ? 1.05 : opts.moon0, mode: opts.mode || "moon" };
  v.throttle = opts.throttle0 == null ? 1 : opts.throttle0;
  v.ignited = opts.ignited == null ? true : opts.ignited;
  let lastLog = -999;
  let maxQ = 0;
  let maxAoA = 0;
  const phase = { name: opts.phase || "ascent", srbStaged: false, transferDone: false };
  while (world.t < (opts.maxT || 1200) && !v.result) {
    const input = opts.control(v, world, phase);
    if (input.stage) {
      const msg = OW.stageVehicle(v);
      if (msg) phase.lastStage = msg;
    }
    let left = input.warpDt || input.dt || 0.05;
    const cap = opts.maxStep || 0.05;
    while (left > 1e-6 && !v.result) {
      const h = Math.min(cap, left, OW.substepFor(v, world));
      OW.stepVehicle(v, world, input, h);
      world.t += h;
      left -= h;
    }
    maxQ = Math.max(maxQ, v.q || 0);
    maxAoA = Math.max(maxAoA, Math.abs(v.aoa || 0));
    if (opts.log && world.t - lastLog > opts.log) {
      lastLog = world.t;
      const tel = OW.telemetry(v, world);
      console.log(
        " t", fmt(world.t, 0),
        "ph", phase.name,
        "h", fmt(tel.altEarth, 1),
        "hm", fmt(tel.altMoon, 0),
        "v", fmt(tel.speed, 3),
        "fpa", fmt(tel.fpa * 180 / Math.PI, 1),
        "pe", fmt(tel.pe, 0),
        "ap", fmt(tel.ap, 0),
        "fuel", fmt(tel.fuel, 2),
        "q", fmt(tel.q, 1),
        "aoa", fmt(Math.abs(tel.aoa) * 180 / Math.PI, 1),
        "orb", v.orbitDone ? "Y" : fmt(v.orbitHold, 1),
        phase.lastStage || ""
      );
    }
    if (opts.stop && opts.stop(v, world, phase)) break;
  }
  const tel = OW.telemetry(v, world);
  return { v, world, tel, maxQ, maxAoA, phase };
}

function pitchToward(v, target) {
  const err = OW.wrapAngle(target - v.angle);
  return OW.clamp(err / 0.28, -1, 1);
}

function srbFuel(v) {
  let n = 0;
  let f = 0;
  for (const p of v.parts) if (p.alive && p.kind === "booster") { n++; f += p.fuel; }
  return { n, f };
}

function east(v) {
  const up = Math.atan2(v.y, v.x);
  const h = v.x * v.vy - v.y * v.vx;
  return up + (h >= 0 ? 1 : -1) * Math.PI / 2;
}

// --- vertical hop: a fixed rocket should climb and not explode ---
{
  const hop = simulate(starter, {
    maxT: 160,
    log: 20,
    control(v) {
      const s = srbFuel(v);
      return { pitch: 0, throttle: 1, stage: s.n > 0 && s.f < 0.02, dt: 0.05 };
    },
    stop(v) {
      return OW.telemetry(v, { t: 0, moon0: 0 }).altEarth > 120;
    },
  });
  console.log("hop end", hop.v.result && hop.v.result.text, "h", fmt(hop.tel.altEarth, 1), "maxQ", fmt(hop.maxQ, 1));
  expect(!hop.v.result && hop.tel.altEarth > 80, "vertical starter climbs above 80 km without breaking up");
}

// --- guided ascent to Earth orbit ---
function tiltForAlt(alt, speed) {
  // Radians from local vertical toward the east.
  // Slow ships stay steeper — a heavy rocket that pitches on the light-ship
  // schedule levels off suborbital and falls back into the air.
  if (alt < 0.8 || speed < 0.3) return 0;
  const lag = speed < 1.2 ? 0.45 : speed < 1.8 ? 0.75 : 1;
  let tilt;
  if (alt < 14) tilt = 0.20 * (alt / 14);
  else if (alt < 32) tilt = 0.20 + 0.45 * ((alt - 14) / 18);
  else if (alt < 58) tilt = 0.65 + 0.7 * ((alt - 32) / 26);
  else tilt = 1.42;
  return tilt * lag;
}

function orbitControl(v, world, phase) {
  const tel = OW.telemetry(v, world);
  const up = Math.atan2(v.y, v.x);
  const prograde = Math.atan2(v.vy, v.vx);
  const alt = tel.altEarth;
  const speed = tel.speed;
  let throttle = 1;
  let target = up;
  let stage = false;
  const s = srbFuel(v);
  if (s.n && s.f < 0.02) stage = true;

  // Steep through the air, then flat. Cut as soon as periapsis clears the
  // atmosphere — burning on past that throws apoapsis out to escape.
  if (alt < 80) target = up + Math.min(0.42, Math.max(0, alt - 1) * 0.006);
  else target = tel.fpa > 0.18 ? east(v) : prograde + 0.02;
  if (speed > 0.12 && tel.q > 12) {
    const aoa = OW.wrapAngle(target - prograde);
    const cap = tel.q > 48 ? 0.16 : 0.28;
    if (aoa > cap) target = prograde + cap;
    if (aoa < -0.08) target = prograde - 0.08;
  }
  if (phase.name === "ascent" && tel.pe > 150 && alt > 140 && Math.abs(tel.fpa) < 0.4) {
    throttle = 0;
    target = v.angle;
    phase.name = "orbit";
  } else if (phase.name !== "ascent") {
    throttle = 0;
    target = v.angle;
  }
  const step = phase.name === "coast" || phase.name === "orbit" || phase.name === "wait" ? 0.25 : 0.05;
  return { pitch: pitchToward(v, target), throttle, stage, dt: step };
}

{
  const run = simulate(starter, {
    maxT: 2500,
    log: 20,
    control: orbitControl,
    stop(v, world, phase) {
      if (phase.name === "orbit" && v.orbitDone) return true;
      if (OW.fuelLeft(v).fuel < 0.02 && world.t > 160) return true;
      return false;
    },
  });
  console.log("orbit end", run.v.result && run.v.result.text, "done", run.v.orbitDone, "pe", fmt(run.tel.pe, 1), "ap", fmt(run.tel.ap, 1), "fuel", fmt(run.tel.fuel, 2), "maxQ", fmt(run.maxQ, 1), "maxAoA", fmt(run.maxAoA * 180 / Math.PI, 1));
  expect(run.v.orbitDone && run.tel.pe > 80 && !run.v.result, "starter ship reaches a stable orbit");
}

// --- breakup copy ---
{
  const run = simulate(starter, {
    maxT: 40,
    control(v, world) {
      const tel = OW.telemetry(v, world);
      const up = Math.atan2(v.y, v.x);
      // Yank sideways once the ship is fast and still in thick air.
      const target = tel.altEarth > 1.2 ? up + 1.15 : up;
      return { pitch: pitchToward(v, target), throttle: 1, dt: 0.05 };
    },
  });
  console.log("yank end", run.v.result && run.v.result.text, "h", fmt(run.tel.altEarth, 2), "q", fmt(run.maxQ, 1));
  expect(run.v.result && /散架|翻倒/.test(run.v.result.text), "hard yaw in the air fails with a plain sentence");
}

// --- Moon ship: orbit, then transfer, then soft land ---
function moonControl(v, world, phase) {
  if (phase.name === "ascent" || phase.name === "coast" || phase.name === "circ" || phase.name === "orbit") {
    const base = orbitControl(v, world, phase);
    if (phase.name === "orbit" && v.orbitDone) {
      phase.name = "wait";
    }
    return base;
  }
  const tel = OW.telemetry(v, world);
  const up = Math.atan2(v.y, v.x);
  const prograde = Math.atan2(v.vy, v.vx);
  let throttle = 0;
  let target = prograde;
  let dt = 0.5;

  if (phase.name === "wait" || phase.name === "transfer") {
    // err < 0 means the Moon is a bit behind the ideal lead, so a burn now
    // finishes near the 65° departure as the ship keeps orbiting.
    const err = tel.window.err;
    // Positive err: Moon is still a little too far ahead. Start there so the
    // minute-long burn ends near the 65° lead.
    // End the burn near zero error. The burn itself lasts ~8–10° of orbit.
    // This band is tuned against the compressed Earth–Moon transfer: ending near
    // +7° actually meets the Moon; ending at 0 flies past it on this parking orbit.
    const armed = tel.window.useful && tel.pe > 120 && err > 0.14 && err < 0.32;
    if (phase.name === "wait" && armed) phase.name = "transfer";
    if (phase.name !== "transfer") {
      throttle = 0;
      target = v.angle;
      dt = 6;
      phase.name = "wait";
    } else {
      target = prograde;
      if (tel.ap > 255000 && tel.pe > 120) {
        throttle = 0;
        phase.name = "coastmoon";
        console.log("  depart ap", fmt(tel.ap, 0), "pe", fmt(tel.pe, 0), "fuel", fmt(tel.fuel, 2), "errDeg", fmt(err * 180 / Math.PI, 1));
      } else if (tel.fuel < 1.05 || err > 0.45) {
        throttle = 0;
        phase.name = "wait";
      } else {
        throttle = 1;
        dt = 0.5;
      }
    }
  } else if (phase.name === "coastmoon") {
    throttle = 0;
    target = v.angle; // hold attitude; don't chase prograde across a 4-second step
    dt = tel.altMoon < 8000 ? 0.5 : tel.altMoon < 40000 ? 2 : 8;
    if ((tel.inSoi && tel.altMoon < 600) || tel.altMoon < 400) phase.name = "approach";
    if (tel.altEarth < 100 && tel.vrad < 0 && tel.altMoon > 20000) phase.name = "failcoast";
  } else if (phase.name === "approach" || phase.name === "land") {
    const moon = OW.moonState(world.t, world.moon0);
    const mx = v.x - moon.x;
    const my = v.y - moon.y;
    const rm = Math.hypot(mx, my) || 1;
    const ux = mx / rm;
    const uy = my / rm;
    const rvx = v.vx - moon.vx;
    const rvy = v.vy - moon.vy;
    const vrad = rvx * ux + rvy * uy;
    const vtx = rvx - vrad * ux;
    const vty = rvy - vrad * uy;
    const vtan = Math.hypot(vtx, vty);
    const alt = rm - OW.TUNE.RM;
    const g = OW.TUNE.MU_M / (rm * rm);
    const burns = OW.activeBurns(v);
    let Tfull = 0;
    for (const b of burns.burns) {
      if (b.srb) continue;
      Tfull += OW.partPerf(OW.PARTS[b.part.partId], 0).thrust;
    }
    const aMax = Tfull / (tel.mass * 1000);
    const retro = Math.atan2(-rvy, -rvx);
    const upM = Math.atan2(uy, ux);
    const vRel = Math.hypot(rvx, rvy);
    const aNet = Math.max(0.002, aMax - g);
    // Kill Moon-relative speed once, then fall, then an upright suicide.
    // Leave ~0.8 km/s so the final burn still has fuel. Killing it all up high
    // spends the landing propellant on gravity.
    if (vRel < 1.25 && alt < 2500) phase.captured = true;
    if (!phase.captured) {
      target = retro;
      throttle = 1;
      dt = 0.05;
      phase.name = "approach";
    } else if (alt > 35) {
      target = upM;
      throttle = 0;
      dt = 0.15;
      phase.name = "approach";
    } else {
      target = upM;
      phase.name = "land";
      const vDown = Math.max(0, -vrad);
      const stop = (vDown * vDown) / (2 * Math.max(0.001, aMax - g));
      // Ballistic until the stopping distance is most of the altitude, then one burn.
      if (alt > 1.2 && stop < alt * 0.7 && vtan < 0.015) {
        throttle = 0;
      } else if (vtan > 0.006 && vDown < 0.03) {
        target = retro;
        throttle = 1;
      } else if (stop > alt * 0.7 || vDown > 0.01) {
        throttle = 1;
      } else {
        throttle = OW.clamp((g + (-0.0018 - vrad) * 2) / Math.max(aMax, 1e-6), 0, 1);
      }
      dt = 0.01;
    }
    v.angle = target;
    v.angVel = 0;
  }
  return { pitch: pitchToward(v, target), throttle, stage: false, dt };
}

{
  const run = simulate(moon, {
    maxT: 6 * 86400,
    log: 400,
    maxStep: 1,
    control: moonControl,
    stop(v, world, phase) {
      if (v.result) return true;
      if ((phase.name === "wait" || phase.name === "transfer") && world.t > 25000) return true;
      if (phase.name === "coastmoon") {
        const tel = OW.telemetry(v, world);
        if (world.t > 1200 && tel.ap < 90000) return true;
        if (tel.altEarth > 160000 && tel.vrad < 0 && tel.altMoon > 80000) return true;
      }
      return false;
    },
  });
  console.log(
    "moon end",
    run.phase.name,
    run.v.result && (run.v.result.ok ? "WIN " : "LOSE ") + run.v.result.text,
    "orbit", run.v.orbitDone,
    "hM", fmt(run.tel.altMoon, 2),
    "fuel", fmt(run.tel.fuel, 2),
    "t", fmt(run.world.t, 0)
  );
  expect(run.v.result && /月面/.test(run.v.result.text), "moon ship reaches the lunar surface: " + (run.v.result ? run.v.result.text : "no result"));
}

// A pointed suicide with fuel in reserve does soft-land. This is the maneuver
// the flight HUD (hover throttle + vertical-speed bar) is there to support.
{
  const craft = OW.craftFromTemplate("moon");
  const v = OW.buildVehicle(craft);
  const world = { t: 0, moon0: 0.4, mode: "moon" };
  const moon = OW.moonState(0, 0.4);
  const alt0 = 60;
  v.x = moon.x + OW.TUNE.RM + alt0;
  v.y = moon.y;
  v.vx = moon.vx - 0.35;
  v.vy = moon.vy;
  v.ignited = true;
  for (const p of v.parts) {
    if (p.kind === "booster") p.alive = false;
    if (p.kind === "tank") p.fuel = 0;
  }
  const tank = v.parts.find(function (p) { return p.alive && p.kind === "tank"; });
  tank.fuel = 0.9;
  for (let i = 0; i < 40000 && !v.result; i++) {
    const m = OW.moonState(world.t, world.moon0);
    const rx = v.x - m.x;
    const ry = v.y - m.y;
    const rm = Math.hypot(rx, ry) || 1;
    const ux = rx / rm;
    const uy = ry / rm;
    const rvx = v.vx - m.vx;
    const rvy = v.vy - m.vy;
    const vrad = rvx * ux + rvy * uy;
    const vtan = Math.hypot(rvx - vrad * ux, rvy - vrad * uy);
    const alt = rm - OW.TUNE.RM;
    const mass = OW.vehicleMassProps(v).mass;
    const aMax = OW.partPerf(OW.PARTS.eng_main, 0).thrust / mass / 1000;
    const g = OW.TUNE.MU_M / (rm * rm);
    const vDown = Math.max(0, -vrad);
    const stop = (vDown * vDown) / (2 * Math.max(0.001, aMax - g));
    let target = Math.atan2(uy, ux);
    let throttle = 0;
    if (vtan > 0.01 && alt > 0.6) {
      target = Math.atan2(-rvy, -rvx);
      throttle = 1;
    } else if (alt > 1.5 && stop < alt * 0.8) {
      throttle = 0;
    } else if (stop > alt * 0.65 || vDown > 0.02) {
      throttle = 1;
    } else {
      throttle = Math.max(0, Math.min(1, (g + (-0.0015 - vrad) * 2) / Math.max(aMax, 1e-6)));
    }
    v.angle = target;
    v.angVel = 0;
    OW.stepVehicle(v, world, { throttle: throttle, pitch: 0 }, 0.02);
    world.t += 0.02;
  }
  const mEnd = OW.moonState(world.t, world.moon0);
  const altEnd = Math.hypot(v.x - mEnd.x, v.y - mEnd.y) - OW.TUNE.RM;
  console.log("scripted land", v.result && v.result.text, "fuel", OW.fuelLeft(v).fuel.toFixed(3), "alt", altEnd.toFixed(2));
  expect(v.result && v.result.ok, "scripted soft landing: " + (v.result ? v.result.text : "no contact"));
}

// Place / remove rules
{
  const c = OW.emptyCraft();
  expect(OW.placePart(c, "cmd_mk1", { op: "root" }, {}) === "", "place command on empty pad");
  expect(OW.placePart(c, "tank_m", { op: "insert", index: 0 }, {}) === "", "insert tank under command");
  expect(OW.placePart(c, "cmd_mk1", { op: "insert", index: 2 }, {}) !== "", "reject a second command");
  const host = c.stack[0];
  expect(OW.placePart(c, "boost_srb", { op: "side", hostUid: host.uid, side: 1 }, {}) === "", "side booster");
  const bare = OW.emptyCraft();
  OW.placePart(bare, "cmd_mk1", { op: "root" }, {});
  OW.placePart(bare, "tank_s", { op: "insert", index: 0 }, {});
  expect(OW.metrics(bare).errors.some(function (e) { return e.indexOf("发动机") >= 0; }), "no engine is blocked");
}

console.log(failed ? "\n" + failed + " check(s) failed" : "\nall checks passed");
process.exit(failed ? 1 : 0);
