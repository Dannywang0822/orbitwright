// Mute-by-default placeholders. No sample files in v1 — short tones only.
OW.audio = {
  ctx: null,
  muted: true,
  ensure: function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
  },
  tone: function (freq, dur, type, gain) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  },
  play: function (name) {
    if (name === "ignite") this.tone(90, 0.4, "sawtooth", 0.05);
    else if (name === "stage") this.tone(180, 0.12, "square", 0.04);
    else if (name === "orbit") { this.tone(660, 0.12, "sine", 0.05); this.tone(880, 0.18, "sine", 0.04); }
    else if (name === "alarm") this.tone(440, 0.08, "square", 0.04);
    else if (name === "success") {
      this.tone(523, 0.12, "sine", 0.05);
      var self = this;
      setTimeout(function () { self.tone(659, 0.12, "sine", 0.05); }, 120);
      setTimeout(function () { self.tone(784, 0.22, "sine", 0.05); }, 240);
    }
  },
};
