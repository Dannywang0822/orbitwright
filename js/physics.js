// Two-body flight. Earth at the origin; the Moon is on rails.
// Position km, velocity km/s, mass tonnes, thrust kN, angles radians.

OW.clamp = function (v, a, b) {
  return Math.max(a, Math.min(b, v));
};

OW.wrapAngle = function (a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

OW.moonOmega = function () {
  var d = OW.TUNE.EARTH_MOON_DIST;
  return Math.sqrt(OW.TUNE.MU_E / (d * d * d));
};

OW.moonState = function (t, moon0) {
  var d = OW.TUNE.EARTH_MOON_DIST;
  var w = OW.moonOmega();
  var a = (moon0 || 0) + w * t;
  return {
    x: d * Math.cos(a),
    y: d * Math.sin(a),
    vx: -d * w * Math.sin(a),
    vy: d * w * Math.cos(a),
    angle: a,
  };
};

OW.atmosphere = function (hKm) {
  if (hKm >= OW.TUNE.ATM_TOP) return { rho: 0, s: 0 };
  var rho = OW.TUNE.RHO0 * Math.exp(-Math.max(0, hKm) / OW.TUNE.SCALE_H);
  return { rho: rho, s: Math.max(0, Math.min(1, rho / OW.TUNE.RHO0)) };
};

OW.kepler = function (x, y, vx, vy, mu) {
  var r = Math.hypot(x, y);
  var v2 = vx * vx + vy * vy;
  var energy = v2 / 2 - mu / r;
  var h = x * vy - y * vx;
  var h2 = h * h;
  var e2 = 1 + (2 * energy * h2) / (mu * mu);
  var e = Math.sqrt(Math.max(0, e2));
  var a = Math.abs(energy) < 1e-14 ? Infinity : -mu / (2 * energy);
  var rp;
  var ra;
  if (energy < 0 && isFinite(a)) {
    rp = a * (1 - e);
    ra = a * (1 + e);
  } else {
    rp = h2 / (mu * (1 + e));
    ra = Infinity;
  }
  return { r: r, v: Math.sqrt(v2), energy: energy, h: h, e: e, a: a, rp: rp, ra: ra };
};

OW.flightPath = function (x, y, vx, vy) {
  var r = Math.hypot(x, y) || 1;
  var vrad = (vx * x + vy * y) / r;
  var vt = Math.hypot(vx - (vrad * x) / r, vy - (vrad * y) / r);
  return { vrad: vrad, vt: vt, v: Math.hypot(vrad, vt), fpa: Math.atan2(vrad, vt), r: r };
};

OW.buildVehicle = function (craft) {
  var layout = OW.layoutCraft(craft, { fuel: "full" });
  var parts = layout.parts.map(function (p) {
    return {
      uid: p.uid,
      partId: p.partId,
      role: p.role,
      stackIndex: p.stackIndex,
      side: p.side,
      hostUid: p.hostUid,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      fuel: p.fuelMax,
      fuelMax: p.fuelMax,
      alive: true,
      kind: p.kind,
      stage: p.stage,
    };
  });
  var mass0 = 0;
  var cx = 0;
  var cy = 0;
  for (var i = 0; i < parts.length; i++) {
    var d = OW.PARTS[parts[i].partId];
    var m = d.mDry + parts[i].fuel;
    mass0 += m;
    cx += m * parts[i].x;
    cy += m * parts[i].y;
  }
  var comX = mass0 ? cx / mass0 : 0;
  var comY = mass0 ? cy / mass0 : 0;
  // Sit the lowest point on the pad at +X (nose = world +X = local up).
  var low = 1e9;
  for (var k = 0; k < parts.length; k++) low = Math.min(low, parts[k].y - parts[k].h / 2);
  var footX = 0 - comX;
  var footY = low - comY;
  var noseX = 1;
  var noseY = 0;
  var rightX = 0;
  var rightY = 1;
  var padR = OW.TUNE.RE + 0.0015;
  var offX = (rightX * footX + noseX * footY) / 1000;
  var offY = (rightY * footX + noseY * footY) / 1000;
  return {
    x: padR - offX,
    y: 0 - offY,
    vx: 0,
    vy: 0,
    angle: 0,
    angVel: 0,
    throttle: 0,
    ignited: false,
    parts: parts,
    orbitHold: 0,
    orbitDone: false,
    maxAlt: 0,
    maxAltMoon: Infinity,
    minMoonDist: Infinity,
    result: null,
    landed: null, // 'earth' | 'moon' after a soft touchdown in sandbox
    padTimeLow: 0,
    q: 0,
    aoa: 0,
    fuelEmptyTimer: 0,
    stageFlash: "",
    exploded: false,
  };
};

OW.vehicleMassProps = function (v) {
  var mass = 0;
  var cx = 0;
  var cy = 0;
  var alive = [];
  for (var i = 0; i < v.parts.length; i++) {
    var p = v.parts[i];
    if (!p.alive) continue;
    var d = OW.PARTS[p.partId];
    var m = d.mDry + Math.max(0, p.fuel);
    p.mass = m;
    mass += m;
    cx += m * p.x;
    cy += m * p.y;
    alive.push(p);
  }
  var comX = mass ? cx / mass : 0;
  var comY = mass ? cy / mass : 0;
  var I = 0;
  for (var j = 0; j < alive.length; j++) {
    var p2 = alive[j];
    var dx = p2.x - comX;
    var dy = p2.y - comY;
    I += p2.mass * (dx * dx + dy * dy);
    I += p2.mass * (p2.h * p2.h + p2.w * p2.w) / 12;
  }
  if (I < 8) I = 8;
  if (mass < 0.2) mass = 0.2;
  return { mass: mass, comX: comX, comY: comY, I: I, alive: alive };
};

function aliveStack(v) {
  return v.parts
    .filter(function (p) { return p.alive && p.role === "stack"; })
    .sort(function (a, b) { return a.stackIndex - b.stackIndex; });
}

OW.activeBurns = function (v) {
  // Lowest core engine that still has tank fuel, plus any live SRBs once ignited.
  var stack = aliveStack(v);
  var plan = OW.enginePlan(stack);
  var burns = [];
  if (v.ignited) {
    for (var i = 0; i < v.parts.length; i++) {
      var p = v.parts[i];
      if (p.alive && p.kind === "booster" && p.fuel > 1e-6) {
        burns.push({ part: p, tanks: null, srb: true });
      }
    }
  }
  if (plan.length && v.ignited) {
    var fuel = 0;
    for (var t = 0; t < plan[0].tanks.length; t++) fuel += plan[0].tanks[t].fuel;
    if (fuel > 1e-6) burns.push({ part: plan[0].engine, tanks: plan[0].tanks, srb: false });
  }
  return { burns: burns, plan: plan, stack: stack };
};

OW.fuelLeft = function (v) {
  var f = 0;
  var max = 0;
  for (var i = 0; i < v.parts.length; i++) {
    if (!v.parts[i].alive) continue;
    f += Math.max(0, v.parts[i].fuel);
    max += v.parts[i].fuelMax;
  }
  return { fuel: f, max: max, pct: max > 0 ? f / max : 0 };
};

OW.nextStageInfo = function (v) {
  var boosters = v.parts.filter(function (p) { return p.alive && p.kind === "booster"; });
  if (boosters.length) return { name: "固体助推", uids: boosters.map(function (p) { return p.uid; }) };
  var stack = aliveStack(v);
  var plan = OW.enginePlan(stack);
  if (!plan.length) return null;
  var eng = plan[0];
  var uids = [eng.engine.uid];
  for (var t = 0; t < eng.tanks.length; t++) uids.push(eng.tanks[t].uid);
  var idx = eng.engine.stackIndex;
  for (var i = 0; i < v.parts.length; i++) {
    var p = v.parts[i];
    if (!p.alive || p.role !== "stack") continue;
    if (p.kind === "command") continue;
    if (p.stackIndex <= idx) uids.push(p.uid);
  }
  // Unique
  var seen = {};
  var uniq = [];
  for (var u = 0; u < uids.length; u++) if (!seen[uids[u]]) { seen[uids[u]] = 1; uniq.push(uids[u]); }
  var upperLeft = stack.some(function (p) {
    return p.kind === "command" || p.stackIndex > eng.engine.stackIndex && eng.tanks.every(function (t) { return t.uid !== p.uid; });
  });
  return { name: plan.length > 1 ? "芯级" : "下面级", uids: uniq, keepsCommand: upperLeft };
};

OW.stageVehicle = function (v) {
  if (!v.ignited || v.result) return "";
  var info = OW.nextStageInfo(v);
  if (!info) return "";
  var dropCmd = false;
  for (var i = 0; i < v.parts.length; i++) {
    if (!info.uids.length) break;
  }
  var set = {};
  for (var u = 0; u < info.uids.length; u++) set[info.uids[u]] = true;
  var dropped = 0;
  for (var p = 0; p < v.parts.length; p++) {
    if (set[v.parts[p].uid] && v.parts[p].alive) {
      if (v.parts[p].kind === "command") dropCmd = true;
      v.parts[p].alive = false;
      dropped++;
    }
  }
  if (!dropped) return "";
  if (dropCmd || !v.parts.some(function (p) { return p.alive && p.kind === "command"; })) {
    OW.finish(v, false, "指令舱分离了，飞船不再受控。");
  }
  return info.name + "已分离";
};

OW.finish = function (v, ok, text) {
  if (v.result) return;
  v.result = { ok: ok, text: text };
};

OW.hasLegs = function (v) {
  return v.parts.some(function (p) { return p.alive && p.kind === "legs"; });
};

function lowestPoint(v, props) {
  var noseX = Math.cos(v.angle);
  var noseY = Math.sin(v.angle);
  var rightX = -Math.sin(v.angle);
  var rightY = Math.cos(v.angle);
  var best = null;
  for (var i = 0; i < props.alive.length; i++) {
    var p = props.alive[i];
    var footY = p.y - p.h / 2;
    // Sample the underside so wide legs count.
    var xs = [p.x];
    if (p.kind === "legs") xs = [p.x - p.w / 2, p.x, p.x + p.w / 2];
    for (var k = 0; k < xs.length; k++) {
      var lx = xs[k] - props.comX;
      var ly = footY - props.comY;
      var wx = v.x + (rightX * lx + noseX * ly) / 1000;
      var wy = v.y + (rightY * lx + noseY * ly) / 1000;
      var r = Math.hypot(wx, wy);
      if (!best || r < best.r) best = { x: wx, y: wy, r: r };
    }
  }
  return best;
}

OW.stepVehicle = function (v, world, input, dt) {
  if (v.result) return v;
  input = input || {};
  if (input.throttle != null) v.throttle = OW.clamp(input.throttle, 0, 1);
  var pitch = OW.clamp(input.pitch || 0, -1, 1);

  var moon = OW.moonState(world.t, world.moon0);
  var props = OW.vehicleMassProps(v);
  var rE = Math.hypot(v.x, v.y) || 1;
  var hE = rE - OW.TUNE.RE;
  var mx = v.x - moon.x;
  var my = v.y - moon.y;
  var rM = Math.hypot(mx, my) || 1;
  var hM = rM - OW.TUNE.RM;
  v.minMoonDist = Math.min(v.minMoonDist, rM);
  if (hE > v.maxAlt) v.maxAlt = hE;
  if (hM < v.maxAltMoon) v.maxAltMoon = hM;

  var atm = OW.atmosphere(hE);
  var burns = OW.activeBurns(v);
  var thrustX = 0; // kN world, applied along nose at each bell
  var thrustY = 0;
  var torque = 0; // kN·m in the local frame (positive increases angle)
  var noseX = Math.cos(v.angle);
  var noseY = Math.sin(v.angle);

  for (var b = 0; b < burns.burns.length; b++) {
    var burn = burns.burns[b];
    var def = OW.PARTS[burn.part.partId];
    var throttle = burn.srb ? 1 : v.throttle;
    if (throttle <= 0) continue;
    var perf = OW.partPerf(def, atm.s);
    var fuelNeed = perf.mdot * throttle * dt;
    var fuelHave = 0;
    if (burn.tanks) {
      for (var t = 0; t < burn.tanks.length; t++) fuelHave += Math.max(0, burn.tanks[t].fuel);
    } else fuelHave = Math.max(0, burn.part.fuel);
    var frac = fuelNeed > 1e-8 ? Math.min(1, fuelHave / fuelNeed) : 0;
    if (frac <= 0) continue;
    var F = perf.thrust * throttle * frac;
    var use = fuelNeed * frac;
    if (burn.tanks) {
      var left = use;
      for (var t2 = 0; t2 < burn.tanks.length && left > 1e-10; t2++) {
        var take = Math.min(burn.tanks[t2].fuel, left);
        burn.tanks[t2].fuel -= take;
        left -= take;
      }
    } else burn.part.fuel -= use;
    thrustX += noseX * F;
    thrustY += noseY * F;
    var rx = burn.part.x - props.comX;
    torque += rx * F;
  }

  // Gravity, both bodies, km/s².
  var aEx = -OW.TUNE.MU_E * v.x / (rE * rE * rE);
  var aEy = -OW.TUNE.MU_E * v.y / (rE * rE * rE);
  var aMx = -OW.TUNE.MU_M * mx / (rM * rM * rM);
  var aMy = -OW.TUNE.MU_M * my / (rM * rM * rM);

  var speed = Math.hypot(v.vx, v.vy);
  var dragX = 0;
  var dragY = 0;
  var q = 0;
  if (atm.rho > 0 && speed > 1e-6) {
    // a (km/s²) = 0.4 * ρ * v² / m   with v in km/s, m in tonnes. See tune.js CdA.
    var aDrag = (0.4 * atm.rho * speed * speed) / props.mass;
    dragX = -aDrag * v.vx / speed;
    dragY = -aDrag * v.vy / speed;
    q = 500 * atm.rho * speed * speed; // kPa
  }
  v.q = q;

  var axT = dragX + thrustX / (props.mass * 1000);
  var ayT = dragY + thrustY / (props.mass * 1000);

  // Attitude is substepped so a 1s coast step cannot fling the nose around.
  var leftA = dt;
  while (leftA > 1e-8) {
    var hA = Math.min(0.05, leftA);
    var desiredW = pitch * OW.TUNE.MAX_ANG_RATE;
    var aCtrl = OW.clamp((desiredW - v.angVel) * 8, -OW.TUNE.MAX_ANG_ACC, OW.TUNE.MAX_ANG_ACC);
    if (Math.abs(pitch) < 0.04) aCtrl += -v.angVel * OW.TUNE.ANG_DAMP;
    var vAng = Math.atan2(v.vy, v.vx);
    var aoaNow = OW.wrapAngle(v.angle - vAng);
    var aeroT = 0;
    if (atm.rho > 0 && speed > 0.04) {
      // TUNABLE weathercock: settles a symmetric rocket, still loses to a hard yaw.
      aeroT = -aoaNow * q * 18;
    }
    var alpha = aCtrl + (torque + aeroT) / props.I;
    v.angVel += alpha * hA;
    v.angle = OW.wrapAngle(v.angle + v.angVel * hA);
    leftA -= hA;
  }
  v.aoa = OW.wrapAngle(v.angle - Math.atan2(v.vy, v.vx));
  v.q = q;

  // Velocity Verlet. Thrust and drag are held over the step; gravity is
  // resampled so multi-second coasts don't spiral into the planet.
  var g1x = aEx + aMx;
  var g1y = aEy + aMy;
  v.vx += (g1x + axT) * dt * 0.5;
  v.vy += (g1y + ayT) * dt * 0.5;
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  var r2 = v.x * v.x + v.y * v.y;
  var rr = Math.sqrt(r2) || 1;
  var moon2 = OW.moonState(world.t + dt, world.moon0);
  var dx2 = v.x - moon2.x;
  var dy2 = v.y - moon2.y;
  var m2 = dx2 * dx2 + dy2 * dy2;
  var mr = Math.sqrt(m2) || 1;
  var g2x = -OW.TUNE.MU_E * v.x / (r2 * rr) - OW.TUNE.MU_M * dx2 / (m2 * mr);
  var g2y = -OW.TUNE.MU_E * v.y / (r2 * rr) - OW.TUNE.MU_M * dy2 / (m2 * mr);
  v.vx += (g2x + axT) * dt * 0.5;
  v.vy += (g2y + ayT) * dt * 0.5;

  // Surface contact against Earth and Moon.
  props = OW.vehicleMassProps(v);
  var foot = lowestPoint(v, props);
  resolveBody(v, world, props, foot, dt, moon);

  if (!v.result) checkOrbit(v, dt);
  if (!v.result && Math.hypot(v.x, v.y) > OW.TUNE.WORLD_LIMIT) {
    OW.finish(v, false, "飞得太远，任务中控失去追踪。");
  }
  if (!isFinite(v.x) || !isFinite(v.vx) || !isFinite(v.angle)) {
    OW.finish(v, false, "飞行数值失控，试飞中止。");
  }
  return v;
};

function resolveBody(v, world, props, foot, dt, moon) {
  if (!foot || v.result) return;
  var bodies = [
    { id: "earth", x: 0, y: 0, vx: 0, vy: 0, R: OW.TUNE.RE, mu: OW.TUNE.MU_E },
    { id: "moon", x: moon.x, y: moon.y, vx: moon.vx, vy: moon.vy, R: OW.TUNE.RM, mu: OW.TUNE.MU_M },
  ];
  for (var i = 0; i < bodies.length; i++) {
    var b = bodies[i];
    var dx = foot.x - b.x;
    var dy = foot.y - b.y;
    var dist = Math.hypot(dx, dy) || 1;
    var pen = b.R - dist;
    if (pen < 0) continue;
    var ux = dx / dist;
    var uy = dy / dist;
    // Push the whole craft out along the contact normal.
    v.x += ux * pen;
    v.y += uy * pen;
    foot.x += ux * pen;
    foot.y += uy * pen;
    var rvx = v.vx - b.vx;
    var rvy = v.vy - b.vy;
    var vrad = rvx * ux + rvy * uy; // outward positive
    var sink = -vrad; // m/s once * 1000... v is km/s, sink km/s
    var vtx = rvx - vrad * ux;
    var vty = rvy - vrad * uy;
    var vtan = Math.hypot(vtx, vty);
    var noseX = Math.cos(v.angle);
    var noseY = Math.sin(v.angle);
    var upright = Math.acos(OW.clamp(noseX * ux + noseY * uy, -1, 1));
    var legs = OW.hasLegs(v);
    var flying = v.maxAlt > 0.25 || (b.id === "moon" && v.ignited);
    var onPad = b.id === "earth" && !flying;

    if (!v.ignited && b.id === "earth") {
      // Rest on the pad, held upright.
      if (vrad < 0) {
        v.vx -= vrad * ux;
        v.vy -= vrad * uy;
      }
      v.vx *= Math.exp(-4 * dt);
      v.vy *= Math.exp(-4 * dt);
      v.angle = Math.atan2(uy, ux);
      v.angVel = 0;
      v.padTimeLow = 0;
      continue;
    }

    if (onPad && b.id === "earth") {
      if (vrad < 0) {
        v.vx -= vrad * ux;
        v.vy -= vrad * uy;
      }
      v.angVel *= Math.exp(-2 * dt);
      if (upright > OW.TUNE.TIP_PAD) {
        OW.finish(v, false, "火箭在发射台翻倒了。");
        return;
      }
      var twr = padTwr(v, props);
      if (twr < 1) v.padTimeLow += dt;
      else v.padTimeLow = 0;
      if (v.padTimeLow > OW.TUNE.PAD_TWR_TIME) {
        OW.finish(v, false, "推力扛不起重量——加引擎或减重。");
        return;
      }
      continue;
    }

    // Impact.
    if (vrad < 0) {
      v.vx -= vrad * ux;
      v.vy -= vrad * uy;
    }
    v.angVel *= 0.2;
    var safeSink = b.id === "moon" ? OW.TUNE.VSAFE : OW.TUNE.VSAFE_EARTH;
    var soft = legs && upright <= OW.TUNE.UPRIGHT && sink <= safeSink && vtan <= Math.max(0.008, safeSink * 3);
    var fuel = OW.fuelLeft(v);
    if (b.id === "moon") {
      if (soft) {
        v.landed = "moon";
        v.angVel = 0;
        v.angle = Math.atan2(uy, ux);
        // Inward radial was already removed. Kill the slide so a soft touch stays put.
        v.vx -= vtx;
        v.vy -= vty;
        if (world.mode === "sandbox") {
          v.landedHold = "moon";
          v.touchdown = "月面软着陆";
          return;
        }
        v.vx = b.vx;
        v.vy = b.vy;
        OW.finish(v, true, "月面软着陆成功！");
        return;
      }
      v.exploded = true;
      if (OW.DEBUG) {
        console.log("  moon impact sink", sink.toFixed(4), "vtan", vtan.toFixed(4), "uprightDeg", (upright * 180 / Math.PI).toFixed(1), "legs", legs);
      }
      if (!legs) OW.finish(v, false, "没装着陆架，月面直接撞毁了。");
      else if (upright > OW.TUNE.UPRIGHT) OW.finish(v, false, "月面没立直，火箭倒了。");
      else OW.finish(v, false, "月面垂速过大，着陆架没立住。");
      return;
    }
    // Earth.
    if (soft) {
      v.landed = "earth";
      v.angVel = 0;
      v.angle = Math.atan2(uy, ux);
      v.vx -= vtx;
      v.vy -= vty;
      if (world.mode === "sandbox") {
        v.landedHold = "earth";
        v.touchdown = "已在地球着陆";
        return;
      }
      OW.finish(v, false, "回到地球了，任务是去月球。");
      return;
    }
    v.exploded = true;
    if (fuel.fuel <= 0.02 && v.maxAlt > 20) OW.finish(v, false, "油烧干了，还没稳住轨道。");
    else if (!legs) OW.finish(v, false, "没装着陆架，回地面时撞毁了。");
    else OW.finish(v, false, "回地面时砸得太狠。");
    return;
  }

  // Dynamic pressure breakup. Vertical flight relaxes qMax.
  if (v.ignited && !v.landedHold) {
    var r = Math.hypot(v.x, v.y) || 1;
    var upDot = (Math.cos(v.angle) * v.x + Math.sin(v.angle) * v.y) / r;
    var tilt = Math.acos(OW.clamp(upDot, -1, 1));
    var qLim = OW.TUNE.QMAX * (tilt < OW.TUNE.Q_RELAX_TILT ? OW.TUNE.Q_RELAX : 1);
    if (v.q > qLim && Math.abs(v.aoa) > OW.TUNE.AOA_BREAK && hOf(v) < OW.TUNE.ATM_TOP) {
      v.exploded = true;
      OW.finish(v, false, "大气里速度太快还翻着，火箭散架了。");
    }
  }
}

function hOf(v) {
  return Math.hypot(v.x, v.y) - OW.TUNE.RE;
}

function padTwr(v, props) {
  var burns = OW.activeBurns(v);
  var T = 0;
  for (var i = 0; i < burns.burns.length; i++) {
    var def = OW.PARTS[burns.burns[i].part.partId];
    var throttle = burns.burns[i].srb ? 1 : v.throttle;
    T += OW.partPerf(def, 1).thrust * throttle;
  }
  return T / (props.mass * OW.TUNE.G_SURFACE);
}

function checkOrbit(v, dt) {
  if (v.orbitDone) return;
  var r = Math.hypot(v.x, v.y);
  var h = r - OW.TUNE.RE;
  // Low-orbit checkpoint only. A slow drift near the Moon can look
  // "circular" about the Earth and should not steal the banner.
  if (h < OW.TUNE.ORBIT_H || r > 80000) {
    v.orbitHold = 0;
    return;
  }
  var moon = null;
  // Caller already updated position. Use Earth-relative only; skip inside the Moon SOI.
  var fp = OW.flightPath(v.x, v.y, v.vx, v.vy);
  var vc = Math.sqrt(OW.TUNE.MU_E / r);
  var ratio = vc > 0 ? fp.v / vc : 0;
  var ok = Math.abs(fp.fpa) < OW.TUNE.ORBIT_FPA && ratio >= OW.TUNE.ORBIT_V_LO && ratio <= OW.TUNE.ORBIT_V_HI;
  if (ok) v.orbitHold += dt;
  else v.orbitHold = 0;
  if (v.orbitHold >= OW.TUNE.ORBIT_HOLD) v.orbitDone = true;
  moon = moon;
}

OW.telemetry = function (v, world) {
  var moon = OW.moonState(world.t, world.moon0);
  var r = Math.hypot(v.x, v.y);
  var fp = OW.flightPath(v.x, v.y, v.vx, v.vy);
  var kep = OW.kepler(v.x, v.y, v.vx, v.vy, OW.TUNE.MU_E);
  var mx = v.x - moon.x;
  var my = v.y - moon.y;
  var relVx = v.vx - moon.vx;
  var relVy = v.vy - moon.vy;
  var rm = Math.hypot(mx, my);
  var moonFp = OW.flightPath(mx, my, relVx, relVy);
  var inSoi = rm < OW.TUNE.SOI_M;
  var props = OW.vehicleMassProps(v);
  var burns = OW.activeBurns(v);
  var atm = OW.atmosphere(r - OW.TUNE.RE);
  var T = 0;
  for (var i = 0; i < burns.burns.length; i++) {
    var def = OW.PARTS[burns.burns[i].part.partId];
    var throttle = burns.burns[i].srb ? 1 : v.throttle;
    T += OW.partPerf(def, atm.s).thrust * throttle;
  }
  var gLocal;
  var alt;
  var vrad;
  if (inSoi) {
    gLocal = OW.TUNE.MU_M / (rm * rm) * 1000; // m/s²
    alt = rm - OW.TUNE.RM;
    vrad = moonFp.vrad;
  } else {
    gLocal = OW.TUNE.MU_E / (r * r) * 1000;
    alt = r - OW.TUNE.RE;
    vrad = fp.vrad;
  }
  var hover = T > 1 && v.throttle >= 0 ? (props.mass * gLocal) / (T / Math.max(v.throttle, 0.001) || 1) : 0;
  // T is current thrust (already * throttle). Full thrust:
  var Tfull = 0;
  for (var k = 0; k < burns.burns.length; k++) {
    if (burns.burns[k].srb) continue;
    var d2 = OW.PARTS[burns.burns[k].part.partId];
    Tfull += OW.partPerf(d2, atm.s).thrust;
  }
  var hoverThrottle = Tfull > 1 ? OW.clamp((props.mass * gLocal) / Tfull, 0, 1) : 0;
  var fuel = OW.fuelLeft(v);
  var win = transferWindow(v, world);
  return {
    altEarth: r - OW.TUNE.RE,
    altMoon: rm - OW.TUNE.RM,
    alt: alt,
    body: inSoi ? "moon" : "earth",
    bodyName: inSoi ? "月球" : "地球",
    vrad: vrad,
    vt: inSoi ? moonFp.vt : fp.vt,
    speed: fp.v,
    fpa: fp.fpa,
    pe: kep.rp - OW.TUNE.RE,
    ap: isFinite(kep.ra) ? kep.ra - OW.TUNE.RE : Infinity,
    ecc: kep.e,
    q: v.q,
    aoa: v.aoa,
    throttle: v.throttle,
    twr: T / (props.mass * OW.TUNE.G_SURFACE),
    twrLocal: gLocal > 0 ? (T / props.mass) / gLocal : 0,
    fuelPct: fuel.pct,
    fuel: fuel.fuel,
    mass: props.mass,
    hoverThrottle: hoverThrottle,
    inSoi: inSoi,
    window: win,
    vc: Math.sqrt(OW.TUNE.MU_E / r),
    gLocal: gLocal,
    T: T,
    orbitHold: v.orbitHold,
    orbitDone: v.orbitDone,
    upright: uprightAngle(v, inSoi ? { x: mx, y: my } : { x: v.x, y: v.y }),
  };
};

function uprightAngle(v, upVec) {
  var u = Math.hypot(upVec.x, upVec.y) || 1;
  var dot = (Math.cos(v.angle) * upVec.x + Math.sin(v.angle) * upVec.y) / u;
  return Math.acos(OW.clamp(dot, -1, 1));
}

function transferWindow(v, world) {
  var moon = OW.moonState(world.t, world.moon0);
  var ca = Math.atan2(v.y, v.x);
  var ma = Math.atan2(moon.y, moon.x);
  var h = v.x * v.vy - v.y * v.vx;
  var dir = h >= 0 ? 1 : -1;
  var lead = OW.wrapAngle(dir * (ma - ca));
  if (lead < 0) lead += Math.PI * 2;
  var r = Math.hypot(v.x, v.y);
  // Hohmann-style lead: the ship travels ~180° while the Moon moves ω·t,
  // so the Moon should start at π − ωt ahead. ±WINDOW_HALF is the loose HUD cue.
  var aT = (r + OW.TUNE.EARTH_MOON_DIST) / 2;
  var tHalf = Math.PI * Math.sqrt(Math.max(1, aT * aT * aT / OW.TUNE.MU_E));
  var ideal = Math.PI - OW.moonOmega() * tHalf;
  if (ideal < 0) ideal += Math.PI * 2;
  var err = OW.wrapAngle(lead - ideal);
  var useful = r - OW.TUNE.RE > 90 && r < OW.TUNE.SOI_M;
  return {
    lead: lead,
    err: err,
    open: useful && Math.abs(err) < OW.TUNE.WINDOW_HALF,
    useful: useful,
  };
}

OW.effectiveWarp = function (v, world, requested) {
  if (!v || !v.ignited || v.result || v.landedHold) return 1;
  var tel = OW.telemetry(v, world);
  var hE = tel.altEarth;
  var hM = tel.altMoon;
  var inSpace = hE > OW.TUNE.ATM_TOP || tel.inSoi;
  var want = requested || 1;
  // Safety caps so a fast coast cannot skip the surface.
  var cap = OW.TUNE.COAST_WARP;
  if (hM < 5 || (hE < 80 && tel.vrad < 0.02)) cap = 1;
  else if (hM < 40 || hE < 140) cap = 5;
  else if (hM < 400 || (hE < 600 && tel.vrad < 0)) cap = 25;

  if (want >= OW.TUNE.COAST_WARP) {
    var deep = hE > 180 && hM > 80 && v.throttle <= 0.02 && inSpace;
    if (!deep) want = 25;
  }
  if (want >= 25) {
    if (!(inSpace && v.throttle <= 0.02)) want = 1;
  } else if (want >= 5) {
    var slow = Math.hypot(v.vx, v.vy) < 0.2;
    var allow = hE >= OW.TUNE.ATM_TOP || slow;
    if (!allow || hE < 0.05) want = 1;
  }
  if (want > cap) want = cap;
  return want;
};

OW.cloneVehicle = function (v) {
  return {
    x: v.x, y: v.y, vx: v.vx, vy: v.vy,
    angle: v.angle, angVel: v.angVel,
    throttle: v.throttle, ignited: v.ignited,
    parts: v.parts.map(function (p) {
      return {
        uid: p.uid, partId: p.partId, role: p.role, stackIndex: p.stackIndex,
        side: p.side, hostUid: p.hostUid, x: p.x, y: p.y, w: p.w, h: p.h,
        fuel: p.fuel, fuelMax: p.fuelMax, alive: p.alive, kind: p.kind, stage: p.stage,
      };
    }),
    orbitHold: v.orbitHold, orbitDone: v.orbitDone, maxAlt: v.maxAlt,
    maxAltMoon: v.maxAltMoon, minMoonDist: v.minMoonDist,
    result: null, landed: null, landedHold: null, padTimeLow: 0, q: v.q, aoa: v.aoa,
    fuelEmptyTimer: 0, stageFlash: "", exploded: false,
  };
};

function gravAccel(x, y, t, moon0) {
  var r2 = x * x + y * y;
  var r = Math.sqrt(r2) || 1;
  var moon = OW.moonState(t, moon0);
  var dx = x - moon.x;
  var dy = y - moon.y;
  var m2 = dx * dx + dy * dy;
  var m = Math.sqrt(m2) || 1;
  return {
    ax: -OW.TUNE.MU_E * x / (r2 * r) - OW.TUNE.MU_M * dx / (m2 * m),
    ay: -OW.TUNE.MU_E * y / (r2 * r) - OW.TUNE.MU_M * dy / (m2 * m),
    moon: moon,
    r: r,
    rm: m,
  };
}

// Point-mass coast (and a short powered extrapolate). Capped at ~180 samples
// so the map line stays cheap. Powered legs are 30s; coasts run out to about
// one orbit, or a few days when the ellipse already reaches toward the Moon.
OW.predict = function (v, world) {
  var props = OW.vehicleMassProps(v);
  var fuel = OW.fuelLeft(v);
  var powered = !!(v.ignited && v.throttle > 0.04 && fuel.fuel > 0.01);
  var kep = OW.kepler(v.x, v.y, v.vx, v.vy, OW.TUNE.MU_E);
  var T = 0;
  if (powered) {
    var burns = OW.activeBurns(v);
    var atm = OW.atmosphere(Math.hypot(v.x, v.y) - OW.TUNE.RE);
    for (var i = 0; i < burns.burns.length; i++) {
      var def = OW.PARTS[burns.burns[i].part.partId];
      var throttle = burns.burns[i].srb ? 1 : v.throttle;
      T += OW.partPerf(def, atm.s).thrust * throttle;
    }
  }
  var tax = powered ? Math.cos(v.angle) * T / (props.mass * 1000) : 0;
  var tay = powered ? Math.sin(v.angle) * T / (props.mass * 1000) : 0;
  var horizon = 30;
  if (!powered) {
    var period = 5400;
    if (kep.energy < 0 && isFinite(kep.a) && kep.a > 0) {
      period = 2 * Math.PI * Math.sqrt(kep.a * kep.a * kep.a / OW.TUNE.MU_E);
    }
    horizon = Math.min(Math.max(period * 0.9, 800), 14000);
    // A high ellipse needs the line to actually reach the Moon, not just the next few minutes.
    if (isFinite(kep.ra) && kep.ra > 50000) horizon = 3.4 * 86400;
  }
  var x = v.x;
  var y = v.y;
  var vx = v.vx;
  var vy = v.vy;
  var t = world.t;
  var path = [{ x: x, y: y }];
  var minMoon = Infinity;
  var elapsed = 0;
  var samples = 180;
  var guard = 0;
  var sinceDraw = 0;
  while (elapsed < horizon - 0.1 && guard < 5000 && path.length < samples) {
    guard++;
    var g = gravAccel(x, y, t, world.moon0);
    var altE = g.r - OW.TUNE.RE;
    var altM = g.rm - OW.TUNE.RM;
    var remain = horizon - elapsed;
    var slicesLeft = Math.max(1, samples - path.length);
    var dt = powered ? remain / slicesLeft : altE < 400 || altM < 400 ? 4 : altE < 6000 || altM < 12000 ? 25 : Math.min(remain, Math.max(80, remain / slicesLeft));
    if (dt > remain) dt = remain;
    if (dt < 0.05) break;
    var ax1 = g.ax + tax;
    var ay1 = g.ay + tay;
    var mx = x + vx * dt;
    var my = y + vy * dt;
    var g2 = gravAccel(mx, my, t + dt, world.moon0);
    vx += (ax1 + g2.ax + tax) * 0.5 * dt;
    vy += (ay1 + g2.ay + tay) * 0.5 * dt;
    x = mx;
    y = my;
    t += dt;
    elapsed += dt;
    sinceDraw += dt;
    if (g2.rm < minMoon) minMoon = g2.rm;
    var stride = horizon / samples;
    if (sinceDraw >= stride * 0.65 || g2.r < OW.TUNE.RE || g2.rm < OW.TUNE.RM) {
      path.push({ x: x, y: y });
      sinceDraw = 0;
    }
    if (g2.r < OW.TUNE.RE || g2.rm < OW.TUNE.RM) break;
  }
  var ellipse = null;
  if (!powered && kep.energy < 0 && kep.e < 0.98 && isFinite(kep.a)) {
    ellipse = sampleEllipse(v, kep);
  }
  return { path: path, ellipse: ellipse, minMoon: minMoon, powered: powered };
};

function sampleEllipse(v, kep) {
  // True anomaly from the eccentricity vector.
  var rx = v.x;
  var ry = v.y;
  var r = kep.r || Math.hypot(rx, ry);
  var mu = OW.TUNE.MU_E;
  var ex = ((v.vy * v.vy + v.vx * v.vx) * rx / mu - (rx * v.vx + ry * v.vy) * v.vx / mu) - rx / r;
  // Standard e-vector: ((v²-μ/r)r - (r·v)v) / μ
  var rv = rx * v.vx + ry * v.vy;
  var v2 = v.vx * v.vx + v.vy * v.vy;
  ex = ((v2 - mu / r) * rx - rv * v.vx) / mu;
  var ey = ((v2 - mu / r) * ry - rv * v.vy) / mu;
  var eang = Math.atan2(ey, ex);
  var pts = [];
  var N = 160;
  for (var i = 0; i <= N; i++) {
    var th = eang + (i / N) * Math.PI * 2;
    var rad = (kep.a * (1 - kep.e * kep.e)) / (1 + kep.e * Math.cos(th - eang));
    if (rad < OW.TUNE.RE) continue;
    pts.push({ x: rad * Math.cos(th), y: rad * Math.sin(th) });
  }
  return pts;
}

OW.substepFor = function (v, world) {
  var r = Math.hypot(v.x, v.y) - OW.TUNE.RE;
  var moon = OW.moonState(world.t, world.moon0);
  var hm = Math.hypot(v.x - moon.x, v.y - moon.y) - OW.TUNE.RM;
  var alt = Math.min(r, hm);
  if (!v.ignited || alt < 120) return OW.TUNE.SUBSTEP_NEAR;
  if (alt < 2500) return 0.25;
  return OW.TUNE.SUBSTEP_FAR;
};
