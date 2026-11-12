// Sons synthétisés (WebAudio) : aucun fichier audio requis.
export class Sfx {
  constructor() { this.ctx = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
      // moteur
      this.eo = c.createOscillator(); this.eo.type = 'sawtooth'; this.eo2 = c.createOscillator(); this.eo2.type = 'square';
      this.ef = c.createBiquadFilter(); this.ef.type = 'lowpass'; this.ef.frequency.value = 600;
      this.eg = c.createGain(); this.eg.gain.value = 0;
      this.eo.connect(this.ef); this.eo2.connect(this.ef); this.ef.connect(this.eg); this.eg.connect(this.master); this.eo.start(); this.eo2.start();
      // bruit (dérapage)
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.dn = c.createBufferSource(); this.dn.buffer = buf; this.dn.loop = true; this.df = c.createBiquadFilter(); this.df.type = 'bandpass'; this.df.frequency.value = 1800; this.df.Q.value = 3;
      this.dg = c.createGain(); this.dg.gain.value = 0; this.dn.connect(this.df); this.df.connect(this.dg); this.dg.connect(this.master); this.dn.start();
    } catch { this.ctx = null; }
  }

  engine(ratio, on, boost, drift) {
    if (!this.ctx) return; const t = this.ctx.currentTime, r = Math.max(0, Math.min(1.6, Math.abs(ratio)));
    this.eo.frequency.setTargetAtTime(55 + r * 150 + (boost ? 40 : 0), t, 0.05); this.eo2.frequency.setTargetAtTime((55 + r * 150) * 0.502, t, 0.05);
    this.ef.frequency.setTargetAtTime(400 + r * 1500, t, 0.05);
    this.eg.gain.setTargetAtTime(on ? 0.07 + r * 0.05 : 0, t, 0.08);
    this.dg.gain.setTargetAtTime(on && drift ? 0.09 : 0, t, 0.05);
  }

  tone(type, f0, f1, dur, vol = 0.2, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  burst(f0, f1, dur, vol = 0.3, q = 1) {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }

  play(n) {
    if (!this.ctx) return;
    switch (n) {
      case 'beep': this.tone('square', 440, 440, 0.18, 0.15); break;
      case 'go': this.tone('square', 880, 880, 0.5, 0.18); break;
      case 'pickup': this.tone('triangle', 500, 1400, 0.25, 0.2); break;
      case 'item': this.tone('square', 900, 1300, 0.12, 0.14); this.tone('square', 1300, 1700, 0.15, 0.14, 0.1); break;
      case 'orb': [660, 880, 1100, 1320].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.2, i * 0.07)); break;
      case 'turbo': this.burst(400, 3000, 0.45, 0.3, 1.2); this.tone('sawtooth', 200, 700, 0.3, 0.1); break;
      case 'aura': this.burst(200, 5000, 1.0, 0.45, 0.8); this.tone('sawtooth', 110, 660, 0.8, 0.16); this.tone('square', 220, 990, 0.9, 0.08); break;
      case 'blast': this.tone('sawtooth', 900, 150, 0.4, 0.2); this.burst(2500, 400, 0.35, 0.2, 2); break;
      case 'boom': this.burst(900, 50, 0.7, 0.6, 0.6); this.tone('sine', 150, 35, 0.6, 0.4); break;
      case 'bump': this.burst(500, 90, 0.18, 0.4, 0.8); break;
      case 'land': this.burst(300, 60, 0.22, 0.35, 0.7); break;
      case 'trick': this.tone('triangle', 700, 1500, 0.2, 0.16); break;
      case 'shield': this.tone('sine', 300, 900, 0.4, 0.2); this.tone('sine', 450, 1350, 0.4, 0.1); break;
      case 'cloud': this.tone('sine', 500, 1000, 0.5, 0.2); this.burst(800, 2500, 0.5, 0.12, 1); break;
      case 'teleport': this.tone('square', 2000, 200, 0.25, 0.14); this.tone('square', 200, 2400, 0.25, 0.14, 0.12); break;
      case 'wish': [220, 277, 330, 440, 554, 660].forEach((f, i) => this.tone('sawtooth', f, f * 1.01, 0.9, 0.09, i * 0.09)); this.burst(300, 6000, 1.2, 0.25, 0.7); break;
      case 'fall': this.tone('sine', 700, 120, 0.6, 0.2); break;
      case 'lap': this.tone('square', 660, 660, 0.12, 0.15); this.tone('square', 880, 880, 0.25, 0.15, 0.14); break;
      case 'finish': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.3, 0.16, i * 0.14)); break;
      default: break;
    }
  }
}
