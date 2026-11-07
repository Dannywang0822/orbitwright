// 星匠 Orbitwright — screens, input, and the flight loop.
(function () {
  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d");
  OW.draw.resize(canvas);
  OW.draw.loadSprites();

  var save = OW.loadSave();
  OW.audio.muted = save.settings.muted;

  var screen = "menu";
  var mode = "moon"; // moon mission | sandbox
  var craft = OW.emptyCraft();
  var fuelMode = "full";
  var cat = "pod";
  var selectedId = null;
  var selectedUid = null;
  var hangarCam = { x: 0, y: 4, ppm: 46 };

  var vehicle = null;
  var world = null;
  var mapMode = false;
  var mapCam = { x: 0, y: 0, ppm: 0.004, follow: true };
  var warpReq = 1;
  var paused = false;
  var prediction = null;
  var predAt = 0;
  var keys = {};
  var stick = 0;
  var toastTimer = 0;
  var bannerTimer = 0;
  var endTimer = 0;
  var stats = { maxAlt: 0 };

  var el = {
    menu: document.getElementById("screen-menu"),
    howto: document.getElementById("screen-howto"),
    hangar: document.getElementById("screen-hangar"),
    flight: document.getElementById("screen-flight"),
    pause: document.getElementById("screen-pause"),
    debrief: document.getElementById("screen-debrief"),
    sandbox: document.getElementById("btn-sandbox"),
    mute: document.getElementById("btn-mute"),
    partList: document.getElementById("part-list"),
    cats: document.getElementById("cats"),
    notes: document.getElementById("m-notes"),
    sel: document.getElementById("sel-label"),
    hint: document.getElementById("flight-hint"),
    hudL: document.getElementById("hud-left"),
    hudR: document.getElementById("hud-right"),
    warp: document.getElementById("warp-badge"),
    banner: document.getElementById("banner"),
    toast: document.getElementById("toast"),
    vs: document.getElementById("vs-bar"),
    vsMark: document.getElementById("vs-mark"),
  };

  function show(name) {
    screen = name;
    ["menu", "howto", "hangar", "flight", "pause", "debrief"].forEach(function (id) {
      document.getElementById("screen-" + id).classList.toggle("on", id === name);
    });
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add("on");
    toastTimer = 2.6;
  }

  function banner(text) {
    el.banner.textContent = text;
    el.banner.classList.add("on");
    bannerTimer = 4.2;
  }

  function refreshUnlocks() {
    el.sandbox.disabled = !save.moonCleared;
    el.sandbox.textContent = save.moonCleared ? "沙盒" : "沙盒（登月后解锁）";
    el.mute.textContent = OW.audio.muted ? "声音：关" : "声音：开";
  }

  function persist() {
    save.settings.muted = OW.audio.muted;
    OW.writeSave(save);
  }

  refreshUnlocks();

  // ----- menu -----
  document.getElementById("btn-moon").onclick = function () { openHangar("moon"); };
  el.sandbox.onclick = function () {
    if (!save.moonCleared) { toast("先完成一次登月"); return; }
    openHangar("sandbox");
  };
  document.getElementById("btn-howto").onclick = function () { show("howto"); };
  document.getElementById("btn-howto-back").onclick = function () { show("menu"); };
  el.mute.onclick = function () {
    OW.audio.muted = !OW.audio.muted;
    if (!OW.audio.muted) { OW.audio.ensure(); OW.audio.play("orbit"); }
    refreshUnlocks();
    persist();
  };

  // ----- hangar -----
  function openHangar(nextMode) {
    mode = nextMode;
    var draft = OW.loadDraft(save);
    craft = draft && draft.stack.length ? draft : OW.emptyCraft();
    selectedId = null;
    selectedUid = null;
    document.getElementById("hangar-title").textContent = mode === "sandbox" ? "沙盒组装" : "登月组装";
    buildPalette();
    show("hangar");
    refreshHangar();
  }

  function buildPalette() {
    el.cats.innerHTML = "";
    OW.CATS.forEach(function (c) {
      var b = document.createElement("button");
      b.textContent = c.name;
      b.className = c.id === cat ? "on" : "";
      b.onclick = function () { cat = c.id; buildPalette(); };
      el.cats.appendChild(b);
    });
    el.partList.innerHTML = "";
    OW.PART_ORDER.forEach(function (id) {
      var def = OW.PARTS[id];
      if (def.cat !== cat) return;
      var unlocked = OW.partUnlocked(id, save);
      var b = document.createElement("button");
      b.className = "part-btn" + (selectedId === id ? " on" : "") + (unlocked ? "" : " locked");
      var icon = OW.SPRITE_FILES[id]
        ? '<img class="part-icon" alt="" src="assets/parts/' + OW.SPRITE_FILES[id] + '?v=2">'
        : "";
      b.innerHTML = '<span><i class="swatch" style="background:' + def.color + '"></i>' + icon + def.name + "</span>";
      var iconEl = b.querySelector("img");
      if (iconEl) {
        iconEl.onload = function () {
          var sw = b.querySelector(".swatch");
          if (sw) sw.style.display = "none";
        };
        iconEl.onerror = function () { iconEl.remove(); };
      }
      if (!unlocked) {
        var lock = document.createElement("span");
        lock.textContent = "锁";
        b.appendChild(lock);
      }
      b.onclick = function () {
        if (!unlocked) { toast(OW.unlockHint(id)); return; }
        selectedId = selectedId === id ? null : id;
        selectedUid = null;
        buildPalette();
        refreshHangar();
      };
      el.partList.appendChild(b);
    });
  }

  function refreshHangar() {
    var m = OW.metrics(craft, fuelMode);
    document.getElementById("m-mass").textContent = m.mass.toFixed(2) + " t";
    document.getElementById("m-tsl").textContent = Math.round(m.Tsl) + " kN";
    document.getElementById("m-tvac").textContent = Math.round(m.Tvac) + " kN";
    var twr = document.getElementById("m-twr");
    twr.textContent = m.twr.toFixed(2);
    twr.className = m.twrClass === "good" ? "good" : m.twrClass === "mid" ? "warn" : "bad";
    document.getElementById("m-dva").textContent = Math.round(m.dvAtm) + " m/s";
    document.getElementById("m-dvv").textContent = Math.round(m.dvVac) + " m/s";
    document.getElementById("m-dvt").textContent = Math.round(m.dvTotal) + " m/s";
    var st = document.getElementById("m-stab");
    st.textContent = m.stabText;
    st.className = m.stab === "good" ? "good" : m.stab === "warn" ? "warn" : "bad";
    el.notes.innerHTML = "";
    m.errors.forEach(function (t) {
      var p = document.createElement("div");
      p.className = "msg bad";
      p.textContent = t;
      el.notes.appendChild(p);
    });
    m.warnings.forEach(function (t) {
      var p = document.createElement("div");
      p.className = "msg warn";
      p.textContent = t;
      el.notes.appendChild(p);
    });
    document.getElementById("btn-launch").disabled = !m.ok;
    document.getElementById("btn-remove").disabled = !selectedUid;
    var name = "点零件，再点金色吸附点";
    if (selectedId) name = "已选 " + OW.PARTS[selectedId].name + " · 点吸附点放下";
    if (selectedUid) name = "已选中零件 · 可以拆除";
    el.sel.textContent = name;
    document.getElementById("btn-fuel-mode").textContent = fuelMode === "full" ? "满油" : "空油";
    hangarCam.y = Math.max(3, m.height / 2);
    hangarCam.ppm = Math.min(64, Math.max(28, (OW.draw.h * 0.45) / Math.max(6, m.height + 2))) ;
  }

  document.getElementById("btn-hangar-back").onclick = function () { show("menu"); };
  document.getElementById("btn-fuel-mode").onclick = function () {
    fuelMode = fuelMode === "full" ? "empty" : "full";
    refreshHangar();
  };
  document.getElementById("btn-starter").onclick = function () { loadTemplate("starter"); };
  document.getElementById("btn-moonship").onclick = function () { loadTemplate("moon"); };
  document.getElementById("btn-clear").onclick = function () {
    craft = OW.emptyCraft();
    selectedUid = null;
    OW.writeDraft(craft);
    refreshHangar();
  };
  document.getElementById("btn-remove").onclick = function () {
    if (!selectedUid) return;
    OW.removePart(craft, selectedUid);
    selectedUid = null;
    OW.writeDraft(craft);
    refreshHangar();
  };
  document.getElementById("btn-launch").onclick = function () {
    var m = OW.metrics(craft, "full");
    if (!m.ok) {
      toast(m.errors[0] || "还不能发射");
      return;
    }
    OW.writeDraft(craft);
    startFlight();
  };

  function loadTemplate(key) {
    craft = OW.craftFromTemplate(key);
    selectedUid = null;
    OW.writeDraft(craft);
    refreshHangar();
    toast(OW.templates[key].name + "已装上");
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (screen !== "hangar") return;
    var rect = canvas.getBoundingClientRect();
    var px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    var py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    var hit = OW.draw.hitHangar(px, py, craft, save, selectedId, hangarCam);
    if (!hit) { selectedUid = null; refreshHangar(); return; }
    if (hit.type === "socket" && selectedId) {
      var err = OW.placePart(craft, selectedId, hit.socket.action, save);
      if (err) toast(err);
      else OW.writeDraft(craft);
      refreshHangar();
      return;
    }
    if (hit.type === "part") {
      selectedUid = hit.uid;
      selectedId = null;
      buildPalette();
      refreshHangar();
    }
  });

  // ----- flight -----
  function startFlight() {
    vehicle = OW.buildVehicle(OW.cloneCraft(craft));
    world = {
      t: 0,
      moon0: 1.15,
      mode: mode,
    };
    mapMode = false;
    mapCam.follow = true;
    mapCam.ppm = OW.draw.w / (OW.TUNE.RE * 18);
    warpReq = 1;
    paused = false;
    prediction = null;
    endTimer = 0;
    stats = { maxAlt: 0 };
    vehicle.touchdown = "";
    show("flight");
    document.getElementById("btn-ignite").style.display = "";
    toast("推油门，再按点火");
  }

  document.getElementById("btn-ignite").onclick = function () { ignite(); };
  document.getElementById("btn-stage").onclick = function () { doStage(); };
  document.getElementById("btn-cam").onclick = function () { toggleCam(); };
  document.getElementById("btn-warp").onclick = function () { cycleWarp(); };
  document.getElementById("btn-pause").onclick = function () { pauseGame(); };
  document.getElementById("btn-resume").onclick = function () { paused = false; show("flight"); };
  document.getElementById("btn-abort").onclick = function () { paused = false; openHangar(mode); };
  document.getElementById("btn-pause-menu").onclick = function () { paused = false; show("menu"); refreshUnlocks(); };
  document.getElementById("btn-retry").onclick = function () { openHangar(mode); };
  document.getElementById("btn-debrief-menu").onclick = function () { show("menu"); refreshUnlocks(); };
  document.getElementById("btn-debrief-sandbox").onclick = function () { openHangar("sandbox"); };

  function ignite() {
    if (!vehicle || vehicle.ignited || vehicle.result) return;
    if (vehicle.throttle <= 0.01) { toast("先把油门推起来再点火"); return; }
    vehicle.ignited = true;
    OW.audio.play("ignite");
    document.getElementById("btn-ignite").style.display = "none";
    toast("点火");
  }

  function doStage() {
    if (!vehicle || !vehicle.ignited || vehicle.result) return;
    var msg = OW.stageVehicle(vehicle);
    if (msg) {
      OW.audio.play("stage");
      toast(msg);
    }
  }

  function toggleCam() {
    mapMode = !mapMode;
    document.getElementById("btn-cam").textContent = mapMode ? "跟机" : "轨道图";
  }

  function cycleWarp() {
    if (warpReq === 1) warpReq = 5;
    else if (warpReq === 5) warpReq = 25;
    else if (warpReq === 25) warpReq = OW.TUNE.COAST_WARP;
    else warpReq = 1;
  }

  function pauseGame() {
    if (screen !== "flight" || (vehicle && vehicle.result)) return;
    paused = true;
    show("pause");
  }

  function finishFlight() {
    if (!vehicle || !vehicle.result) return;
    var ok = vehicle.result.ok;
    var text = vehicle.result.text;
    if (ok && mode === "moon") {
      save.moonCleared = true;
      save.bestCraftJson = OW.serializeCraft(craft);
      persist();
      OW.audio.play("success");
    }
    document.getElementById("debrief-kicker").textContent = ok ? "任务完成" : (mode === "sandbox" ? "试飞结束" : "这次没成");
    document.getElementById("debrief-lead").textContent = text;
    var fuel = OW.fuelLeft(vehicle);
    document.getElementById("debrief-stats").innerHTML =
      "最高高度 " + stats.maxAlt.toFixed(0) + " km<br>" +
      (vehicle.orbitDone ? "曾经入轨<br>" : "还没入轨<br>") +
      "剩余燃料 " + fuel.fuel.toFixed(2) + " t";
    var sand = document.getElementById("btn-debrief-sandbox");
    sand.style.display = ok && mode === "moon" ? "" : "none";
    show("debrief");
  }

  // Pointer stick + throttle
  bindAxis(document.getElementById("stick"), function (nx, ny) {
    stick = Math.abs(nx) > Math.abs(ny) ? nx : -ny;
  }, true);
  bindAxis(document.getElementById("throttle"), function (nx, ny) {
    if (!vehicle) return;
    vehicle.throttle = OW.clamp(1 - ny, 0, 1);
  }, false);

  function bindAxis(node, onMove, recenter) {
    var knob = node.querySelector(".knob");
    function setFromEvent(ev) {
      var r = node.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width;
      var y = (ev.clientY - r.top) / r.height;
      x = OW.clamp(x, 0, 1);
      y = OW.clamp(y, 0, 1);
      if (recenter) {
        knob.style.left = (x * 100) + "%";
        knob.style.top = (y * 100) + "%";
        onMove(x * 2 - 1, y * 2 - 1);
      } else {
        knob.style.top = (y * 100) + "%";
        onMove(0, y);
      }
    }
    node.addEventListener("pointerdown", function (ev) {
      node.setPointerCapture(ev.pointerId);
      setFromEvent(ev);
    });
    node.addEventListener("pointermove", function (ev) {
      if (node.hasPointerCapture && node.hasPointerCapture(ev.pointerId)) setFromEvent(ev);
    });
    node.addEventListener("pointerup", function () {
      if (!recenter) return;
      stick = 0;
      knob.style.left = "50%";
      knob.style.top = "50%";
    });
  }

  canvas.addEventListener("wheel", function (ev) {
    if (screen !== "flight" || !mapMode) return;
    ev.preventDefault();
    var z = ev.deltaY > 0 ? 0.85 : 1.18;
    mapCam.ppm = OW.clamp(mapCam.ppm * z, OW.draw.w / (OW.TUNE.EARTH_MOON_DIST * 3.2), OW.draw.w / 80);
    mapCam.follow = false;
  }, { passive: false });

  var pointers = {};
  canvas.addEventListener("pointerdown", function (ev) {
    if (screen !== "flight" || !mapMode) return;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (screen !== "flight" || !mapMode || !pointers[ev.pointerId]) return;
    var prev = pointers[ev.pointerId];
    var dx = ev.clientX - prev.x;
    var dy = ev.clientY - prev.y;
    mapCam.x -= dx / mapCam.ppm;
    mapCam.y += dy / mapCam.ppm;
    mapCam.follow = false;
    pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
  });
  canvas.addEventListener("pointerup", function (ev) { delete pointers[ev.pointerId]; });

  window.addEventListener("keydown", function (ev) {
    keys[ev.code] = true;
    if (ev.code === "Tab") ev.preventDefault();
    if (screen === "flight" && !paused) {
      if (ev.code === "Enter") ignite();
      if (ev.code === "Space") { ev.preventDefault(); doStage(); }
      if (ev.code === "KeyC") toggleCam();
      if (ev.code === "KeyP" || ev.code === "Escape") pauseGame();
    } else if (screen === "pause" && ev.code === "Escape") {
      paused = false;
      show("flight");
    } else if (screen === "howto" && ev.code === "Escape") show("menu");
    if (screen === "flight" && ev.code === "Tab") cycleWarp();
  });
  window.addEventListener("keyup", function (ev) { keys[ev.code] = false; });

  function pitchInput() {
    var p = stick;
    if (keys.KeyA || keys.ArrowLeft) p -= 1;
    if (keys.KeyD || keys.ArrowRight) p += 1;
    return OW.clamp(p, -1, 1);
  }

  function applyKeys(dt) {
    if (!vehicle) return;
    var rate = vehicle.throttle < 0.2 ? 0.18 : 0.45;
    if (keys.KeyW || keys.ShiftLeft || keys.ShiftRight) vehicle.throttle += rate * dt;
    if (keys.KeyS || keys.ControlLeft || keys.ControlRight) vehicle.throttle -= rate * dt;
    vehicle.throttle = OW.clamp(vehicle.throttle, 0, 1);
    var knob = document.getElementById("throttle-knob");
    knob.style.top = ((1 - vehicle.throttle) * 100) + "%";
  }

  function hintFor(tel) {
    if (!vehicle.ignited) return "油门推上去，再按点火";
    if (tel.altEarth < 12 && tel.q > 8) return "先竖直。动压高时别猛转";
    if (tel.altEarth < 70) return "保持大致朝上，出了大气再放平";
    if (!vehicle.orbitDone && tel.altEarth > 80) return "水平加速。近地点过 150 km 就收油门";
    if (vehicle.orbitDone && !tel.inSoi && mode === "moon") {
      return tel.window.open ? "奔月窗口开了：朝速度方向加速" : "等窗口变绿，或者硬飞（更费油）";
    }
    if (tel.inSoi && tel.altMoon > 40) return "对着运动的反方向减速";
    if (tel.altMoon < 40 && tel.body === "moon") return "立直，垂速放慢。悬停油门见右侧";
    if (mode === "sandbox") return "沙盒：同一套物理，没有胜负";
    return "稳住";
  }

  function updateHud(dt) {
    if (!vehicle) return;
    var tel = OW.telemetry(vehicle, world);
    if (tel.altEarth > stats.maxAlt) stats.maxAlt = tel.altEarth;
    var vspeed = tel.vrad * 1000;
    el.hudL.innerHTML =
      "<strong>" + tel.bodyName + "</strong><br>" +
      "高度 " + fmtAlt(tel.alt) + "<br>" +
      "垂速 " + Math.round(vspeed) + " m/s<br>" +
      "地速 " + fmtSpeed(tel.vt) + "<br>" +
      "近 " + fmtOrbit(tel.pe, tel.speed) + " · 远 " + fmtOrbit(tel.ap, tel.speed);
    var stage = OW.nextStageInfo(vehicle);
    el.hudR.innerHTML =
      "燃料 " + Math.round(tel.fuelPct * 100) + "%<br>" +
      "油门 " + Math.round(vehicle.throttle * 100) + "%<br>" +
      "TWR " + tel.twr.toFixed(2) + "<br>" +
      "动压 " + tel.q.toFixed(0) + " / " + OW.TUNE.QMAX + "<br>" +
      (stage ? "下一级 " + stage.name : "没有可抛的级");
    var showHover = tel.alt < 30 && tel.vrad < 0.05 && vehicle.maxAlt > 2 && (tel.body === "moon" || tel.altEarth < 12);
    if (showHover) {
      el.hudR.innerHTML += "<br>悬停约 " + Math.round(tel.hoverThrottle * 100) + "%";
      el.vs.classList.add("on");
      var t = OW.clamp((vspeed + 40) / 80, 0, 1);
      el.vsMark.style.top = ((1 - t) * 100) + "%";
    } else el.vs.classList.remove("on");
    el.hint.textContent = hintFor(tel);
    var warp = vehicle.ignited ? OW.effectiveWarp(vehicle, world, warpReq) : 1;
    var label = warpReq >= OW.TUNE.COAST_WARP ? "巡航" : warpReq + "×";
    document.getElementById("btn-warp").textContent = label;
    el.warp.textContent = warp > 1.05 ? (warp >= 100 ? "巡航 " + Math.round(warp) + "×" : warp + "×") : "";
    if (tel.window.useful && mode === "moon" && !tel.inSoi) {
      el.hudL.innerHTML += tel.window.open
        ? '<br><span class="good">奔月窗口</span>'
        : '<br><span class="warn">窗口外 · 能到但费油</span>';
    }
    if (tel.q > OW.TUNE.QMAX * 0.7 && tel.altEarth < OW.TUNE.ATM_TOP) {
      el.hudR.innerHTML += '<br><span class="bad">动压偏高</span>';
    }
    if (!vehicle.orbitAnnounced && vehicle.orbitDone) {
      vehicle.orbitAnnounced = true;
      save.orbitReached = true;
      persist();
      banner("入轨成功");
      OW.audio.play("orbit");
      toast("真空发动机已解锁");
    }
    if (!vehicle.soiAnnounced && tel.inSoi) {
      vehicle.soiAnnounced = true;
      banner("月球引力主导");
    }
    if (vehicle.touchdown && !vehicle.touchAnnounced && mode === "sandbox") {
      vehicle.touchAnnounced = true;
      toast(vehicle.touchdown);
    }
    return warp;
  }

  function fmtOrbit(km, speed) {
    if (speed < 0.15) return "—";
    return fmtAlt(km);
  }
  function fmtAlt(km) {
    if (!isFinite(km)) return "逃逸";
    if (km < 10) return km.toFixed(2) + " km";
    return Math.round(km) + " km";
  }
  function fmtSpeed(kms) {
    var ms = kms * 1000;
    if (ms < 2000) return Math.round(ms) + " m/s";
    return kms.toFixed(2) + " km/s";
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) el.banner.classList.remove("on");
    }
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) el.toast.classList.remove("on");
    }

    if (screen === "menu" || screen === "howto") {
      OW.draw.sky(ctx);
      // Quiet Earth + Moon so the menu isn't a black card on black.
      var t = now / 1000;
      var moon = OW.moonState(t * 40, 0.8);
      OW.drawMap(ctx, { x: OW.TUNE.RE * 1.2, y: 0, vx: 0, vy: 0.1, angle: 0 }, { t: t * 40, moon0: 0.8 }, {
        x: moon.x * 0.3, y: moon.y * 0.15, ppm: OW.draw.w / (OW.TUNE.EARTH_MOON_DIST * 2.6),
      }, null);
    } else if (screen === "hangar") {
      OW.draw.hangar(ctx, craft, save, selectedId, selectedUid, hangarCam);
    } else if ((screen === "flight" || screen === "pause") && vehicle) {
      if (screen === "flight" && !paused && !vehicle.result) {
        applyKeys(dt);
        var warp = updateHud(dt);
        var sim = dt * warp;
        var guard = 0;
        while (sim > 1e-5 && !vehicle.result && guard < 80) {
          var h = Math.min(sim, OW.substepFor(vehicle, world));
          OW.stepVehicle(vehicle, world, { pitch: pitchInput(), throttle: vehicle.throttle }, h);
          world.t += h;
          sim -= h;
          guard++;
        }
        if (vehicle.orbitDone) stats.maxAlt = Math.max(stats.maxAlt, OW.telemetry(vehicle, world).altEarth);
        if (now - predAt > 500) {
          prediction = OW.predict(vehicle, world);
          predAt = now;
        }
      } else if (!vehicle.result) updateHud(dt);
      if (screen === "flight" && vehicle.result) {
        endTimer += dt;
        if (endTimer > 0.7) finishFlight();
      }
      if (mapMode && mapCam.follow) {
        mapCam.x = vehicle.x;
        mapCam.y = vehicle.y;
      }
      if (screen === "flight") OW.drawFlight(ctx, vehicle, world, canvas, mapMode ? "map" : "chase", mapCam, prediction);
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", function () { OW.draw.resize(canvas); if (screen === "hangar") refreshHangar(); });
  if (location.search.indexOf("shot=hangar") >= 0) {
    openHangar("moon");
    loadTemplate("starter");
  } else if (location.search.indexOf("shot=flight") >= 0) {
    mode = "moon";
    craft = OW.craftFromTemplate("starter");
    startFlight();
    vehicle.throttle = 1;
    vehicle.ignited = true;
    document.getElementById("btn-ignite").style.display = "none";
  } else if (location.search.indexOf("shot=map") >= 0) {
    mode = "moon";
    craft = OW.craftFromTemplate("starter");
    startFlight();
    vehicle.throttle = 0.6;
    vehicle.ignited = true;
    vehicle.x = 7000;
    vehicle.y = 1200;
    vehicle.vx = -0.4;
    vehicle.vy = 7.4;
    mapMode = true;
    mapCam.follow = true;
    mapCam.ppm = OW.draw.w / (OW.TUNE.RE * 8);
    document.getElementById("btn-ignite").style.display = "none";
  }
  requestAnimationFrame(frame);
})();
