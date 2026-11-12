import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { toon, makeAura, makeShield, makeCloud, Lightning, makeGlowTexture } from './gfx.js';

export const VMAX = 58;
const G = 45, ACC = 34, RADIUS = 1.6;
const MODEL_SCALE = 3.6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- modèle 3D (GLB généré) ----------
let model = null;
export async function loadKartModel() {
  try {
    const gltf = await new GLTFLoader().loadAsync('./assets/kart.glb');
    let mesh = null; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    model = { geo: mesh.geometry, img: mesh.material.map ? mesh.material.map.image : null };
  } catch (e) { console.warn('Modèle kart indisponible, repli procédural', e); model = null; }
}

function hueTexture(img, hue) {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  g.filter = `hue-rotate(${hue}deg) saturate(1.25)`; g.drawImage(img, 0, 0, 1024, 1024);
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x14121c, side: THREE.BackSide });
outlineMat.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * 0.011;'); };

function makeBody(hue, color) {
  const g = new THREE.Group();
  if (model && model.img) {
    const m = new THREE.Mesh(model.geo, toon({ map: hueTexture(model.img, hue) }));
    const o = new THREE.Mesh(model.geo, outlineMat);
    g.add(m, o); g.scale.setScalar(MODEL_SCALE); g.position.y = 0.305 * MODEL_SCALE;
  } else { // repli si le GLB est absent
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 1.8, 6, 14), toon({ color })); b.rotation.x = Math.PI / 2; b.position.y = 0.9; b.scale.set(1.2, 1, 0.8);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), toon({ color: 0x9fe8ff })); c.position.set(0, 1.5, 0.2);
    g.add(b, c);
  }
  return g;
}

export class Kart {
  constructor(game, index, o) {
    this.game = game; this.index = index; this.name = o.name; this.isPlayer = !!o.isPlayer; this.color = o.color;
    this.skill = o.skill ?? 1; this.css = o.css;
    this.inp = { steer: 0, gas: false, brake: false, drift: false, driftPressed: false, item: false };
    this.loc = {};
    // visuel
    this.root = new THREE.Group(); this.tilt = new THREE.Group(); this.body = makeBody(o.hue, o.color);
    this.spinner = new THREE.Group(); this.spinner.add(this.body); this.tilt.add(this.spinner); this.root.add(this.tilt);
    this.flames = [];
    const fm = new THREE.MeshBasicMaterial({ color: 0x66d8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-0.55, 0.55]) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.6, 8), fm); f.rotation.x = -Math.PI / 2; f.position.set(sx, 0.95, -1.9); this.tilt.add(f); this.flames.push(f); }
    this.flameMat = fm;
    this.aura = makeAura(); this.tilt.add(this.aura);
    this.shield = makeShield(); this.root.add(this.shield);
    this.cloud = makeCloud(); this.root.add(this.cloud);
    this.bolts = new Lightning(); this.root.add(this.bolts.obj);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffc040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(9); this.glow.position.y = 1.2; this.root.add(this.glow);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.shadow.rotation.x = -Math.PI / 2; game.scene.add(this.shadow);
    game.scene.add(this.root);
  }

  dispose() { this.game.scene.remove(this.root); this.game.scene.remove(this.shadow); }

  place(prog, lat = 0, keep = false) {
    const tr = this.game.track, p = tr.pointAt(prog, tr.main, lat);
    this.x = p.x; this.z = p.z; this.y = p.y; this.yaw = this.velAng = Math.atan2(p.tx, p.tz);
    this.prog = ((prog % tr.L) + tr.L) % tr.L; this.vy = 0; this.grounded = true; this.surfY = p.y; this.lastGroundY = p.y;
    if (!keep) this.speed = 0;
    this.px = this.pz = 0; this.fallT = 0; this.airT = 0; this.drifting = false; this.charge = 0; this.trickT = 0; this.tricks = 0;
  }

  reset(prog, lat) {
    const L = this.game.track.L;
    this.place(prog, lat);
    this.dist = prog > L / 2 ? prog - L : prog; this.lastSafe = this.prog; this.cp = 0; this.lap = 0;
    this.finished = false; this.finishTime = 0; this.rank = this.index + 1;
    this.item = null; this.rollT = 0; this.boostT = 0; this.boostMul = 1; this.shieldT = 0; this.cloudT = 0; this.spinT = 0; this.slowT = 0; this.invT = 0;
    this.respawnT = 0; this.steer = 0; this.hop = 0; this.wallT = 0; this.orbs = 0; this.spinA = 0; this.padT = 0; this.wrongT = 0;
    this.ai = { lane: (this.index % 3 - 1) * 0.45, laneT: 0, branch: null, decided: -1, itemT: 2 + Math.random() * 3, stuckT: 0 };
    this.speedMul = 1; this.root.visible = true;
  }

  boost(t, mul) { this.boostMul = this.boostT > 0 ? Math.max(this.boostMul, mul) : mul; this.boostT = Math.max(this.boostT, t); this.speed = Math.max(this.speed, VMAX * 0.75) + 6; }

  hit(strength = 1) { // touché par une attaque
    if (this.invT > 0 || this.respawnT > 0) return false;
    if (this.shieldT > 0) { this.shieldT = 0; this.invT = 0.6; this.game.fx.flashes.add(this.x, this.y + 1.3, this.z, 0x7fe8ff, 9, 0.35); this.game.sfx('shield'); return false; }
    this.spinT = 1.1 * strength; this.speed *= 0.3; this.boostT = 0; this.drifting = false; this.charge = 0; this.invT = 2.2; this.cloudT = 0;
    return true;
  }

  respawn() {
    if (this.respawnT > 0) return;
    this.respawnT = 1.0; this.falls = (this.falls || 0) + 1; this.drifting = false; this.boostT = 0; this.cloudT = 0;
    this.game.fx.particles.burst(this.x, this.y + 1, this.z, 16, 9, 0xffffff, 2.2, 0.5);
    if (this.isPlayer) this.game.sfx('fall');
  }

  update(dt) {
    const game = this.game, tr = game.track, L = tr.L, inp = this.inp;
    this.boostT = Math.max(0, this.boostT - dt); this.shieldT = Math.max(0, this.shieldT - dt); this.cloudT = Math.max(0, this.cloudT - dt);
    this.slowT = Math.max(0, this.slowT - dt); this.invT = Math.max(0, this.invT - dt); this.wallT = Math.max(0, this.wallT - dt); this.padT = Math.max(0, this.padT - dt);
    if (this.rollT > 0) { this.rollT -= dt; if (this.rollT <= 0) { this.item = this.pending; this.pending = null; if (this.isPlayer) game.sfx('item'); } }
    if (this.respawnT > 0) {
      this.respawnT -= dt; this.vy -= G * dt; this.y += this.vy * dt;
      if (this.respawnT <= 0) { this.place(this.lastSafe, 0); this.invT = 1.5; this.root.visible = true; if (this.isPlayer) game.snapCamera(); }
      else if (this.respawnT < 0.6) this.root.visible = false;
      return;
    }
    let steer = inp.steer, gas = inp.gas, brake = inp.brake, drift = inp.drift;
    if (this.spinT > 0) { this.spinT -= dt; steer = 0; gas = brake = drift = false; this.spinA += dt * 14; } else this.spinA = 0;
    if (!game.racing) { gas = brake = drift = false; steer = 0; }
    this.steer += clamp(steer - this.steer, -dt * 8, dt * 8);
    const boosting = this.boostT > 0, cloud = this.cloudT > 0;

    // --- dérapage ---
    if (drift && !this.drifting && this.grounded && this.speed > 22 && Math.abs(steer) > 0.25 && !this.driftLock) {
      this.drifting = true; this.driftDir = Math.sign(steer); this.charge = 0; this.hop = 0.22;
    }
    if (!drift) this.driftLock = false;
    if (this.drifting) {
      this.charge += dt * (0.75 + 0.55 * Math.max(0, this.steer * this.driftDir));
      if (!drift || this.speed < 14 || this.airT > 0.45) {
        this.drifting = false;
        const lv = this.driftLevel();
        if (lv > 0 && this.airT <= 0.45) { this.boost([0, 0.7, 1.3, 2.0][lv], 1.27); if (this.isPlayer) { game.sfx('turbo'); game.shake(0.25); } }
        if (drift) this.driftLock = true;
        this.charge = 0;
      }
    }
    // --- figures aériennes ---
    if (this.trickT > 0) this.trickT -= dt;
    if (!this.grounded && inp.driftPressed && this.trickT <= 0 && this.airT > 0.06 && this.tricks < 2 && this.fallT < 0.3) {
      this.trickT = 0.5; this.tricks++; this.trickAxis = Math.abs(this.steer) > 0.3 ? Math.sign(this.steer) : 0;
      if (this.isPlayer) { game.sfx('trick'); game.toast(this.tricks === 2 ? 'DOUBLE FIGURE !' : 'FIGURE !'); }
    }
    inp.driftPressed = false;

    // --- vitesse ---
    let vmax = VMAX * this.speedMul, terrain = 1;
    const lo = this.grounded ? this.ground : null;
    if (lo && !boosting && !cloud) { if (lo.off) terrain = 0.55; else if (lo.rough) terrain = 0.62; }
    vmax *= terrain;
    if (boosting) vmax *= this.boostMul;
    if (cloud) vmax *= 1.12;
    if (this.slowT > 0) vmax *= 0.72;
    if (gas) {
      if (this.speed < vmax) this.speed = Math.min(vmax, this.speed + (boosting ? 80 : ACC * (1.05 - 0.6 * clamp(this.speed / vmax, 0, 1))) * dt);
    } else if (!brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 13 * dt);
    if (brake) this.speed = Math.max(-15, this.speed - (this.speed > 0 ? 60 : 22) * dt);
    if (this.speed > vmax) this.speed -= (this.speed - vmax) * Math.min(1, (terrain < 1 ? 3.2 : 1.8) * dt);

    // --- direction ---
    const sp = Math.abs(this.speed), sf = clamp(sp / 10, 0, 1) * (this.speed >= 0 ? 1 : -1);
    let rate;
    if (this.drifting) rate = this.driftDir * (1.5 + 0.9 * this.steer * this.driftDir);
    else rate = this.steer * (2.35 - 1.0 * clamp(sp / VMAX, 0, 1));
    if (!this.grounded) rate *= 0.3;
    this.yaw -= rate * sf * dt;
    const grip = !this.grounded ? 1.2 : this.drifting ? 2.7 : 9.5;
    this.velAng += wrapA(this.yaw - this.velAng) * Math.min(1, grip * dt);

    this.x += (Math.sin(this.velAng) * this.speed + this.px) * dt; this.z += (Math.cos(this.velAng) * this.speed + this.pz) * dt;
    const pd = Math.exp(-5 * dt); this.px *= pd; this.pz *= pd;

    // --- sol, murs, vide ---
    const loc = tr.locate(this.x, this.z, this.y, this.prog, this.loc);
    let ground = false, surfY = -1e9; this.ground = null;
    if (loc) {
      const s = loc.s, right = loc.lat > 0, sh = right ? s.shR : s.shL, edge = right ? s.eR : s.eL;
      let off = false;
      if (!(s.hole && !cloud)) {
        if (loc.over <= 0) ground = true;
        else if (edge === 'wall' || cloud) {
          if (loc.over <= sh) { ground = true; off = true; }
          else if (this.y < loc.y + 3.5 || cloud) { this._wall(s, loc, sh, right); ground = true; off = sh > 0; }
        } else if (loc.over < 0.7) ground = true;
      }
      if (ground) { surfY = loc.y; this.ground = { off, rough: s.rough, s }; }
      const d = loc.prog - this.prog, dd = d > L / 2 ? d - L : d < -L / 2 ? d + L : d;
      this.dist += dd; this.prog = loc.prog;
    }
    if (this.grounded) {
      if (!ground) { this.grounded = false; this.airT = 0; }
      else {
        const vs = (surfY - this.y) / dt;
        if (vs < this.vy - 14) { this.grounded = false; this.airT = 0; this.tricks = 0; }
        else { this.vy = clamp(vs, -40, 40); this.y = surfY; }
      }
    }
    if (!this.grounded) {
      this.airT += dt; this.vy -= G * dt; this.y += this.vy * dt;
      if (ground && this.y <= surfY) this._land(surfY);
      else if (!ground) { this.fallT += dt; if (this.y < this.lastGroundY - 9 || this.fallT > 2.4) this.respawn(); }
      else this.fallT = 0;
    }
    if (this.grounded) {
      this.fallT = 0; this.lastGroundY = this.y;
      if (this.ground && !this.ground.off && !this.ground.s.hole && this.spinT <= 0) this.lastSafe = this.prog;
      if (cloud && this.ground) this.lastSafe = this.prog;
    }
    this.surfY = ground ? surfY : this.surfY;
    this.hasGround = ground;

    // --- plaques de boost ---
    if (this.grounded && this.padT <= 0) for (const p of tr.pads) {
      const dx = this.x - p.x, dz = this.z - p.z;
      if (Math.abs(dx * p.tx + dz * p.tz) < 4.5 && Math.abs(-dx * p.tz + dz * p.tx) < 3 && Math.abs(this.y - p.y) < 3) {
        this.boost(1.1, 1.3); this.padT = 0.8; if (this.isPlayer) { game.sfx('turbo'); game.shake(0.3); }
      }
    }
    // --- tours / checkpoints ---
    const lapPos = this.dist - this.lap * L;
    if (this.cp < tr.checkpoints.length && lapPos >= tr.checkpoints[this.cp]) this.cp++;
    if (lapPos >= L && this.cp >= tr.checkpoints.length) { this.lap++; this.cp = 0; game.onLap(this); }
    // sens inverse
    const fw = this.ground ? Math.sin(this.velAng) * this.ground.s.tx + Math.cos(this.velAng) * this.ground.s.tz : 1;
    this.wrongT = fw < -0.3 && this.speed > 8 ? this.wrongT + dt : 0;
  }

  driftLevel() { return this.charge > 2.6 ? 3 : this.charge > 1.6 ? 2 : this.charge > 0.75 ? 1 : 0; }

  _wall(s, loc, sh, right) {
    const side = right ? 1 : -1, ex = loc.over - sh;
    this.x -= s.rx * side * ex; this.z -= s.rz * side * ex;
    let vx = Math.sin(this.velAng) * this.speed, vz = Math.cos(this.velAng) * this.speed;
    const vo = (vx * s.rx + vz * s.rz) * side;
    if (vo > 0) {
      vx -= s.rx * side * vo * 1.25; vz -= s.rz * side * vo * 1.25;
      const ns = Math.hypot(vx, vz), loss = clamp(vo / Math.max(8, Math.abs(this.speed)), 0, 1);
      this.speed = Math.sign(this.speed || 1) * ns * (1 - 0.35 * loss);
      if (ns > 1) { const a = Math.atan2(vx, vz); this.velAng = this.speed >= 0 ? a : a + Math.PI; }
      this.yaw += wrapA(this.velAng - this.yaw) * (0.25 + 0.5 * loss);
      if (vo > 7 && this.wallT <= 0) {
        this.wallT = 0.25; const g = this.game;
        g.fx.particles.burst(this.x + s.rx * side * 1.2, this.y + 0.8, this.z + s.rz * side * 1.2, 10, 10, 0xffd070, 1.4, 0.35, 20);
        if (this.isPlayer) { g.shake(Math.min(0.8, vo / 28)); g.sfx('bump'); }
        if (this.drifting && vo > 14) { this.drifting = false; this.charge = 0; }
      }
    }
  }

  _land(surfY) {
    const g = this.game, impact = -this.vy;
    this.y = surfY; this.grounded = true; this.vy = 0;
    if (this.airT > 0.35) {
      g.fx.particles.burst(this.x, this.y + 0.3, this.z, 12, 8, 0xfff0d0, 2, 0.4, 6);
      if (this.isPlayer) { g.shake(clamp(impact / 40, 0.15, 0.6)); g.sfx('land'); }
      if (this.tricks > 0 && this.trickT <= 0.12) {
        this.boost(0.6 + 0.5 * this.tricks, 1.3);
        g.fx.flashes.ring(this.x, this.y + 0.2, this.z, 0xffe070, 9, 0.45);
        if (this.isPlayer) { g.toast(this.tricks === 2 ? 'ATTERRISSAGE PARFAIT ! ++' : 'BONUS D’ATTERRISSAGE !'); g.sfx('turbo'); }
      } else if (this.trickT > 0.12) { this.speed *= 0.7; this.trickT = 0; }
    }
    this.tricks = 0; this.airT = 0;
  }

  // --- rendu ---
  render(dt, t) {
    const r = this.root, g = this.game;
    if (this.respawnT > 0 && this.respawnT < 0.6) { this.shadow.visible = false; return; }
    const hopY = this.hop > 0 ? Math.sin((1 - this.hop / 0.22) * Math.PI) * 0.5 : 0; this.hop = Math.max(0, this.hop - dt);
    const cloud = this.cloudT > 0, lift = cloud ? 1.1 + Math.sin(t * 6) * 0.1 : 0;
    r.position.set(this.x, this.y + hopY + lift + Math.sin(t * 9 + this.index) * 0.03, this.z);
    const dv = this.drifting ? -this.driftDir * 0.42 : 0;
    this.vyaw = (this.vyaw ?? 0) + (dv - (this.vyaw ?? 0)) * Math.min(1, dt * 10);
    r.rotation.y = this.yaw + this.vyaw;
    const slope = this.ground ? this.ground.s.slope : 0;
    const pitch = this.grounded ? -Math.atan(clamp(slope, -0.5, 0.5)) : -Math.atan2(this.vy, Math.max(20, this.speed)) * 0.55;
    this.pitch = (this.pitch ?? 0) + (pitch - (this.pitch ?? 0)) * Math.min(1, dt * 10);
    this.roll = (this.roll ?? 0) + ((this.steer * 0.13 + (this.drifting ? this.driftDir * 0.16 : 0)) - (this.roll ?? 0)) * Math.min(1, dt * 8);
    this.tilt.rotation.set(this.pitch, 0, this.roll);
    const sp = this.spinner; sp.rotation.set(0, 0, 0);
    if (this.spinT > 0) sp.rotation.y = this.spinA;
    if (this.trickT > 0) { const k = 1 - this.trickT / 0.5, a = k * Math.PI * 2; if (this.trickAxis) sp.rotation.z = a * this.trickAxis; else sp.rotation.y = a; }
    r.visible = !(this.invT > 0 && this.spinT <= 0 && Math.floor(t * 14) % 2 === 0);
    // ombre
    this.shadow.visible = this.hasGround !== false; this.shadow.position.set(this.x, this.surfY + 0.07, this.z);
    const sh = clamp(1 - (this.y - this.surfY) / 14, 0.3, 1); this.shadow.scale.setScalar(sh); this.shadow.material.opacity = 0.35 * sh;
    // flammes des réacteurs
    const boosting = this.boostT > 0, big = boosting && this.boostMul > 1.4, thr = clamp(this.speed / VMAX, 0.15, 1) * (boosting ? 2.4 : 1) * (0.85 + Math.random() * 0.3);
    for (const f of this.flames) { f.scale.set(boosting ? 1.5 : 1, thr, boosting ? 1.5 : 1); f.position.z = -1.9 - 0.8 * thr; }
    this.flameMat.color.setHex(boosting ? 0xffc428 : 0x66d8ff);
    // aura + éclairs
    this.aura.visible = boosting; this.bolts.obj.visible = big;
    if (boosting) {
      const u = this.aura.material.uniforms; u.time.value = t; u.power.value = big ? 1 : 0.55;
      if (big) { u.colA.value.setHex(0xfff6b0); u.colB.value.setHex(0xffa200); } else { u.colA.value.setHex(0xd6f4ff); u.colB.value.setHex(0x3aa8ff); }
      this.aura.scale.set(big ? 2.7 : 2.0, big ? 2.5 : 1.7, big ? 3.6 : 3.0);
      if (big) this.bolts.update(dt);
    }
    this.glow.material.opacity += ((big ? 0.55 : 0) - this.glow.material.opacity) * Math.min(1, dt * 8);
    this.shield.visible = this.shieldT > 0; if (this.shieldT > 0) this.shield.material.uniforms.time.value = t;
    this.cloud.visible = cloud; if (cloud) this.cloud.position.y = -0.5 - lift * 0.4;
    // particules
    const P = g.fx.particles, bx = this.x - Math.sin(this.yaw) * 1.7, bz = this.z - Math.cos(this.yaw) * 1.7;
    if (this.drifting && this.grounded) {
      const lv = this.driftLevel(), col = [0xcfd8e0, 0x4fc3ff, 0xffa530, 0xff4fd8][lv], sx = Math.cos(this.yaw) * this.driftDir, sz = -Math.sin(this.yaw) * this.driftDir;
      for (let i = 0; i < (lv ? 2 : 1); i++) P.emit(bx - sx * 0.9, this.y + 0.25, bz - sz * 0.9, (Math.random() - 0.5) * 6 - sx * 3, 2 + Math.random() * 5, (Math.random() - 0.5) * 6 - sz * 3, col, lv ? 1.1 + lv * 0.25 : 1.6, 0.3, 14);
    }
    if (boosting && Math.random() < 0.8) P.emit(bx + (Math.random() - 0.5), this.y + 0.9, bz + (Math.random() - 0.5), -Math.sin(this.yaw) * 10, Math.random() * 3, -Math.cos(this.yaw) * 10, big ? 0xffc040 : 0x60c8ff, 2.2, 0.35);
    if (this.grounded && this.ground && (this.ground.off || this.ground.rough) && this.speed > 12 && Math.random() < 0.6) P.emit(bx, this.y + 0.3, bz, (Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5, g.dustColor, 2.6, 0.5, 4);
  }
}

// ---------- collisions entre karts ----------
export function collideKarts(karts, game) {
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
    if (a.respawnT > 0 || b.respawnT > 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = RADIUS * 2;
    if (d2 > min * min || d2 < 1e-6 || Math.abs(a.y - b.y) > 2.5) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = (min - d) / 2;
    const wa = (a.boostT > 0 || a.shieldT > 0 ? 3 : 1), wb = (b.boostT > 0 || b.shieldT > 0 ? 3 : 1), tot = wa + wb;
    a.x -= nx * pen * 2 * wb / tot; a.z -= nz * pen * 2 * wb / tot; b.x += nx * pen * 2 * wa / tot; b.z += nz * pen * 2 * wa / tot;
    const rel = (Math.sin(a.velAng) * a.speed - Math.sin(b.velAng) * b.speed) * nx + (Math.cos(a.velAng) * a.speed - Math.cos(b.velAng) * b.speed) * nz;
    const imp = 5 + Math.max(0, rel) * 0.45;
    a.px -= nx * imp * wb / tot * 2; a.pz -= nz * imp * wb / tot * 2; b.px += nx * imp * wa / tot * 2; b.pz += nz * imp * wa / tot * 2;
    if (rel > 4) {
      // celui de derrière perd un peu de vitesse, celui de devant est poussé
      const fa = Math.sin(a.velAng) * nx + Math.cos(a.velAng) * nz;
      if (fa > 0) { a.speed *= 0.93; b.speed = Math.min(b.speed + rel * 0.25, VMAX * 1.3); } else { b.speed *= 0.93; a.speed = Math.min(a.speed + rel * 0.25, VMAX * 1.3); }
      if ((a.wallT <= 0 || b.wallT <= 0)) {
        a.wallT = b.wallT = 0.3;
        game.fx.particles.burst((a.x + b.x) / 2, a.y + 1, (a.z + b.z) / 2, 8, 9, 0xffffff, 1.5, 0.3, 10);
        if (a.isPlayer || b.isPlayer) { game.shake(0.4); game.sfx('bump'); game.fx.flashes.add((a.x + b.x) / 2, a.y + 1.4, (a.z + b.z) / 2, 0xffffff, 5, 0.22); }
      }
    }
  }
}

// ---------- IA ----------
export function driveAI(k, game, dt) {
  const tr = game.track, L = tr.L, ai = k.ai, inp = k.inp, player = game.player;
  // choix des raccourcis
  for (const rib of tr.ribbons) {
    if (!rib.isBranch) continue;
    let d = rib.sFrom - k.prog; d = ((d % L) + L) % L;
    if (d < 60 && d > 25 && ai.decided !== rib.id * 100 + k.lap) {
      ai.decided = rib.id * 100 + k.lap; const sc = rib.def; let take = false;
      if (sc.aiNeedsBoost) { if (k.item === 'boost' || k.item === 'cloud') { take = Math.random() < 0.85; ai.useAtFork = take; } else take = k.boostT > 1.2; }
      else if (sc.aiSpeed) take = k.speed > sc.aiSpeed && Math.random() < 0.3 + 0.5 * k.skill;
      else take = Math.random() < (sc.aiSkill ?? 0.5) * k.skill;
      ai.branch = take ? rib : null;
    }
    if (ai.branch === rib) { const pd = ((k.prog - rib.sFrom) % L + L) % L; if (pd > rib.span + 5 && pd < L / 2) ai.branch = null; }
  }
  const br = ai.branch;
  if (br && ai.useAtFork) { let d = ((br.sFrom - k.prog) % L + L) % L; if (d < 8 || d > L - 20) { ai.useAtFork = false; if (k.item) game.items.use(k); } }
  const look = 12 + k.speed * 0.42;
  const target = (dist) => {
    const p = k.prog + dist;
    if (br) { const rel = ((p - br.sFrom) % L + L) % L; if (rel < br.span) return tr.pointAt(br.sFrom + rel, br, 0); }
    return tr.pointAt(p, tr.main, 0);
  };
  // trajectoire latérale
  ai.laneT -= dt; if (ai.laneT <= 0) { ai.laneT = 2 + Math.random() * 3; ai.laneGoal = (Math.random() * 2 - 1) * 0.6; }
  let goal = ai.laneGoal ?? ai.lane;
  for (const o of game.karts) { // évitement
    if (o === k || o.respawnT > 0) continue; const dx = o.x - k.x, dz = o.z - k.z, f = dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw);
    if (f > 0 && f < 14 && o.speed < k.speed + 2) { const side = -dx * Math.cos(k.yaw) + dz * Math.sin(k.yaw); if (Math.abs(side) < 3) goal += (side > 0 ? -1 : 1) * 0.5; }
  }
  for (const c of game.items.caps) { // viser les capsules quand on n'a pas d'objet
    if (!c.alive || c.def.prog < 0 || k.item || k.rollT > 0) continue; const d = ((c.def.prog - k.prog) % L + L) % L;
    if (d < 70 && d > 5) { const w = tr.sampleAt(c.def.prog).w; goal = Math.abs(goal - c.def.lat / w) < 0.5 ? c.def.lat / w : goal; }
  }
  ai.lane += clamp(clamp(goal, -0.7, 0.7) - ai.lane, -dt * 0.8, dt * 0.8);
  const tp = target(look), s = tp.s, voidEdge = s.eL === 'void' || s.eR === 'void';
  const lat = br && tp.s.rib === br ? 0 : ai.lane * (s.w - (voidEdge ? 3.2 : 1.8));
  const tx = tp.x - tp.tz * lat, tz = tp.z + tp.tx * lat;
  const diff = wrapA(Math.atan2(tx - k.x, tz - k.z) - k.yaw);
  let steer = clamp(-diff * 2.6, -1, 1);
  // vitesse cible selon la courbure à venir
  const rib = br && target(8).s.rib === br ? br : tr.main;
  const kc = tr.maxCurv(k.prog + 6, 10 + k.speed * 0.75, rib);
  let vT = Math.sqrt((62 + 26 * k.skill) / Math.max(kc, 1e-4));
  if (rib !== tr.main && rib.def.eL === 'void') vT = Math.min(vT, 46);
  inp.gas = k.speed < vT; inp.brake = k.speed > vT + 5 && k.grounded;
  // dérapage dans les virages serrés
  const near = tr.maxCurv(k.prog, 22, rib);
  const wantDrift = near > 0.014 && Math.abs(steer) > 0.3 && k.speed > 30 && k.grounded && !voidEdge && rib === tr.main;
  if (k.drifting) { if (near < 0.008 || Math.sign(steer) !== k.driftDir && Math.abs(steer) > 0.5 || k.driftLevel() >= 2 && near < 0.012) inp.drift = false; }
  else inp.drift = wantDrift;
  if (k.drifting) steer = clamp(-diff * 3.2, -1, 1);
  inp.steer = steer;
  // figure sur les sauts
  if (!k.grounded && k.airT > 0.15 && k.tricks === 0 && k.vy > 2 && Math.random() < 0.08 * k.skill + 0.02) inp.driftPressed = true;
  // élastique (équilibrage)
  const gap = k.dist - player.dist;
  k.speedMul = (0.915 + 0.085 * k.skill) * (gap < -70 ? 1.06 : gap < -25 ? 1.03 : gap > 110 ? 0.94 : gap > 50 ? 0.97 : 1);
  // blocage
  if (game.racing && k.speed < 4 && k.respawnT <= 0 && k.spinT <= 0) { ai.stuckT += dt; if (ai.stuckT > 2.2) { ai.stuckT = 0; k.lastSafe = k.prog; k.respawn(); } } else ai.stuckT = 0;
  // utilisation des objets
  if (k.item && game.racing) {
    ai.itemT -= dt;
    if (ai.itemT <= 0) {
      const straight = tr.maxCurv(k.prog, 60) < 0.006; let use = false;
      switch (k.item) {
        case 'boost': case 'cloud': case 'teleport': use = straight && k.grounded && !ai.useAtFork; break;
        case 'blast': use = game.karts.some((o) => o !== k && o.dist > k.dist && o.dist - k.dist < 75 && o.respawnT <= 0); break;
        case 'shield': use = game.items.threatened(k) || Math.random() < 0.01; break;
        default: use = true;
      }
      if (use) { game.items.use(k); ai.itemT = 1.5 + Math.random() * 3; }
    }
  }
}
