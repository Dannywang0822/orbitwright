export class AudioBus {
  enabled = false;
  private ctx: AudioContext | null = null;
  private engine: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopEngine();
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(620, 0.05, "sine", 0.03);
  }

  stage(): void {
    this.tone(220, 0.12, "triangle", 0.04);
  }

  chute(): void {
    this.tone(520, 0.18, "sine", 0.03);
  }

  good(): void {
    this.tone(523, 0.1, "sine", 0.04);
    window.setTimeout(() => this.tone(659, 0.12, "sine", 0.04), 110);
    window.setTimeout(() => this.tone(784, 0.18, "sine", 0.04), 220);
  }

  soft(): void {
    this.tone(392, 0.16, "sine", 0.03);
    window.setTimeout(() => this.tone(330, 0.2, "sine", 0.03), 140);
  }

  rumble(level: number): void {
    if (!this.enabled || level < 0.04) {
      this.stopEngine();
      return;
    }
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.engine || !this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 240;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      this.noise = src;
      this.engine = gain;
    }
    this.engine.gain.value = 0.015 + level * 0.03;
  }

  private stopEngine(): void {
    if (this.noise) {
      try {
        this.noise.stop();
      } catch {
        /* already stopped */
      }
    }
    this.noise = null;
    this.engine = null;
  }
}
