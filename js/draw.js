// Canvas drawing for hangar, chase camera, and the Earth–Moon map.
OW.draw = {
  stars: null,
  dpr: 1,
  w: 0,
  h: 0,

  resize: function (canvas) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(2, Math.floor(w * dpr));
    canvas.height = Math.max(2, Math.floor(h * dpr));
    this.dpr = dpr;
    this.w = canvas.width;
    this.h = canvas.height;
    this.stars = null;
  },

  ensureStars: function () {
    if (this.stars) return;
    var list = [];
    var n = 160;
    for (var i = 0; i < n; i++) {
      list.push({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.5 + 0.25,
      });
    }
    this.stars = list;
  },

  sky: function (ctx) {
    this.ensureStars();
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, "#070b16");
    g.addColorStop(1, "#101a2c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      ctx.globalAlpha = s.a;
      ctx.fillStyle = "#d5e4f5";
      ctx.beginPath();
      ctx.arc(s.x * this.w, s.y * this.h, s.r * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  // Draw one part in its local box, nose up (+y). ctx is already translated to the center.
  part: function (ctx, part, opts) {
    var def = OW.PARTS[part.partId];
    var w = part.w;
    var h = part.h;
    ctx.save();
    ctx.translate(part.x, part.y);
    var fuelFrac = part.fuelMax > 0 ? Math.max(0, part.fuel / part.fuelMax) : 0;
    ctx.fillStyle = def.color;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.06;
    if (def.kind === "command") {
      ctx.beginPath();
      ctx.moveTo(-w * 0.42, -h * 0.45);
      ctx.lineTo(-w * 0.48, h * 0.05);
      ctx.quadraticCurveTo(0, h * 0.72, w * 0.48, h * 0.05);
      ctx.lineTo(w * 0.42, -h * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#8fd0ea";
      ctx.beginPath();
      ctx.ellipse(0, h * 0.12, w * 0.22, h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (def.kind === "tank") {
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.18);
      ctx.fill();
      ctx.stroke();
      if (fuelFrac > 0.02) {
        ctx.fillStyle = def.id === "tank_l" ? "rgba(90,170,220,0.55)" : "rgba(70,160,210,0.45)";
        var fh = (h - 0.2) * fuelFrac;
        ctx.fillRect(-w / 2 + 0.12, h / 2 - 0.1 - fh, w - 0.24, fh);
      }
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(w / 2, 0);
      ctx.stroke();
    } else if (def.kind === "engine") {
      ctx.fillStyle = def.color;
      ctx.fillRect(-w * 0.38, -h * 0.15, w * 0.76, h * 0.62);
      ctx.beginPath();
      ctx.moveTo(-w * 0.48, -h * 0.15);
      ctx.lineTo(-w * 0.22, -h * 0.5);
      ctx.lineTo(w * 0.22, -h * 0.5);
      ctx.lineTo(w * 0.48, -h * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = def.accent;
      ctx.fillRect(-w * 0.5, h * 0.28, w, h * 0.16);
    } else if (def.kind === "booster") {
      roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = def.accent;
      ctx.fillRect(-w / 2, -h * 0.08, w, h * 0.16);
      ctx.fillStyle = "#c9c3b8";
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, -h / 2);
      ctx.lineTo(0, -h / 2 - h * 0.08);
      ctx.lineTo(w * 0.28, -h / 2);
      ctx.fill();
    } else if (def.kind === "legs") {
      ctx.strokeStyle = def.accent;
      ctx.fillStyle = def.color;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(-w * 0.15, h * 0.35);
      ctx.lineTo(-w * 0.42, -h * 0.35);
      ctx.moveTo(w * 0.15, h * 0.35);
      ctx.lineTo(w * 0.42, -h * 0.35);
      ctx.stroke();
      ctx.fillRect(-w * 0.22, h * 0.2, w * 0.44, h * 0.28);
      ctx.fillRect(-w * 0.48, -h * 0.48, w * 0.16, h * 0.16);
      ctx.fillRect(w * 0.32, -h * 0.48, w * 0.16, h * 0.16);
    }
    if (opts && opts.selected) {
      ctx.strokeStyle = "#ffb020";
      ctx.lineWidth = 0.1;
      ctx.strokeRect(-w / 2 - 0.12, -h / 2 - 0.12, w + 0.24, h + 0.24);
    }
    ctx.restore();
  },

  hangar: function (ctx, craft, save, selectedId, selectedUid, cam) {
    this.sky(ctx);
    var view = OW.socketsFor(craft, save, selectedId);
    var layout = view.layout;
    cam = cam || { x: 0, y: Math.max(2, layout.height / 2), ppm: 42 * this.dpr };
    var self = this;
    function toScreen(x, y) {
      return {
        x: self.w / 2 + (x - cam.x) * cam.ppm,
        y: self.h * (self.w < self.h ? 0.46 : 0.58) - (y - cam.y) * cam.ppm,
      };
    }
    // Pad
    ctx.fillStyle = "#243044";
    var pad = toScreen(0, -0.2);
    ctx.fillRect(pad.x - 70 * this.dpr, pad.y, 140 * this.dpr, 10 * this.dpr);
    ctx.fillStyle = "#ffb020";
    ctx.fillRect(this.w / 2 - 2 * this.dpr, pad.y - layout.height * cam.ppm - 20, 4 * this.dpr, layout.height * cam.ppm + 20);

    ctx.save();
    // Draw in meter space via transform: screen = center + (p - cam) * ppm, y flipped.
    var anchor = this.w < this.h ? 0.46 : 0.58;
    ctx.translate(this.w / 2, this.h * anchor);
    ctx.scale(cam.ppm, -cam.ppm);
    ctx.translate(-cam.x, -cam.y);
    for (var i = 0; i < layout.parts.length; i++) {
      var p = layout.parts[i];
      this.part(ctx, p, { selected: p.uid === selectedUid });
    }
    ctx.restore();
    ctx.fillStyle = "#1b2430";
    ctx.font = (13 * this.dpr) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var n = 0; n < layout.parts.length; n++) {
      var spart = layout.parts[n];
      if (!spart.stage) continue;
      var lab = toScreen(spart.x, spart.y);
      ctx.fillText(String(spart.stage), lab.x, lab.y);
    }

    for (var s = 0; s < view.sockets.length; s++) {
      var sock = view.sockets[s];
      if (selectedId && !sock.ok) continue;
      var sp = toScreen(sock.x, sock.y);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 11 * this.dpr, 0, Math.PI * 2);
      ctx.fillStyle = sock.ok || !selectedId ? "rgba(255,176,32,0.9)" : "rgba(120,130,140,0.5)";
      ctx.fill();
      ctx.fillStyle = "#1b1408";
      ctx.font = (12 * this.dpr) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sock.label || "+", sp.x, sp.y);
    }
    return { view: view, cam: cam, toScreen: toScreen };
  },

  hitHangar: function (px, py, craft, save, selectedId, cam) {
    var view = OW.socketsFor(craft, save, selectedId);
    var layout = view.layout;
    cam = cam || { x: 0, y: Math.max(2, layout.height / 2), ppm: 42 * this.dpr };
    var self = this;
    function toScreen(x, y) {
      return {
        x: self.w / 2 + (x - cam.x) * cam.ppm,
        y: self.h * (self.w < self.h ? 0.46 : 0.58) - (y - cam.y) * cam.ppm,
      };
    }
    var best = null;
    var bestD = 18 * this.dpr;
    for (var s = 0; s < view.sockets.length; s++) {
      var sock = view.sockets[s];
      if (selectedId && !sock.ok) continue;
      var sp = toScreen(sock.x, sock.y);
      var d = Math.hypot(px - sp.x, py - sp.y);
      if (d < bestD) { bestD = d; best = { type: "socket", socket: sock }; }
    }
    for (var i = layout.parts.length - 1; i >= 0; i--) {
      var p = layout.parts[i];
      var c = toScreen(p.x, p.y);
      var hw = (p.w * cam.ppm) / 2;
      var hh = (p.h * cam.ppm) / 2;
      if (Math.abs(px - c.x) <= hw && Math.abs(py - c.y) <= hh) {
        return { type: "part", uid: p.uid, part: p };
      }
    }
    return best;
  },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

OW.projectSide = function (vehicle, world, canvasW, canvasH) {
  var tel = OW.telemetry(vehicle, world);
  var moon = OW.moonState(world.t, world.moon0);
  var focusX, focusY, upX, upY;
  if (tel.body === "moon") {
    focusX = vehicle.x - moon.x;
    focusY = vehicle.y - moon.y;
  } else {
    focusX = vehicle.x;
    focusY = vehicle.y;
  }
  var r = Math.hypot(focusX, focusY) || 1;
  upX = focusX / r;
  upY = focusY / r;
  var rightX = -upY;
  var rightY = upX;
  var alt = Math.max(0, tel.alt);
  var props = OW.vehicleMassProps(vehicle);
  var heightM = 12;
  var top = -1e9;
  var bot = 1e9;
  for (var i = 0; i < props.alive.length; i++) {
    var p = props.alive[i];
    top = Math.max(top, p.y + p.h / 2);
    bot = Math.min(bot, p.y - p.h / 2);
  }
  heightM = Math.max(4, top - bot);
  // Frame the rocket, and pull back when close to a surface so the ground is in frame.
  var halfKm = (heightM / 1000) * (canvasH / 2) / (78 * (canvasH / 800));
  if (alt < 3) halfKm = Math.max(halfKm, Math.min(alt * 0.9 + 0.04, halfKm * 6));
  halfKm = Math.max(0.02, halfKm);
  var ppm = (canvasH * 0.5) / halfKm;
  return { upX: upX, upY: upY, rightX: rightX, rightY: rightY, ppm: ppm, alt: alt, tel: tel, moon: moon };
};

OW.drawFlight = function (ctx, vehicle, world, canvas, mode, mapCam, prediction) {
  var d = OW.draw;
  d.sky(ctx);
  if (mode === "map") OW.drawMap(ctx, vehicle, world, mapCam, prediction);
  else OW.drawChase(ctx, vehicle, world);
};

OW.drawChase = function (ctx, vehicle, world) {
  var d = OW.draw;
  var cam = OW.projectSide(vehicle, world, d.w, d.h);
  var tel = cam.tel;
  var body = tel.body === "moon"
    ? { x: cam.moon.x, y: cam.moon.y, R: OW.TUNE.RM, kind: "moon" }
    : { x: 0, y: 0, R: OW.TUNE.RE, kind: "earth" };
  // Ground samples in the local frame.
  ctx.beginPath();
  var started = false;
  for (var i = -20; i <= d.w + 20; i += 12) {
    var localRight = (i - d.w / 2) / cam.ppm;
    var rr = body.R * body.R - localRight * localRight;
    if (rr <= 0) continue;
    var localUp = -Math.hypot(vehicle.x - body.x, vehicle.y - body.y) + Math.sqrt(rr);
    // The focus is the craft, whose localUp is 0. Body center is at localUp = -range.
    var range = Math.hypot(vehicle.x - body.x, vehicle.y - body.y);
    localUp = -range + Math.sqrt(rr);
    var sy = d.h * 0.62 - localUp * cam.ppm;
    if (!started) { ctx.moveTo(i, sy); started = true; }
    else ctx.lineTo(i, sy);
  }
  if (started) {
    ctx.lineTo(d.w + 40, d.h + 40);
    ctx.lineTo(-40, d.h + 40);
    ctx.closePath();
    var gg = ctx.createLinearGradient(0, d.h * 0.4, 0, d.h);
    if (body.kind === "earth") {
      gg.addColorStop(0, "#1f6fb2");
      gg.addColorStop(1, "#0c3a28");
    } else {
      gg.addColorStop(0, "#b7b2a8");
      gg.addColorStop(1, "#5c5852");
    }
    ctx.fillStyle = gg;
    ctx.fill();
  }
  // Atmosphere band on Earth when the camera can see it.
  if (body.kind === "earth" && tel.alt < 120) {
    ctx.fillStyle = "rgba(120,190,255,0.18)";
    ctx.fillRect(0, 0, d.w, d.h * 0.62);
  }

  // Rocket. Local +y (nose) maps to world angle.
  var noseX = Math.cos(vehicle.angle);
  var noseY = Math.sin(vehicle.angle);
  var rightX = -noseY;
  var rightY = noseX;
  var props = OW.vehicleMassProps(vehicle);
  var minH = 1e9;
  for (var a = 0; a < props.alive.length; a++) {
    minH = Math.min(minH, (props.alive[a].h / 1000) * cam.ppm);
  }
  // Keep the stack readable when the world scale would shrink it to a speck.
  var stackPx = 0;
  var top = -1e9;
  var bot = 1e9;
  for (var b = 0; b < props.alive.length; b++) {
    top = Math.max(top, props.alive[b].y + props.alive[b].h / 2);
    bot = Math.min(bot, props.alive[b].y - props.alive[b].h / 2);
  }
  stackPx = ((top - bot) / 1000) * cam.ppm;
  var boost = stackPx < 70 * d.dpr ? (70 * d.dpr) / Math.max(8, stackPx) : 1;

  ctx.save();
  ctx.translate(d.w / 2, d.h * 0.62);
  // World nose direction relative to screen-up.
  var screenNoseX = noseX * cam.rightX + noseY * cam.rightY;
  var screenNoseY = noseX * cam.upX + noseY * cam.upY;
  var rot = Math.atan2(-screenNoseX, screenNoseY);
  ctx.rotate(rot);
  ctx.scale(cam.ppm / 1000 * boost, -cam.ppm / 1000 * boost);
  ctx.translate(-props.comX, -props.comY);
  for (var k = 0; k < props.alive.length; k++) OW.draw.part(ctx, props.alive[k], {});
  // Flame on burning engines.
  var burns = OW.activeBurns(vehicle);
  for (var f = 0; f < burns.burns.length; f++) {
    var burn = burns.burns[f];
    var throttle = burn.srb ? 1 : vehicle.throttle;
    if (throttle <= 0.02) continue;
    var len = (1.2 + Math.random() * 0.8) * throttle * (burn.part.h || 2);
    ctx.save();
    ctx.translate(burn.part.x, burn.part.y - burn.part.h / 2);
    ctx.fillStyle = burn.srb ? "rgba(255,170,60,0.9)" : "rgba(255,220,120,0.92)";
    ctx.beginPath();
    ctx.moveTo(-0.28, 0);
    ctx.lineTo(0.28, 0);
    ctx.lineTo(0, -len);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Prograde tick.
  if (tel.speed > 0.02) {
    var vx = vehicle.vx;
    var vy = vehicle.vy;
    var vpx = vx * cam.rightX + vy * cam.rightY;
    var vpy = vx * cam.upX + vy * cam.upY;
    var vn = Math.hypot(vpx, vpy) || 1;
    ctx.strokeStyle = "#7ee0ff";
    ctx.lineWidth = 2 * d.dpr;
    ctx.beginPath();
    ctx.moveTo(d.w / 2, d.h * 0.62);
    ctx.lineTo(d.w / 2 + (vpx / vn) * 54 * d.dpr, d.h * 0.62 - (vpy / vn) * 54 * d.dpr);
    ctx.stroke();
  }
};

OW.drawMap = function (ctx, vehicle, world, cam, prediction) {
  var d = OW.draw;
  cam = cam || { x: 0, y: 0, ppm: d.w / (OW.TUNE.EARTH_MOON_DIST * 2.4) };
  function toScreen(x, y) {
    return {
      x: d.w / 2 + (x - cam.x) * cam.ppm,
      y: d.h / 2 - (y - cam.y) * cam.ppm,
    };
  }
  var moon = OW.moonState(world.t, world.moon0);
  drawBody(ctx, toScreen(0, 0), Math.max(2, OW.TUNE.RE * cam.ppm), "earth");
  drawBody(ctx, toScreen(moon.x, moon.y), Math.max(2, OW.TUNE.RM * cam.ppm), "moon");
  // SOI ring.
  ctx.beginPath();
  var ms = toScreen(moon.x, moon.y);
  ctx.arc(ms.x, ms.y, OW.TUNE.SOI_M * cam.ppm, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(200,200,210,0.25)";
  ctx.setLineDash([4, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (prediction && prediction.ellipse && prediction.ellipse.length > 2) {
    strokePath(ctx, prediction.ellipse, toScreen, "rgba(120,170,220,0.35)", 1.2 * d.dpr);
  }
  if (prediction && prediction.path && prediction.path.length > 1) {
    strokePath(ctx, prediction.path, toScreen, "#ffb020", 2 * d.dpr);
  }
  var craft = toScreen(vehicle.x, vehicle.y);
  ctx.save();
  ctx.translate(craft.x, craft.y);
  var ang = Math.atan2(vehicle.vy, vehicle.vx);
  ctx.rotate(-ang);
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.moveTo(8 * d.dpr, 0);
  ctx.lineTo(-6 * d.dpr, 4.5 * d.dpr);
  ctx.lineTo(-6 * d.dpr, -4.5 * d.dpr);
  ctx.fill();
  ctx.restore();
};

function strokePath(ctx, pts, toScreen, color, width) {
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++) {
    var p = toScreen(pts[i].x, pts[i].y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawBody(ctx, c, r, kind) {
  var g = ctx.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, r * 0.2, c.x, c.y, r);
  if (kind === "earth") {
    g.addColorStop(0, "#3aa0e0");
    g.addColorStop(0.7, "#1a5ea8");
    g.addColorStop(1, "#0c3260");
  } else {
    g.addColorStop(0, "#e4e0d8");
    g.addColorStop(1, "#8a857c");
  }
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  if (kind === "earth") {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * (1 + 70 / OW.TUNE.RE), 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(140,200,255,0.35)";
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.stroke();
  }
}
