import * as THREE from 'three';
import { toon, makeGlowTexture } from './gfx.js';

export const ITEMS = {
  boost: { name: 'Aura Dorée', icon: '🔥', desc: 'Turbo surpuissant' },
  blast: { name: 'Onde de Ki', icon: '☄️', desc: 'Projectile à tête chercheuse' },
  shield: { name: 'Bouclier de Ki', icon: '🛡️', desc: 'Pare une attaque' },
  teleport: { name: 'Téléportation', icon: '⚡', desc: 'Bond instantané' },
  cloud: { name: 'Nuage Volant', icon: '☁️', desc: 'Survole tout' },
  wish: { name: 'Vœu des Sept Orbes', icon: '✨', desc: 'Foudre + aura + bouclier' },
};

// Tirage pondéré selon la position (1 = premier ... 6 = dernier)
const WEIGHTS = [
  { shield: 40, blast: 30, boost: 20, cloud: 10 },
  { boost: 30, blast: 30, shield: 20, cloud: 12, teleport: 8 },
  { boost: 30, blast: 28, shield: 16, cloud: 14, teleport: 12 },
  { boost: 34, teleport: 20, cloud: 20, blast: 16, shield: 6, wish: 4 },
  { boost: 35, teleport: 22, cloud: 20, blast: 12, shield: 4, wish: 7 },
  { boost: 34, teleport: 25, cloud: 20, blast: 8, wish: 13 },
];
const SPECIAL = { boost: 40, teleport: 25, cloud: 25, wish: 10 };

export function rollItem(rank, special) {
  const w = special ? SPECIAL : WEIGHTS[Math.min(5, Math.max(0, rank - 1))];
  let tot = 0; for (const k in w) tot += w[k];
  let r = Math.random() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'boost';
}

function orbTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(48, 44, 6, 64, 64, 64); gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.45, '#ffb22e'); gr.addColorStop(1, '#e06a00');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function sparkGeo() { // étincelle à quatre branches au cœur de l'orbe
  const s = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283, r = i % 2 ? 0.12 : 0.5; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  return new THREE.ShapeGeometry(s);
}

export class Items {
  constructor(game) {
    this.game = game; this.group = new THREE.Group(); game.scene.add(this.group);
    const tr = game.track;
    // capsules de bonus
    const capGeo = new THREE.CapsuleGeometry(0.62, 1.0, 6, 14);
    this.caps = tr.caps.map((def) => {
      const m = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: def.special ? 0xffd23a : 0x48e0ff, transparent: true, opacity: 0.78 }));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.22, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: def.special ? 0xffc030 : 0x40d0ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(def.special ? 6 : 4.2);
      const g = new THREE.Group(); g.add(m, band, glow); g.position.set(def.x, def.y, def.z); g.rotation.z = 0.5; if (def.special) g.scale.setScalar(1.3);
      this.group.add(g); return { def, g, alive: true, t: 0 };
    });
    // orbes à collectionner
    const orbMat = toon({ map: orbTexture(), emissive: 0x7a3000 }), sg = sparkGeo(), sm = new THREE.MeshBasicMaterial({ color: 0xfffbe0, side: THREE.DoubleSide });
    const og = new THREE.SphereGeometry(1.05, 20, 14);
    this.orbs = tr.orbs.map((def, i) => {
      const g = new THREE.Group(); g.add(new THREE.Mesh(og, orbMat));
      const sp = new THREE.Mesh(sg, sm); sp.scale.setScalar(1.1); const sp2 = sp.clone(); sp2.rotation.y = Math.PI / 2; g.add(sp, sp2);
      const o = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: 0x3a1500, side: THREE.BackSide })); o.scale.setScalar(1.08); g.add(o);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xffa020, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.setScalar(7); g.add(glow);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 26, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })); beam.position.y = 13; g.add(beam);
      g.position.set(def.x, def.y, def.z); this.group.add(g); return { def, g, taken: false, i };
    });
    this.shots = [];
    this.shotGeo = new THREE.SphereGeometry(0.9, 14, 10);
  }

  dispose() { this.game.scene.remove(this.group); }

  threatened(k) { return this.shots.some((s) => s.owner !== k && Math.abs(s.dist - k.dist) < 45 && s.dist < k.dist); }

  update(dt, t) {
    const game = this.game, P = game.fx.particles;
    for (const c of this.caps) {
      if (!c.alive) { c.t -= dt; if (c.t <= 0) { c.alive = true; c.g.visible = true; } continue; }
      c.g.rotation.y = t * 2.2; c.g.position.y = c.def.y + Math.sin(t * 3 + c.def.x) * 0.25;
      for (const k of game.karts) {
        if (k.respawnT > 0) continue; const dx = k.x - c.def.x, dz = k.z - c.def.z;
        if (dx * dx + dz * dz < 6.2 && Math.abs(k.y - c.def.y) < 4) {
          c.alive = false; c.t = c.def.special ? 6 : 2.5; c.g.visible = false;
          P.burst(c.def.x, c.def.y, c.def.z, 14, 8, c.def.special ? 0xffd040 : 0x60e0ff, 1.8, 0.4);
          if (!k.item && k.rollT <= 0) { k.pending = rollItem(k.rank, c.def.special); k.rollT = k.isPlayer ? 1.1 : 0.6; if (k.isPlayer) game.sfx('pickup'); }
          if (c.def.special && k.isPlayer) game.toast('CAPSULE EXCLUSIVE !');
          break;
        }
      }
    }
    const pl = game.player;
    for (const o of this.orbs) {
      if (o.taken) continue;
      o.g.rotation.y = t * 1.6; o.g.position.y = o.def.y + Math.sin(t * 2.4 + o.i) * 0.2;
      const dx = pl.x - o.def.x, dz = pl.z - o.def.z, r = o.def.air ? 5.5 : 3.6;
      if (pl.respawnT <= 0 && dx * dx + dz * dz < r * r && Math.abs(pl.y + 1 - o.def.y) < (o.def.air ? 7 : 4)) {
        o.taken = true; o.g.visible = false; pl.orbs++;
        P.burst(o.def.x, o.def.y, o.def.z, 30, 14, 0xffb030, 2.4, 0.7); game.fx.flashes.add(o.def.x, o.def.y, o.def.z, 0xffc040, 12, 0.4);
        pl.boost(0.5, 1.22); game.sfx('orb'); game.onOrb(o.i, pl.orbs);
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]; s.life -= dt; s.dist += s.speed * dt;
      // suit la piste et se rabat vers la cible
      let tgt = null, bd = 1e9; for (const k of game.karts) { if (k === s.owner || k.respawnT > 0) continue; const d = k.dist - s.dist; if (d > -4 && d < bd) { bd = d; tgt = k; } }
      if (tgt && bd < 70 && tgt.loc.s && tgt.hasGround) { const tl = tgt.loc.s.rib.isBranch ? 0 : tgt.loc.lat; s.lat += Math.max(-14 * dt, Math.min(14 * dt, tl - s.lat)); }
      const p = game.track.pointAt(s.dist, game.track.main, s.lat);
      s.m.position.set(p.x, p.y + 1.3, p.z); s.m.scale.setScalar(1 + Math.sin(t * 40) * 0.15);
      P.emit(p.x, p.y + 1.3, p.z, 0, 0, 0, 0x80d8ff, 3.2, 0.3); P.emit(p.x + (Math.random() - 0.5), p.y + 1.3 + (Math.random() - 0.5), p.z, 0, 0, 0, 0xffffff, 1.6, 0.2);
      let dead = s.life <= 0;
      for (const k of game.karts) {
        if (k === s.owner || k.respawnT > 0) continue; const dx = k.x - p.x, dz = k.z - p.z;
        if (dx * dx + dz * dz < 12 && Math.abs(k.y - p.y) < 5) { this.explode(p.x, p.y + 1.2, p.z, k, 0x7fd8ff); if (k.hit() && k.isPlayer) game.toast('TOUCHÉ !'); else if (s.owner.isPlayer) game.toast('DANS LE MILLE !'); dead = true; break; }
      }
      if (dead) { this.group.remove(s.m); this.shots.splice(i, 1); }
    }
  }

  explode(x, y, z, k, color) {
    const fx = this.game.fx;
    fx.particles.burst(x, y, z, 40, 22, color, 3.2, 0.6); fx.particles.burst(x, y, z, 20, 12, 0xffffff, 2.2, 0.4);
    fx.flashes.add(x, y, z, 0xffffff, 16, 0.3); fx.flashes.ring(x, y - 0.8, z, color, 14, 0.5);
    const d = Math.hypot(x - this.game.player.x, z - this.game.player.z);
    if (d < 60) { this.game.shake(1 - d / 80); this.game.sfx('boom'); }
  }

  use(k) {
    const it = k.item; if (!it || k.spinT > 0 || k.respawnT > 0) return;
    const game = this.game, fx = game.fx, me = k.isPlayer; k.item = null;
    switch (it) {
      case 'boost': k.boost(3.2, 1.48); fx.flashes.ring(k.x, k.y + 0.3, k.z, 0xffd040, 12, 0.5); if (me) { game.sfx('aura'); game.shake(0.6); game.toast('AURA DORÉE !'); } break;
      case 'shield': k.shieldT = 9; if (me) game.sfx('shield'); break;
      case 'cloud': k.cloudT = 5.5; k.boost(0.4, 1.2); if (me) { game.sfx('cloud'); game.toast('NUAGE VOLANT !'); } break;
      case 'blast': {
        const m = new THREE.Mesh(this.shotGeo, new THREE.MeshBasicMaterial({ color: 0xbff0ff }));
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0x50c0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.setScalar(7); m.add(gl);
        this.group.add(m);
        this.shots.push({ m, owner: k, dist: k.dist + 4, lat: k.loc.s && !k.loc.s.rib.isBranch ? k.loc.lat : 0, speed: Math.max(k.speed, 30) + 42, life: 3.5 });
        fx.flashes.add(k.x, k.y + 1.2, k.z, 0x80d8ff, 7, 0.2); if (me) game.sfx('blast');
        break;
      }
      case 'teleport': {
        const tr = game.track, jump = 60, lat = k.loc.s && !k.loc.s.rib.isBranch ? k.loc.lat * 0.5 : 0;
        fx.particles.burst(k.x, k.y + 1, k.z, 26, 12, 0xb090ff, 2.4, 0.5); fx.flashes.add(k.x, k.y + 1.2, k.z, 0xc0a0ff, 10, 0.3);
        const d0 = k.dist, sp = k.speed; k.place(k.prog + jump, lat, true); k.speed = sp; k.dist = d0 + jump; k.lastSafe = k.prog; k.invT = 0.5;
        fx.particles.burst(k.x, k.y + 1, k.z, 26, 12, 0xb090ff, 2.4, 0.5); fx.flashes.add(k.x, k.y + 1.2, k.z, 0xffffff, 12, 0.3);
        if (me) { game.sfx('teleport'); game.snapCamera(); game.toast('TÉLÉPORTATION !'); }
        break;
      }
      case 'wish': {
        // Puissant mais pas décisif : ralentit ceux de devant, booste et protège le lanceur.
        k.boost(3.0, 1.42); k.shieldT = 6;
        for (const o of game.karts) if (o !== k && o.dist > k.dist && o.respawnT <= 0) {
          if (o.shieldT > 0) { o.shieldT = 0; continue; }
          o.slowT = 3.0; o.boostT = 0;
          fx.flashes.add(o.x, o.y + 2, o.z, 0xa0e0ff, 14, 0.4); fx.particles.burst(o.x, o.y + 1, o.z, 20, 14, 0x90d8ff, 2.2, 0.5);
          if (o.isPlayer) { game.toast('FOUDRE CÉLESTE !'); game.shake(0.8); }
        }
        game.skyFlash = 1; if (me) game.toast('VŒU EXAUCÉ !'); game.sfx('wish'); game.shake(0.7);
        break;
      }
    }
    if (me) game.hud.itemUsed();
  }
}
