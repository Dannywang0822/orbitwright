// Hangar craft: vertical stack (index 0 = bottom) + side boosters.
// Fuel rule: an engine drinks contiguous tanks above it until the next engine.
// Default jettison: all SRBs first, then each core stage from the bottom.

OW.uid = 1;
OW.nextUid = function () {
  OW.uid += 1;
  return "p" + OW.uid;
};

OW.emptyCraft = function () {
  return { stack: [], boosters: [] };
};

OW.templates = {
  starter: {
    name: "新手船",
    blurb: "入轨练习：腿 + 主发动机 + 燃料箱 M + S + 指令舱，两侧固体助推",
    stack: ["leg_basic", "eng_main", "tank_m", "tank_s", "cmd_mk1"],
    boosters: [
      { host: 2, side: -1 },
      { host: 2, side: 1 },
    ],
  },
  moon: {
    name: "奔月船",
    blurb: "多加一箱 M，入轨之后还留得下奔月的油",
    stack: ["leg_basic", "eng_main", "tank_m", "tank_m", "tank_s", "cmd_mk1"],
    boosters: [
      { host: 2, side: -1 },
      { host: 2, side: 1 },
    ],
  },
};

OW.craftFromTemplate = function (key) {
  var t = OW.templates[key];
  var craft = OW.emptyCraft();
  if (!t) return craft;
  for (var i = 0; i < t.stack.length; i++) {
    craft.stack.push({ uid: OW.nextUid(), partId: t.stack[i] });
  }
  for (var j = 0; j < t.boosters.length; j++) {
    var b = t.boosters[j];
    var host = craft.stack[b.host];
    if (!host) continue;
    craft.boosters.push({
      uid: OW.nextUid(),
      partId: "boost_srb",
      hostUid: host.uid,
      side: b.side,
    });
  }
  return craft;
};

OW.cloneCraft = function (craft) {
  return {
    stack: craft.stack.map(function (p) {
      return { uid: p.uid, partId: p.partId };
    }),
    boosters: craft.boosters.map(function (b) {
      return { uid: b.uid, partId: b.partId, hostUid: b.hostUid, side: b.side };
    }),
  };
};

OW.serializeCraft = function (craft) {
  return JSON.stringify({
    stack: craft.stack.map(function (p) { return p.partId; }),
    boosters: craft.boosters.map(function (b) {
      var host = -1;
      for (var i = 0; i < craft.stack.length; i++) {
        if (craft.stack[i].uid === b.hostUid) host = i;
      }
      return { host: host, side: b.side };
    }),
  });
};

OW.craftFromJSON = function (raw, save) {
  var craft = OW.emptyCraft();
  var data = raw;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch (e) { return craft; }
  }
  if (!data || !data.stack) return craft;
  for (var i = 0; i < data.stack.length && i < OW.STACK_LIMIT; i++) {
    var id = data.stack[i];
    if (!OW.PARTS[id]) continue;
    if (!OW.partUnlocked(id, save)) continue;
    if (id === "boost_srb") continue;
    craft.stack.push({ uid: OW.nextUid(), partId: id });
  }
  var boosters = data.boosters || [];
  for (var j = 0; j < boosters.length && craft.boosters.length < OW.BOOSTER_LIMIT; j++) {
    var b = boosters[j];
    var host = craft.stack[b.host];
    if (!host) continue;
    var hk = OW.PARTS[host.partId].kind;
    if (hk !== "tank" && hk !== "engine") continue;
    var dup = craft.boosters.some(function (x) {
      return x.hostUid === host.uid && x.side === b.side;
    });
    if (dup) continue;
    craft.boosters.push({
      uid: OW.nextUid(),
      partId: "boost_srb",
      hostUid: host.uid,
      side: b.side < 0 ? -1 : 1,
    });
  }
  return craft;
};

function kindOf(partId) {
  return OW.PARTS[partId] ? OW.PARTS[partId].kind : "";
}

OW.enginePlan = function (stack) {
  var plan = [];
  for (var i = 0; i < stack.length; i++) {
    if (kindOf(stack[i].partId) !== "engine") continue;
    var tanks = [];
    for (var j = i + 1; j < stack.length; j++) {
      var k = kindOf(stack[j].partId);
      if (k === "engine") break;
      if (k === "tank") tanks.push(stack[j]);
      else break;
    }
    plan.push({ index: i, engine: stack[i], tanks: tanks });
  }
  return plan;
};

// Jettison groups, first to drop first. Command is never in a group.
OW.stageGroups = function (craft) {
  var groups = [];
  if (craft.boosters.length) {
    groups.push({
      name: "固体助推",
      uids: craft.boosters.map(function (b) { return b.uid; }),
    });
  }
  var plan = OW.enginePlan(craft.stack);
  for (var n = 0; n < plan.length; n++) {
    var uids = [];
    var eng = plan[n];
    var lower = n === 0 ? 0 : plan[n - 1].index + 1;
    // Lowest stage also takes the legs (and anything) sitting under the engine.
    var from = n === 0 ? 0 : eng.index;
    for (var i = from; i <= eng.index; i++) {
      if (kindOf(craft.stack[i].partId) === "command") continue;
      uids.push(craft.stack[i].uid);
    }
    // Silence unused warning if a middle engine somehow has parts under it
    // that belong to the previous stage — those were already claimed.
    if (n > 0) {
      uids = [eng.engine.uid];
    }
    for (var t = 0; t < eng.tanks.length; t++) uids.push(eng.tanks[t].uid);
    groups.push({ name: n === 0 ? "芯级" : "上面级", uids: uids, from: lower });
  }
  return groups;
};

OW.layoutCraft = function (craft, opts) {
  opts = opts || {};
  var fuelMode = opts.fuel === "empty" ? "empty" : "full";
  var parts = [];
  var y = 0;
  for (var i = 0; i < craft.stack.length; i++) {
    var inst = craft.stack[i];
    var def = OW.PARTS[inst.partId];
    var fuelMax = def.fuel || 0;
    var fuel = fuelMode === "empty" ? 0 : fuelMax;
    var mass = def.mDry + fuel;
    var cy = y + def.h / 2;
    parts.push({
      uid: inst.uid,
      partId: inst.partId,
      role: "stack",
      stackIndex: i,
      side: 0,
      hostUid: null,
      x: 0,
      y: cy,
      w: def.w,
      h: def.h,
      fuel: fuel,
      fuelMax: fuelMax,
      mass: mass,
      kind: def.kind,
    });
    y += def.h;
  }
  var height = y;
  for (var b = 0; b < craft.boosters.length; b++) {
    var bo = craft.boosters[b];
    var defB = OW.PARTS[bo.partId];
    var host = null;
    for (var k = 0; k < parts.length; k++) if (parts[k].uid === bo.hostUid) host = parts[k];
    if (!host) continue;
    var fuelB = fuelMode === "empty" ? 0 : defB.fuel;
    var side = bo.side < 0 ? -1 : 1;
    parts.push({
      uid: bo.uid,
      partId: bo.partId,
      role: "booster",
      stackIndex: host.stackIndex,
      side: side,
      hostUid: bo.hostUid,
      x: side * (host.w / 2 + defB.w / 2 + 0.35),
      y: host.y - host.h / 2 + defB.h / 2,
      w: defB.w,
      h: defB.h,
      fuel: fuelB,
      fuelMax: defB.fuel,
      mass: defB.mDry + fuelB,
      kind: "booster",
    });
  }

  var mass = 0;
  var cx = 0;
  var cy = 0;
  for (var p = 0; p < parts.length; p++) {
    mass += parts[p].mass;
    cx += parts[p].mass * parts[p].x;
    cy += parts[p].mass * parts[p].y;
  }
  var com = mass > 0 ? { x: cx / mass, y: cy / mass } : { x: 0, y: 0 };

  var groups = OW.stageGroups(craft);
  var stageOf = {};
  for (var g = 0; g < groups.length; g++) {
    for (var u = 0; u < groups[g].uids.length; u++) stageOf[groups[g].uids[u]] = g + 1;
  }
  for (var q = 0; q < parts.length; q++) parts[q].stage = stageOf[parts[q].uid] || 0;

  return {
    parts: parts,
    com: com,
    height: height,
    mass: mass,
    groups: groups,
  };
};

OW.metrics = function (craft, fuelMode) {
  var layout = OW.layoutCraft(craft, { fuel: fuelMode || "full" });
  var full = fuelMode === "empty" ? OW.layoutCraft(craft, { fuel: "full" }) : layout;
  var plan = OW.enginePlan(craft.stack);
  var Tsl = 0;
  var Tvac = 0;
  // Pad-lit engines: boosters + the lowest core engine.
  for (var i = 0; i < craft.boosters.length; i++) {
    var bd = OW.PARTS[craft.boosters[i].partId];
    Tsl += OW.partPerf(bd, 1).thrust;
    Tvac += OW.partPerf(bd, 0).thrust;
  }
  if (plan.length) {
    var ed = OW.PARTS[plan[0].engine.partId];
    Tsl += OW.partPerf(ed, 1).thrust;
    Tvac += OW.partPerf(ed, 0).thrust;
  }
  var mFull = 0;
  var layFull = OW.layoutCraft(craft, { fuel: "full" });
  mFull = layFull.mass;
  var mShow = layout.mass;
  var twr = mShow > 0 ? Tsl / (mShow * OW.TUNE.G_SURFACE) : 0;
  var dv = OW.estimateDeltaV(craft);
  var offset = Math.abs(layout.com.x);
  var stab = "good";
  if (layout.height > 0 && offset > 0.28 * layout.height) stab = "bad";
  else if (layout.height > 0 && offset > 0.15 * layout.height) stab = "warn";
  var left = false;
  var right = false;
  for (var b = 0; b < craft.boosters.length; b++) {
    if (craft.boosters[b].side < 0) left = true;
    else right = true;
  }
  var unpaired = craft.boosters.length > 0 && left !== right;
  if (unpaired && stab === "good") stab = "warn";

  var errors = [];
  var warnings = [];
  if (!craft.stack.length) errors.push("主栈是空的");
  var cmds = craft.stack.filter(function (p) { return kindOf(p.partId) === "command"; });
  if (cmds.length === 0) errors.push("需要一个指令舱，放在最顶端");
  if (cmds.length > 1) errors.push("只能有一个指令舱");
  if (cmds.length === 1 && kindOf(craft.stack[craft.stack.length - 1].partId) !== "command") {
    errors.push("指令舱必须在主栈最顶端");
  }
  var legs = craft.stack.filter(function (p) { return kindOf(p.partId) === "legs"; });
  if (legs.length && kindOf(craft.stack[0].partId) !== "legs") errors.push("着陆架只能在最底部");
  if (legs.length > 1) errors.push("着陆架只能有一组");
  var hasEng = plan.length > 0 || craft.boosters.length > 0;
  if (!hasEng) errors.push("至少需要一台发动机或助推");
  if (craft.stack.length && !legs.length) warnings.push("没装着陆架，落月会撞毁");
  if (plan.length) {
    var dryEng = plan.some(function (e) {
      return e.tanks.every(function (t) { return !(OW.PARTS[t.partId].fuel > 0); });
    });
    var anyFuel = plan.some(function (e) {
      return e.tanks.some(function (t) { return OW.PARTS[t.partId].fuel > 0; });
    });
    if (!anyFuel && !craft.boosters.length) warnings.push("发动机没有连到油箱");
    if (dryEng && anyFuel) warnings.push("有发动机没连到自己的油箱");
  }
  if (twr > 0 && twr < 1.05) warnings.push("推重不足，离不了地");
  if (stab === "warn") warnings.push(unpaired ? "单侧助推，容易偏航" : "质心偏了，易翻");
  if (stab === "bad") warnings.push("极不稳，推力线对不齐质心");

  var twrClass = twr >= 1.3 ? "good" : twr >= 1.05 ? "mid" : "bad";
  return {
    layout: layout,
    mass: mShow,
    massFull: mFull,
    Tsl: Tsl,
    Tvac: Tvac,
    twr: twr,
    twrClass: twrClass,
    dvAtm: dv.atm,
    dvVac: dv.vac,
    dvTotal: dv.total,
    stab: stab,
    stabText: stab === "good" ? "稳" : stab === "warn" ? "易翻" : "极不稳",
    offset: offset,
    height: layout.height,
    errors: errors,
    warnings: warnings,
    ok: errors.length === 0 && craft.stack.length > 0,
    groups: layout.groups,
    unpaired: unpaired,
  };
};

OW.estimateDeltaV = function (craft) {
  // Abstract burn, full tanks. First segment (SRBs still attached, or the
  // first slice of a single stage) uses sea level; the rest uses vacuum.
  var stack = craft.stack.map(function (p) {
    var d = OW.PARTS[p.partId];
    return { uid: p.uid, partId: p.partId, fuel: d.fuel || 0, alive: true };
  });
  var boosters = craft.boosters.map(function (b) {
    var d = OW.PARTS[b.partId];
    return { uid: b.uid, partId: b.partId, fuel: d.fuel || 0, alive: true };
  });
  var atm = 0;
  var vac = 0;
  var phase = "atm";
  var firstFuel = 0;
  var plan0 = OW.enginePlan(stack);
  if (plan0.length) {
    for (var i = 0; i < plan0[0].tanks.length; i++) firstFuel += plan0[0].tanks[i].fuel;
  }
  var burnedFirst = 0;
  var hadBooster = boosters.length > 0;
  for (var step = 0; step < 20000; step++) {
    var plan = OW.enginePlan(stack.filter(function (p) { return p.alive; }));
    // enginePlan expects stack objects; dead parts should already be gone.
    var aliveStack = stack.filter(function (p) { return p.alive; });
    plan = OW.enginePlan(aliveStack);
    var burning = [];
    for (var b = 0; b < boosters.length; b++) {
      if (boosters[b].alive && boosters[b].fuel > 1e-6) burning.push({ item: boosters[b], tanks: null });
    }
    var eng = null;
    if (plan.length) {
      var tanks = plan[0].tanks;
      var fuel = 0;
      for (var t = 0; t < tanks.length; t++) fuel += tanks[t].fuel;
      if (fuel > 1e-6) {
        eng = plan[0];
        burning.push({ item: plan[0].engine, tanks: tanks });
      } else if (!burning.length) {
        // Drop the dry lowest stage and continue with the next engine.
        dropLowest(aliveStack, boosters, plan[0]);
        continue;
      }
    }
    if (!burning.length) break;
    var s = phase === "atm" ? 1 : 0;
    var thrust = 0;
    var mdot = 0;
    for (var k = 0; k < burning.length; k++) {
      var perf = OW.partPerf(OW.PARTS[burning[k].item.partId], s);
      var throttle = 1;
      thrust += perf.thrust * throttle;
      mdot += perf.mdot * throttle;
    }
    if (!(mdot > 0) || !(thrust > 0)) break;
    var mass = 0;
    for (var a = 0; a < stack.length; a++) if (stack[a].alive) {
      var sd = OW.PARTS[stack[a].partId];
      mass += sd.mDry + stack[a].fuel;
    }
    for (var c = 0; c < boosters.length; c++) if (boosters[c].alive) {
      var bd = OW.PARTS[boosters[c].partId];
      mass += bd.mDry + boosters[c].fuel;
    }
    var fuelLeft = 0;
    for (var f = 0; f < burning.length; f++) {
      if (burning[f].tanks) {
        for (var u = 0; u < burning[f].tanks.length; u++) fuelLeft += burning[f].tanks[u].fuel;
      } else fuelLeft += burning[f].item.fuel;
    }
    var dt = Math.min(0.25, Math.max(0.01, fuelLeft / mdot));
    if (fuelLeft < mdot * dt) dt = fuelLeft / mdot;
    var m1 = mass - mdot * dt;
    if (!(m1 > 0.05)) break;
    var ddv = (thrust / mdot) * Math.log(mass / m1);
    if (phase === "atm") atm += ddv;
    else vac += ddv;
    // Consume.
    var need = mdot * dt;
    // Split need across burning items by their mdot share.
    for (var n = 0; n < burning.length; n++) {
      var share = OW.partPerf(OW.PARTS[burning[n].item.partId], s).mdot * dt;
      if (burning[n].tanks) {
        var left = share;
        var before = 0;
        for (var r = 0; r < burning[n].tanks.length; r++) before += burning[n].tanks[r].fuel;
        for (var r2 = 0; r2 < burning[n].tanks.length && left > 0; r2++) {
          var take = Math.min(burning[n].tanks[r2].fuel, left);
          burning[n].tanks[r2].fuel -= take;
          left -= take;
        }
        burnedFirst += before - (before - share + left);
      } else {
        burning[n].item.fuel = Math.max(0, burning[n].item.fuel - share);
      }
    }
    var boostersLive = boosters.some(function (x) { return x.alive && x.fuel > 1e-4; });
    if (hadBooster && !boostersLive) phase = "vac";
    if (!hadBooster && firstFuel > 0 && burnedFirst > firstFuel * 0.2) phase = "vac";
    // Drop spent boosters' mass only when empty — they stay as dead weight until
    // the player stages. The estimate assumes you stage boosters when they burn out,
    // then stage a core engine when its tanks are empty.
    if (hadBooster && !boostersLive) {
      for (var z = 0; z < boosters.length; z++) boosters[z].alive = false;
      hadBooster = false;
    }
    if (eng) {
      var leftFuel = 0;
      for (var q = 0; q < eng.tanks.length; q++) leftFuel += eng.tanks[q].fuel;
      if (leftFuel <= 1e-4) dropLowest(stack, boosters, eng);
    }
  }
  return { atm: atm, vac: vac, total: atm + vac };
};

function dropLowest(stack, boosters, eng) {
  var drop = {};
  drop[eng.engine.uid] = true;
  for (var i = 0; i < eng.tanks.length; i++) drop[eng.tanks[i].uid] = true;
  // Legs and anything at or below the engine that isn't a later stage.
  var idx = -1;
  for (var s = 0; s < stack.length; s++) if (stack[s].uid === eng.engine.uid) idx = s;
  for (var j = 0; j <= idx; j++) {
    if (stack[j].alive && kindOf(stack[j].partId) !== "command") drop[stack[j].uid] = true;
  }
  for (var k = 0; k < stack.length; k++) if (drop[stack[k].uid]) stack[k].alive = false;
}

OW.canPlace = function (craft, partId, action, save) {
  var def = OW.PARTS[partId];
  if (!def) return "没有这种零件";
  if (!OW.partUnlocked(partId, save)) return OW.unlockHint(partId);
  if (action.op === "side") {
    if (def.kind !== "booster") return "这里只能侧挂助推";
    if (craft.boosters.length >= OW.BOOSTER_LIMIT) return "助推已经挂满了";
    var host = null;
    for (var i = 0; i < craft.stack.length; i++) if (craft.stack[i].uid === action.hostUid) host = craft.stack[i];
    if (!host) return "找不到挂点";
    var hk = kindOf(host.partId);
    if (hk !== "tank" && hk !== "engine") return "助推要挂在油箱或发动机侧面";
    var side = action.side < 0 ? -1 : 1;
    for (var b = 0; b < craft.boosters.length; b++) {
      if (craft.boosters[b].hostUid === host.uid && craft.boosters[b].side === side) return "这一侧已经有助推";
    }
    return "";
  }
  if (craft.stack.length >= OW.STACK_LIMIT && action.op !== "root") return "主栈已满";
  if (def.kind === "booster") return "助推只能侧挂";
  if (action.op === "root") {
    if (craft.stack.length) return "主栈已经有零件了";
    return "";
  }
  if (action.op === "insert") {
    var index = action.index;
    if (index < 0 || index > craft.stack.length) return "挂不上";
    if (def.kind === "command") {
      if (craft.stack.some(function (p) { return kindOf(p.partId) === "command"; })) return "只能有一个指令舱";
      if (index !== craft.stack.length) return "指令舱只能放在最顶端";
    }
    if (def.kind === "legs") {
      if (craft.stack.some(function (p) { return kindOf(p.partId) === "legs"; })) return "着陆架只能有一组";
      if (index !== 0) return "着陆架只能放在最底部";
    }
    if (def.kind !== "command" && index === craft.stack.length &&
        craft.stack.length && kindOf(craft.stack[craft.stack.length - 1].partId) === "command") {
      return "指令舱上方不能再堆";
    }
    // Inserting below the top is fine; command stays on top if we don't insert past it.
    if (def.kind !== "command" && def.kind !== "legs") {
      var cmdAt = -1;
      for (var c = 0; c < craft.stack.length; c++) if (kindOf(craft.stack[c].partId) === "command") cmdAt = c;
      if (cmdAt >= 0 && index > cmdAt) return "指令舱必须留在最顶端";
    }
    return "";
  }
  return "不能放在这里";
};

OW.placePart = function (craft, partId, action, save) {
  var err = OW.canPlace(craft, partId, action, save);
  if (err) return err;
  if (action.op === "side") {
    craft.boosters.push({
      uid: OW.nextUid(),
      partId: "boost_srb",
      hostUid: action.hostUid,
      side: action.side < 0 ? -1 : 1,
    });
    return "";
  }
  var inst = { uid: OW.nextUid(), partId: partId };
  if (action.op === "root") craft.stack = [inst];
  else craft.stack.splice(action.index, 0, inst);
  return "";
};

OW.removePart = function (craft, uid) {
  var before = craft.stack.length;
  craft.stack = craft.stack.filter(function (p) { return p.uid !== uid; });
  craft.boosters = craft.boosters.filter(function (b) { return b.uid !== uid && b.hostUid !== uid; });
  return craft.stack.length !== before || true;
};

OW.socketsFor = function (craft, save, selectedId) {
  var layout = OW.layoutCraft(craft, { fuel: "full" });
  var sockets = [];
  function add(sock) {
    sock.ok = !selectedId || OW.canPlace(craft, selectedId, sock.action, save) === "";
    sockets.push(sock);
  }
  if (!craft.stack.length) {
    add({ id: "root", x: 0, y: 1.2, action: { op: "root" }, label: "+" });
    return { layout: layout, sockets: sockets };
  }
  var stack = craft.stack;
  var top = layout.parts.filter(function (p) { return p.role === "stack"; });
  // Insert slots: 0..length (0 below bottom, length above top).
  for (var i = 0; i <= stack.length; i++) {
    var y = 0;
    if (i === 0) y = -0.7;
    else {
      var below = top[i - 1];
      y = below.y + below.h / 2 + 0.15;
      if (i < stack.length) {
        var above = top[i];
        y = (below.y + below.h / 2 + above.y - above.h / 2) / 2;
      }
    }
    add({ id: "ins" + i, x: 0, y: y, action: { op: "insert", index: i }, label: "+" });
  }
  for (var p = 0; p < top.length; p++) {
    var part = top[p];
    if (part.kind !== "tank" && part.kind !== "engine") continue;
    for (var s = -1; s <= 1; s += 2) {
      var taken = craft.boosters.some(function (b) { return b.hostUid === part.uid && b.side === s; });
      if (taken) continue;
      add({
        id: "side" + part.uid + (s < 0 ? "L" : "R"),
        x: s * (part.w / 2 + 1.1),
        y: part.y,
        action: { op: "side", hostUid: part.uid, side: s },
        label: "侧",
      });
    }
  }
  return { layout: layout, sockets: sockets };
};
