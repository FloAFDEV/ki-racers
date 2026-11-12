import * as THREE from 'three';
import { toon, loadTex, makeRoadTexture, makePadTexture, makeCheckerTexture, makeBlobTexture } from './gfx.js';

const DS = 2;        // espacement des échantillons (m)
const CELL = 16;     // taille de cellule de la grille spatiale

export const THEMES = {
  mountain: { sky: 'sky.jpg', ground: 'grass.jpg', cliff: 'rock.jpg', shoulder: 'grass.jpg', fog: 0xcfe6f7, skyTint: 0xffffff, road: '#3a4356', wallH: 2.4, sun: 0xfff4dd },
  desert: { sky: 'sky.jpg', ground: 'sand.jpg', cliff: 'rock.jpg', shoulder: 'sand.jpg', fog: 0xf3dcb4, skyTint: 0xffe2b8, road: '#4a4038', wallH: 2.0, sun: 0xffe6b0 },
  sky: { sky: 'sky2.jpg', ground: null, cliff: 'rock.jpg', shoulder: null, fog: 0xf0b9a0, skyTint: 0xffffff, road: '#2c2f5a', wallH: 1.2, sun: 0xffd9b0 },
};

const wrap = (d, L) => { d %= L; if (d > L / 2) d -= L; else if (d < -L / 2) d += L; return d; };

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

class Strip {
  constructor() { this.p = []; this.uv = []; this.idx = []; this.n = 0; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeVertexNormals();
    return g;
  }
}

export class Track {
  constructor(def) {
    this.def = def;
    this.theme = THEMES[def.theme];
    this.group = new THREE.Group();
    this.grid = new Map();
    this.ribbons = [];
    this._buildMain();
    (def.shortcuts || []).forEach((sc, i) => this._buildBranch(sc, i));
    this.ribbons.forEach((r) => r.samples.forEach((s) => this._gridAdd(s)));
    this._placeItems();
    let minY = Infinity; this.main.samples.forEach((s) => { minY = Math.min(minY, s.y); });
    this.groundY = minY - 16;
    this._buildMeshes();
    this._buildScenery();
    this._buildOutline();
  }

  // ---------- construction géométrique ----------
  _buildMain() {
    const def = this.def, n = def.pts.length;
    const curve = new THREE.CatmullRomCurve3(def.pts.map((c) => new THREE.Vector3(...c.p)), true, 'centripetal');
    const N = 6000, cum = new Float32Array(N + 1); let prev = curve.getPoint(0);
    for (let i = 1; i <= N; i++) { const p = curve.getPoint(i / N); cum[i] = cum[i - 1] + Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
    const L = cum[N]; this.L = L; this._cum = cum; this._N = N; this._n = n;
    const count = Math.round(L / DS), ds = L / count;
    const uOf = (s) => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } return (lo + (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])) / N; };
    const samples = [];
    for (let j = 0; j < count; j++) {
      const u = uOf(j * ds), p = curve.getPoint(u), t = curve.getTangent(u);
      const span = Math.min(n - 1, Math.floor(u * n)), f = u * n - span;
      const a = { ...def.defaults, ...def.pts[span] }, b = { ...def.defaults, ...def.pts[(span + 1) % n] };
      samples.push(this._sample(p, t, { w: a.w + (b.w - a.w) * f, sh: a.sh, eL: a.eL, eR: a.eR }, j * ds, j * ds, 1));
    }
    this.main = { id: 0, samples, closed: true, ds, length: L, isBranch: false };
    this.ribbons.push(this.main);
    (def.jumps || []).forEach((j) => this._applyJump(this.main, this.progOfAt(j.at), j));
    this._finish(this.main);
  }

  progOfAt(at) {
    const u = (((at / this._n) % 1) + 1) % 1, x = u * this._N, i = Math.floor(x);
    return this._cum[i] + (this._cum[Math.min(this._N, i + 1)] - this._cum[i]) * (x - i);
  }

  _sample(p, t, a, arc, prog, ps) {
    const l = Math.hypot(t.x, t.z) || 1, tx = t.x / l, tz = t.z / l;
    return {
      x: p.x, y: p.y, z: p.z, tx, tz, rx: -tz, rz: tx, w: a.w, shL: a.eL === 'wall' ? a.sh : 0, shR: a.eR === 'wall' ? a.sh : 0,
      eL: a.eL, eR: a.eR, rough: !!a.rough, hole: false, arc, prog, ps, slope: 0, pslope: 0, k: 0, rib: null, i: 0, base: p.y,
    };
  }

  _applyJump(rib, s0, j) {
    for (const s of rib.samples) {
      const d = s.arc - (s0 - j.len);
      if (d > 0 && d <= j.len) { const q = d / j.len; s.y += j.rise * q * q; s.ramp = true; }
    }
    (rib.lips ||= []).push(s0);
  }

  _finish(rib) {
    const S = rib.samples, n = S.length;
    for (let i = 0; i < n; i++) {
      const s = S[i]; s.rib = rib; s.i = i;
      const nx = rib.closed ? S[(i + 1) % n] : S[Math.min(n - 1, i + 1)];
      const pv = rib.closed ? S[(i - 1 + n) % n] : S[Math.max(0, i - 1)];
      s.slope = nx === s ? 0 : (nx.y - s.y) / rib.ds;
      s.pslope = pv === s ? 0 : (s.y - pv.y) / rib.ds;
      let da = Math.atan2(nx.tx, nx.tz) - Math.atan2(pv.tx, pv.tz);
      da = Math.atan2(Math.sin(da), Math.cos(da));
      s.k = da / (2 * rib.ds);
    }
  }

  _buildBranch(sc, idx) {
    const sFrom = this.progOfAt(sc.from), sTo = this.progOfAt(sc.to);
    const span = ((sTo - sFrom) % this.L + this.L) % this.L;
    const m = (p) => { const q = this.pointAt(p); return new THREE.Vector3(q.x, q.y, q.z); };
    const pts = [m(sFrom - 14), m(sFrom), ...sc.pts.map((p) => new THREE.Vector3(...p)), m(sTo), m(sTo + 14)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const k = pts.length - 1, u0 = 1 / k, u1 = (k - 1) / k, N = 2000;
    const cum = new Float32Array(N + 1); let prev = curve.getPoint(u0);
    for (let i = 1; i <= N; i++) { const p = curve.getPoint(u0 + (u1 - u0) * i / N); cum[i] = cum[i - 1] + Math.hypot(p.x - prev.x, p.z - prev.z); prev = p; }
    const len = cum[N], count = Math.round(len / DS), ds = len / count, ps = span / len;
    const samples = [];
    for (let j = 0; j <= count; j++) {
      const s = j * ds; let lo = 0, hi = N; while (hi - lo > 1) { const q = (lo + hi) >> 1; if (cum[q] <= s) lo = q; else hi = q; }
      const u = u0 + (u1 - u0) * ((lo + (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo])) / N);
      const sm = this._sample(curve.getPoint(u), curve.getTangent(u), sc, s, sFrom + s * ps, ps);
      const t = s / len;
      if (sc.hole && t > sc.hole[0] && t < sc.hole[1]) sm.hole = true;
      samples.push(sm);
    }
    const rib = { id: idx + 1, samples, closed: false, ds, length: len, isBranch: true, sFrom, sTo: sFrom + span, span, ps, def: sc, index: idx };
    if (sc.jump) this._applyJump(rib, sc.jump.t * len, sc.jump);
    this._finish(rib);
    this.ribbons.push(rib);
  }

  _gridAdd(s) {
    const k = Math.floor(s.x / CELL) + ',' + Math.floor(s.z / CELL);
    let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(s);
  }

  // ---------- requêtes ----------
  // Point de la ligne centrale (principale ou raccourci) à la progression `prog`.
  pointAt(prog, rib = this.main, lat = 0) {
    let f;
    if (rib.isBranch) f = Math.max(0, Math.min(rib.samples.length - 1.001, (prog - rib.sFrom) / rib.ps / rib.ds));
    else f = ((prog % this.L) + this.L) % this.L / rib.ds;
    const S = rib.samples, i = Math.floor(f), a = S[i % S.length], b = S[(i + 1) % S.length], q = f - i;
    const tx = a.tx + (b.tx - a.tx) * q, tz = a.tz + (b.tz - a.tz) * q, l = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * q - (tz / l) * lat, y: a.y + (b.y - a.y) * q, z: a.z + (b.z - a.z) * q + (tx / l) * lat,
      tx: tx / l, tz: tz / l, s: a,
    };
  }

  sampleAt(prog) { const S = this.main.samples; return S[Math.floor((((prog % this.L) + this.L) % this.L) / this.main.ds) % S.length]; }

  // Courbure maximale sur [prog, prog+dist]
  maxCurv(prog, dist, rib = this.main) {
    let m = 0;
    for (let d = 0; d <= dist; d += 4) {
      const s = rib.isBranch ? this.pointAt(prog + d, rib).s : this.sampleAt(prog + d);
      m = Math.max(m, Math.abs(s.k));
    }
    return m;
  }

  // Localise (x,z) sur le ruban le plus pertinent. progHint borne la recherche (anti-triche et ponts).
  locate(x, z, y, progHint, out) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), L = this.L;
    const best = this._best ||= []; const bestA = this._bestA ||= [];
    for (let r = 0; r < this.ribbons.length; r++) { best[r] = null; bestA[r] = 1e9; }
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.grid.get((cx + i) + ',' + (cz + j)); if (!c) continue;
      for (let q = 0; q < c.length; q++) {
        const s = c[q], dx = x - s.x, dz = z - s.z, al = dx * s.tx + dz * s.tz, aa = Math.abs(al);
        if (aa > 3 || aa >= bestA[s.rib.id]) continue;
        if (progHint !== null) { const d = wrap(s.prog - progHint, L); if (d < -90 || d > 120) continue; }
        const sy = s.y + (al >= 0 ? s.slope : s.pslope) * al;
        if (y < sy - 4 || y > sy + 45) continue;
        const lat = dx * s.rx + dz * s.rz;
        if (Math.abs(lat) > s.w + 14) continue;
        best[s.rib.id] = s; bestA[s.rib.id] = aa;
      }
    }
    let res = null, bo = 1e9;
    for (let r = 0; r < this.ribbons.length; r++) {
      const s = best[r]; if (!s) continue;
      const dx = x - s.x, dz = z - s.z, lat = dx * s.rx + dz * s.rz, over = Math.abs(lat) - s.w;
      if (over < bo) { bo = over; res = s; }
    }
    if (!res) return null;
    const s = res, dx = x - s.x, dz = z - s.z, al = dx * s.tx + dz * s.tz;
    out.s = s; out.lat = dx * s.rx + dz * s.rz; out.along = al; out.over = bo;
    out.y = s.y + (al >= 0 ? s.slope : s.pslope) * al;
    out.prog = ((s.prog + al * s.ps) % L + L) % L;
    return out;
  }

  // Vrai si le point est sur/près d'un autre tronçon (pour ne pas poser de mur en travers d'une route).
  _blocked(x, z, y, self, margin) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.grid.get((cx + i) + ',' + (cz + j)); if (!c) continue;
      for (const s of c) {
        if (s.rib === self.rib && Math.abs(wrap(s.arc - self.arc, s.rib.closed ? this.L : 1e9)) < 50) continue;
        if (Math.abs(s.y - y) > 9) continue;
        const dx = x - s.x, dz = z - s.z;
        if (Math.abs(dx * s.tx + dz * s.tz) > 2.2) continue;
        const lat = dx * s.rx + dz * s.rz;
        if (Math.abs(lat) < s.w + (lat > 0 ? s.shR : s.shL) + margin) return true;
      }
    }
    return false;
  }

  // ---------- objets de course ----------
  _placeItems() {
    const def = this.def;
    const onMain = (at, lat = 0, ahead = 0) => this.pointAt(this.progOfAt(at) + ahead, this.main, lat);
    const onBranch = (i, t, lat = 0) => { const r = this.ribbons[i + 1]; return this.pointAt(r.sFrom + t * r.span, r, lat); };
    this.pads = [];
    (def.pads || []).forEach((p) => { const q = onMain(p.at, p.lat || 0); this.pads.push({ x: q.x, y: q.y, z: q.z, tx: q.tx, tz: q.tz }); });
    this.caps = [];
    (def.caps || []).forEach((c) => {
      const prog = this.progOfAt(c.at), w = this.sampleAt(prog).w;
      [-0.62, -0.21, 0.21, 0.62].forEach((f) => { const q = this.pointAt(prog, this.main, f * w); this.caps.push({ x: q.x, y: q.y + 1.3, z: q.z, special: false, prog, lat: f * w }); });
    });
    this.orbs = [];
    (def.orbs || []).forEach((o) => {
      const q = o.sc !== undefined ? onBranch(o.sc, o.t) : onMain(o.at, o.lat || 0, o.ahead || 0);
      this.orbs.push({ x: q.x, y: q.s.base + (o.air || 1.4), z: q.z, air: !!o.air, sc: o.sc });
    });
    this.ribbons.forEach((r) => {
      if (!r.isBranch) return; const sc = r.def;
      if (sc.special !== undefined) { const q = onBranch(r.index, sc.special); this.caps.push({ x: q.x, y: q.y + 1.3, z: q.z, special: true, prog: -1, lat: 0 }); }
      if (sc.pad !== undefined) { const q = onBranch(r.index, sc.pad); this.pads.push({ x: q.x, y: q.y, z: q.z, tx: q.tx, tz: q.tz }); }
    });
    this.checkpoints = []; for (let i = 0; i < 8; i++) this.checkpoints.push((i + 0.5) * this.L / 8);
  }

  _buildOutline() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    this.outline = this.ribbons.map((r) => r.samples.filter((_, i) => i % 2 === 0).map((s) => {
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); return [s.x, s.z];
    }));
    this.bounds = { x0, x1, z0, z1 };
  }

  // ---------- maillages ----------
  _buildMeshes() {
    const th = this.theme, g = this.group, isSky = this.def.theme === 'sky';
    const road = new Strip(), rough = new Strip(), shoulder = new Strip(), walls = new Strip(), apron = new Strip(), cliff = new Strip(), under = new Strip();
    const H = th.wallH;
    for (const rib of this.ribbons) {
      const S = rib.samples, n = S.length, lift = rib.isBranch ? 0.04 : 0;
      const last = rib.closed ? n : n - 1;
      // les rubans utilisent un Strip chacun par côté : on gère les coupures manuellement
      const mk = () => ({ prev: null });
      const st = { road: mk(), shL: mk(), shR: mk(), wL: mk(), wR: mk(), aL: mk(), aR: mk(), cL: mk(), cR: mk(), uL: mk(), uR: mk(), uB: mk() };
      const emit = (strip, state, a, b, v, ok) => {
        if (!ok) { state.prev = null; return; }
        const i = strip.n; strip.p.push(a[0], a[1], a[2], b[0], b[1], b[2]); strip.uv.push(0, v, 1, v); strip.n += 2;
        if (state.prev !== null) { const p = state.prev; strip.idx.push(p, p + 1, i, p + 1, i + 1, i); }
        state.prev = i;
      };
      for (let q = 0; q <= last; q++) {
        const s = S[q % n], v = s.arc / 12 + (q === n ? rib.length / 12 : 0), y = s.y + lift;
        const P = (lat, yy) => [s.x + s.rx * lat, yy, s.z + s.rz * lat];
        const roadStrip = rib.def && rib.def.rough ? rough : road;
        emit(roadStrip, st.road, P(-s.w, y), P(s.w, y), v, !s.hole);
        for (const side of [-1, 1]) {
          const L = side < 0, sh = L ? s.shL : s.shR, edge = L ? s.eL : s.eR, e0 = s.w, e1 = s.w + sh;
          const shS = L ? st.shL : st.shR, wS = L ? st.wL : st.wR, aS = L ? st.aL : st.aR, cS = L ? st.cL : st.cR, uS = L ? st.uL : st.uR;
          const pa = P(side * e0, y - 0.02), pb = P(side * e1, y - 0.02);
          emit(shoulder, shS, L ? pb : pa, L ? pa : pb, v, sh > 0 && !s.hole);
          const wx = s.x + s.rx * side * (e1 + 0.3), wz = s.z + s.rz * side * (e1 + 0.3);
          const free = !this._blocked(wx, wz, s.y, s, 0.2) && !s.hole;
          const isWall = edge === 'wall';
          const wb = P(side * e1, y - 0.3), wt = P(side * (e1 + (isSky ? 0 : 0.7)), y + H);
          emit(walls, wS, L ? wt : wb, L ? wb : wt, v, isWall && free);
          if (isSky) {
            const ub = P(side * (e1 - 0.6), y - 1.6);
            emit(under, uS, L ? ub : wb, L ? wb : ub, v, !s.hole);
            continue;
          }
          // plateau + falaise
          let A = 0;
          if (isWall && free) for (const a of [14, 9, 5, 2]) { const d = e1 + 0.7 + a + 1.5; if (!this._blocked(s.x + s.rx * side * d, s.z + s.rz * side * d, s.y, s, 1)) { A = a; break; } }
          if (L) s.apL = A; else s.apR = A;
          const top = isWall ? y + H : y - 0.05, base = isWall ? e1 + 0.7 : e0;
          const a0 = P(side * base, top), a1 = P(side * (base + A), top + (A > 0 ? 0.6 : 0));
          emit(apron, aS, L ? a1 : a0, L ? a0 : a1, v, A > 0);
          const c1 = P(side * (base + A + 5), this.groundY);
          emit(cliff, cS, L ? c1 : a1, L ? a1 : c1, v * 0.5, free || !isWall);
        }
        if (isSky) emit(under, st.uB, P(-s.w + 0.6, y - 1.6), P(s.w - 0.6, y - 1.6), v, !s.hole);
      }
    }
    const mesh = (strip, mat, order) => { if (!strip.n) return null; const m = new THREE.Mesh(strip.geo(), mat); if (order) m.renderOrder = order; g.add(m); return m; };
    const roadTex = makeRoadTexture(th.road, isSky);
    mesh(road, toon({ map: roadTex }));
    if (rough.n) {
      const t = loadTex('rock.jpg', 0.5, 0.5);
      mesh(rough, toon({ map: t, color: this.def.theme === 'desert' ? 0xe0b070 : 0x9a7a55 }));
    }
    if (th.shoulder) mesh(shoulder, toon({ map: loadTex(th.shoulder, 1, 2), color: 0xdddddd }));
    if (isSky) {
      mesh(walls, new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 2);
      mesh(under, toon({ color: 0x3a3f7a, side: THREE.DoubleSide }));
    } else {
      mesh(walls, toon({ map: loadTex(th.cliff, 1, 3), side: THREE.DoubleSide, color: 0xffffff }));
      mesh(apron, toon({ map: loadTex(th.ground, 1, 2), side: THREE.DoubleSide }));
      mesh(cliff, toon({ map: loadTex(th.cliff, 1, 1.5), side: THREE.DoubleSide, color: 0xd8c8c0 }));
    }
    // ligne de départ + arche
    const s0 = this.main.samples[0], yaw = Math.atan2(s0.tx, s0.tz);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(s0.w * 2, 3), new THREE.MeshBasicMaterial({ map: makeCheckerTexture(), polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.order = 'YXZ'; line.rotation.y = yaw; line.rotation.x = -Math.PI / 2;
    line.position.set(s0.x, s0.y + 0.06, s0.z); g.add(line);
    const arch = new THREE.Group(); arch.position.set(s0.x, s0.y, s0.z); arch.rotation.y = yaw;
    const pm = toon({ color: 0xff7a1a }), bm = toon({ map: makeCheckerTexture(8, 1) });
    const hw = s0.w + (s0.shL || 0) + 0.5;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9, 10), pm); p.position.set(sx * hw, 4.5, 0); arch.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2, 1.8, 1), bm); beam.position.y = 9; arch.add(beam);
    g.add(arch);
    // plaques de boost
    const padTex = makePadTexture();
    this.padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -3 });
    for (const p of this.pads) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 8), this.padMat);
      m.rotation.order = 'YXZ'; m.rotation.y = Math.atan2(p.tx, p.tz); m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, p.y + 0.08, p.z); g.add(m);
    }
  }

  _buildScenery() {
    const th = this.theme, g = this.group, R = rng(this.def.id.length * 7919 + 13), theme = this.def.theme;
    const S = this.main.samples;
    const far = (x, z, d) => { for (const r of this.ribbons) for (let i = 0; i < r.samples.length; i += 3) { const s = r.samples[i]; if ((s.x - x) ** 2 + (s.z - z) ** 2 < d * d) return false; } return true; };
    const b = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
    S.forEach((s) => { b.x0 = Math.min(b.x0, s.x); b.x1 = Math.max(b.x1, s.x); b.z0 = Math.min(b.z0, s.z); b.z1 = Math.max(b.z1, s.z); });
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
    if (theme !== 'sky') {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(2600, 48), toon({ map: loadTex(th.ground, 260, 260), color: theme === 'desert' ? 0xf2d9a0 : 0xbfe0a0 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(cx, this.groundY, cz); g.add(ground);
      const rock = toon({ map: loadTex(th.cliff, 2, 3), color: theme === 'desert' ? 0xe8a070 : 0xc9b7a8 });
      for (let i = 0; i < 90; i++) {
        const a = R() * 6.283, d = 60 + R() * (span * 0.9), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!far(x, z, 48)) continue;
        const h = 30 + R() * 90, r = 6 + R() * 14;
        const geo = theme === 'desert' && R() < 0.5 ? new THREE.CylinderGeometry(r * 1.6, r * 2.2, h * 0.5, 9) : new THREE.ConeGeometry(r, h, 7);
        const m = new THREE.Mesh(geo, rock); m.position.set(x, this.groundY + (geo.type === 'ConeGeometry' ? h / 2 : h / 4), z);
        m.rotation.y = R() * 6; m.rotation.z = (R() - 0.5) * 0.12; g.add(m);
      }
      // arbres / cactus sur les plateaux
      const leaf = toon({ color: theme === 'desert' ? 0x4f9a55 : 0x2f9a4a }), trunk = toon({ color: 0x7a5236 });
      for (let i = 0; i < S.length; i += 9) {
        const s = S[i], side = R() < 0.5 ? -1 : 1, A = side < 0 ? s.apL : s.apR; if (!A || A < 5 || R() < 0.35) continue;
        const lat = side * (s.w + (side < 0 ? s.shL : s.shR) + 2 + R() * (A - 3)), x = s.x + s.rx * lat, z = s.z + s.rz * lat, y = s.y + th.wallH;
        const t = new THREE.Group(); const sc = 0.8 + R() * 0.9;
        if (theme === 'desert') {
          const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 3.2, 3, 8), leaf); c.position.y = 2.2; t.add(c);
          const a1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.2, 3, 8), leaf); a1.position.set(0.9, 2.4, 0); t.add(a1);
        } else {
          const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2, 6), trunk); tr.position.y = 1; t.add(tr);
          for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(2.2 - k * 0.5, 2.6, 8), leaf); c.position.y = 2.6 + k * 1.5; t.add(c); }
        }
        t.scale.setScalar(sc); t.position.set(x, y, z); g.add(t);
      }
    } else {
      // mer de nuages + îles flottantes + anneaux d'énergie
      const blob = makeBlobTexture();
      const cm = new THREE.SpriteMaterial({ map: blob, color: 0xffe9dc, transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      for (let i = 0; i < 260; i++) {
        const a = R() * 6.283, d = R() * 1100, sp = new THREE.Sprite(cm), sc = 90 + R() * 220;
        sp.position.set(cx + Math.cos(a) * d, this.groundY - 10 - R() * 60, cz + Math.sin(a) * d); sp.scale.set(sc, sc * 0.45, 1); g.add(sp);
      }
      const cm2 = new THREE.SpriteMaterial({ map: blob, color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
      for (let i = 0; i < 40; i++) {
        const a = R() * 6.283, d = 120 + R() * 700, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (!far(x, z, 60)) continue;
        const sp = new THREE.Sprite(cm2), sc = 50 + R() * 90; sp.position.set(x, 30 + R() * 70, z); sp.scale.set(sc, sc * 0.5, 1); g.add(sp);
      }
      const rock = toon({ map: loadTex('rock.jpg', 2, 2), color: 0xb9a0c8 }), grass = toon({ map: loadTex('grass.jpg', 3, 3) });
      for (let i = 0; i < 26; i++) {
        const a = R() * 6.283, d = 80 + R() * 600, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; if (!far(x, z, 55)) continue;
        const r = 10 + R() * 22, h = 18 + R() * 30, y = 10 + R() * 70, isl = new THREE.Group();
        const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), rock); c.rotation.x = Math.PI; c.position.y = -h / 2; isl.add(c);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.2, 8), grass); top.position.y = 0.4; isl.add(top);
        isl.position.set(x, y, z); isl.rotation.y = R() * 6; g.add(isl);
      }
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      for (let i = 20; i < S.length; i += 45) {
        const s = S[i]; if (s.ramp) continue;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(s.w + 5, 0.35, 6, 40), ringMat);
        ring.position.set(s.x, s.y + 3, s.z); ring.rotation.y = Math.atan2(s.tx, s.tz); g.add(ring);
      }
    }
  }

  update(t) { if (this.padMat) this.padMat.map.offset.y = -t * 1.6; }
}
