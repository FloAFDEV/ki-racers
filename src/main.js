import * as THREE from 'three';
import { TRACKS } from './tracks.js';
import { Track } from './track.js';
import { Kart, VMAX, loadKartModel, collideKarts, driveAI } from './kart.js';
import { Items, ITEMS } from './items.js';
import { Particles, Flashes, makeSky, makeSpeedLines } from './gfx.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const LAPS = 3, STEP = 1 / 60, POINTS = [10, 7, 5, 3, 2, 1];
const RACERS = [
  { name: 'VOUS', hue: 0, css: '#ff8a1c', color: 0xff8a1c, isPlayer: true },
  { name: 'Raiko', hue: 200, css: '#4d7dff', color: 0x4d7dff, skill: 1.0 },
  { name: 'Mizu', hue: 150, css: '#2fd6c8', color: 0x2fd6c8, skill: 0.88 },
  { name: 'Tora', hue: 60, css: '#8ad63a', color: 0x8ad63a, skill: 0.76 },
  { name: 'Kaze', hue: 270, css: '#d65ae0', color: 0xd65ae0, skill: 0.64 },
  { name: 'Yuki', hue: 320, css: '#ff4d6a', color: 0xff4d6a, skill: 0.52 },
];
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const params = new URLSearchParams(location.search);

class Game {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.3, 6000);
    this.scene.add(this.camera);
    this.speedLines = makeSpeedLines(); this.camera.add(this.speedLines);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93b0, 1.7));
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.0); this.sun.position.set(0.5, 1, 0.35); this.scene.add(this.sun);
    this.fx = { particles: new Particles(this.scene), flashes: new Flashes(this.scene) };
    this.audio = new Sfx();
    this.karts = []; this.state = 'menu'; this.racing = false; this.time = 0; this.raceTime = 0; this.acc = 0; this.shakeA = 0; this.skyFlash = 0;
    this.cam = { yaw: 0, y: 0, fov: 66, x: 0, z: 0 };
    this.keys = {}; this.touch = { l: false, r: false, gas: false, drift: false, brake: false };
    this.auto = params.has('auto');
    this.hud = new Hud(this);
    this._bindInput(); this._bindUi();
    addEventListener('resize', () => this.resize()); this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fx.particles.mat.uniforms.scale.value = h * 0.9;
  }

  // ---------- circuits ----------
  loadTrack(index) {
    if (this.track) { this.scene.remove(this.track.group); this.scene.remove(this.sky); this.items.dispose(); this.karts.forEach((k) => k.dispose()); }
    this.trackIndex = index; const def = TRACKS[index];
    this.track = new Track(def); this.scene.add(this.track.group);
    const th = this.track.theme;
    this.sky = makeSky(th.sky, th.skyTint); this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(th.fog, def.theme === 'sky' ? 600 : 260, def.theme === 'sky' ? 3600 : 1500);
    this.sun.color.setHex(th.sun);
    this.dustColor = def.theme === 'mountain' ? 0x9ad08a : def.theme === 'desert' ? 0xf0d090 : 0xffffff;
    this.items = new Items(this);
    this.karts = RACERS.map((r, i) => new Kart(this, i, r));
    this.player = this.karts[0];
    // grille de départ : le joueur part dernier
    const order = [1, 2, 3, 4, 5, 0], L = this.track.L;
    order.forEach((ki, slot) => this.karts[ki].reset(L - 9 - Math.floor(slot / 2) * 8 - (slot % 2) * 3, slot % 2 ? 3.6 : -3.6));
    this.raceTime = 0; this.racing = false; this.finishT = 0; this.countT = 3.6; this.lastCount = 4;
    this.state = 'countdown'; this.hud.start(def); this.snapCamera();
  }

  startTournament() { this.tour = { round: 0, points: RACERS.map(() => 0) }; this.loadTrack(0); }
  startQuick(i) { this.tour = null; this.loadTrack(i); }

  onLap(k) {
    if (k.lap >= LAPS && !k.finished) { k.finished = true; k.finishTime = this.raceTime; if (k.isPlayer) { this.finishT = 3; this.toast(k.rank === 1 ? 'VICTOIRE !' : 'ARRIVÉE !'); this.sfx('finish'); } }
    else if (k.isPlayer) { if (k.lap === LAPS - 1) { this.toast('DERNIER TOUR !'); this.sfx('lap'); } else this.toast('TOUR ' + (k.lap + 1)); }
  }

  onOrb(i, count) {
    this.hud.orb(i);
    if (count === 7) { const p = this.player; p.rollT = 0; p.pending = null; p.item = 'wish'; this.toast('7 ORBES ! VŒU DISPONIBLE'); this.skyFlash = 0.8; this.sfx('wish'); }
    else this.toast('ORBE ' + count + '/7');
  }

  toast(msg) { this.hud.toast(msg); }
  shake(a) { this.shakeA = Math.max(this.shakeA, a); }
  sfx(n) { this.audio.play(n); }

  ranking() {
    return [...this.karts].sort((a, b) => (a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist));
  }

  endRace() {
    this.state = 'results'; this.racing = false; this.audio.engine(0, false);
    const order = this.ranking(), tour = this.tour;
    if (tour) order.forEach((k, i) => { tour.points[k.index] += POINTS[i]; });
    this.hud.results(order, tour, this.trackIndex);
  }

  // ---------- simulation ----------
  playerInput() {
    const k = this.keys, t = this.touch, inp = this.player.inp;
    const l = k.ArrowLeft || k.KeyA || t.l, r = k.ArrowRight || k.KeyD || t.r;
    inp.steer = (r ? 1 : 0) - (l ? 1 : 0);
    inp.gas = !!(k.ArrowUp || k.KeyW || t.gas); inp.brake = !!(k.ArrowDown || k.KeyS || t.brake);
    inp.drift = !!(k.Space || t.drift);
  }

  step(dt) {
    this.time += dt;
    if (this.state === 'countdown') {
      this.countT -= dt; const n = Math.ceil(this.countT - 0.6);
      if (n !== this.lastCount && n >= 0 && n <= 3) { this.lastCount = n; this.hud.count(n); this.sfx(n === 0 ? 'go' : 'beep'); }
      if (this.countT <= 0.6 && !this.racing) { this.racing = true; this.state = 'race'; }
    }
    if (this.state !== 'race' && this.state !== 'countdown') return;
    if (this.racing) this.raceTime += dt;
    const p = this.player;
    if (this.auto || p.finished) driveAI(p, this, dt); else this.playerInput();
    for (const k of this.karts) if (!k.isPlayer) driveAI(k, this, dt);
    for (const k of this.karts) k.update(dt);
    collideKarts(this.karts, this);
    this.items.update(dt, this.time);
    this.ranking().forEach((k, i) => { k.rank = i + 1; });
    if (this.finishT > 0) { this.finishT -= dt; if (this.finishT <= 0) this.endRace(); }
  }

  simulate(sec) { for (let i = 0; i < sec / STEP; i++) this.step(STEP); } // tests

  useItem() { if (this.state === 'race' && !this.player.finished) this.items.use(this.player); }

  // ---------- caméra ----------
  snapCamera() { const p = this.player; this.cam.yaw = p.yaw; this.cam.y = p.y; this.cam.x = p.x; this.cam.z = p.z; }

  updateCamera(dt) {
    const p = this.player, c = this.cam, cam = this.camera;
    if (p.respawnT > 0 || p.fallT > 0.9) { this.sky.position.copy(cam.position); cam.lookAt(p.x, Math.max(p.y, c.y - 6), p.z); return; }
    const sr = clamp(p.speed / VMAX, 0, 1.6), boosting = p.boostT > 0;
    const tgt = p.velAng + wrapA(p.yaw - p.velAng) * 0.4;
    c.yaw += wrapA(tgt - c.yaw) * Math.min(1, dt * (p.drifting ? 4 : 7));
    c.y += (p.y - c.y) * Math.min(1, dt * (p.grounded ? 10 : 5));
    c.x += (p.x - c.x) * Math.min(1, dt * 18); c.z += (p.z - c.z) * Math.min(1, dt * 18);
    const dist = 8.4 + sr * 1.6 + (boosting ? 1.6 : 0) + (this.state === 'countdown' ? Math.max(0, this.countT - 0.6) * 2.5 : 0), h = 3.5 + (p.grounded ? 0 : 0.8);
    const sx = Math.sin(c.yaw), cz = Math.cos(c.yaw);
    const sh = this.shakeA; this.shakeA = Math.max(0, sh - dt * 2.2);
    cam.position.set(c.x - sx * dist + (Math.random() - 0.5) * sh, c.y + h + (Math.random() - 0.5) * sh, c.z - cz * dist + (Math.random() - 0.5) * sh);
    cam.lookAt(p.x + sx * 7, p.y + 1.5 + (p.y - c.y) * 0.3, p.z + cz * 7);
    cam.rotation.z += -p.steer * 0.035 * sr - (p.drifting ? p.driftDir * 0.05 : 0);
    const fov = 64 + 13 * Math.min(1, sr) + (boosting ? 12 : 0);
    c.fov += (fov - c.fov) * Math.min(1, dt * 5);
    if (Math.abs(cam.fov - c.fov) > 0.05) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    const u = this.speedLines.material.uniforms; u.time.value = this.time;
    const pw = clamp((sr - 0.92) * 3, 0, 0.45) + (boosting ? (p.boostMul > 1.4 ? 1 : 0.6) : 0);
    u.power.value += (pw - u.power.value) * Math.min(1, dt * 8);
    u.color.value.setHex(boosting && p.boostMul > 1.4 ? 0xffe9a0 : 0xffffff);
    this.sky.position.copy(cam.position);
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.state === 'paused' || !this.track) { if (this.track) this.renderer.render(this.scene, this.camera); return; }
    this.acc += dt; let n = 0;
    while (this.acc >= STEP && n < 6) { this.step(STEP); this.acc -= STEP; n++; }
    if (n === 6) this.acc = 0;
    for (const k of this.karts) k.render(dt, this.time);
    this.fx.particles.update(dt); this.fx.flashes.update(dt); this.track.update(this.time);
    this.updateCamera(dt);
    if (this.skyFlash > 0) { this.skyFlash = Math.max(0, this.skyFlash - dt * 1.6); $('flash').style.opacity = this.skyFlash * 0.7; }
    this.hud.update(dt);
    this.audio.engine(this.player.speed / VMAX, this.state === 'race' || this.state === 'countdown', this.player.boostT > 0, this.player.drifting && this.player.grounded);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- entrées ----------
  _bindInput() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return; this.keys[e.code] = true; this.audio.unlock();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space') this.player && (this.player.inp.driftPressed = true);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE' || e.code === 'Enter' && this.state === 'race') this.useItem();
      if (e.code === 'KeyR' && this.state === 'race') this.player.respawn();
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    const bind = (id, key, onDown) => {
      const el = $(id);
      const down = (e) => { e.preventDefault(); this.audio.unlock(); el.classList.add('down'); if (key) this.touch[key] = true; if (onDown) onDown(); try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
      const up = (e) => { e.preventDefault(); el.classList.remove('down'); if (key) this.touch[key] = false; };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    };
    bind('tL', 'l'); bind('tR', 'r'); bind('tGas', 'gas'); bind('tBrake', 'brake');
    bind('tDrift', 'drift', () => { if (this.player) this.player.inp.driftPressed = true; });
    bind('tItem', null, () => this.useItem());
    const enableTouch = () => document.body.classList.add('touch');
    if (matchMedia('(pointer: coarse)').matches || params.has('touch')) enableTouch();
    addEventListener('touchstart', enableTouch, { once: true, passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  togglePause() {
    if (this.state === 'race') { this.prev = 'race'; this.state = 'paused'; $('pause').classList.add('on'); this.audio.engine(0, false); }
    else if (this.state === 'paused') { this.state = this.prev; $('pause').classList.remove('on'); this.last = performance.now(); }
  }

  _bindUi() {
    const go = (fn) => () => { this.audio.unlock(); fn(); };
    $('bTour').onclick = go(() => this.startTournament());
    TRACKS.forEach((t, i) => { const b = document.createElement('button'); b.className = 'btn alt'; b.textContent = t.name; b.onclick = go(() => this.startQuick(i)); $('quick').appendChild(b); });
    $('bMenu').onclick = $('bQuit').onclick = () => this.toMenu();
    $('bResume').onclick = () => this.togglePause();
    $('bRestart').onclick = () => { $('pause').classList.remove('on'); this.loadTrack(this.trackIndex); };
    $('pauseBtn').onclick = () => this.togglePause();
    $('bNext').onclick = () => {
      $('results').classList.remove('on');
      if (this.tour && this.tour.round < TRACKS.length - 1) { this.tour.round++; this.loadTrack(this.tour.round); }
      else if (this.tour) this.toMenu(); else this.loadTrack(this.trackIndex);
    };
  }

  toMenu() {
    this.state = 'menu'; ['results', 'pause'].forEach((id) => $(id).classList.remove('on')); $('menu').classList.add('on');
    $('hud').style.display = 'none'; $('touch').classList.remove('on'); this.audio.engine(0, false);
  }
}

// ---------- HUD ----------
class Hud {
  constructor(game) { this.g = game; this.map = $('map').getContext('2d'); this.orbEls = [...$('orbs').children]; this.rouT = 0; }

  start(def) {
    ['menu', 'results', 'pause'].forEach((id) => $(id).classList.remove('on'));
    $('hud').style.display = 'block'; $('touch').classList.add('on');
    this.orbEls.forEach((e) => e.classList.remove('on')); $('count').textContent = ''; this.itemShown = undefined;
    this.toast(def.name.toUpperCase());
  }

  toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
  count(n) { const c = $('count'); c.textContent = n === 0 ? 'GO !' : n; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); if (n === 0) setTimeout(() => { if (c.textContent === 'GO !') c.textContent = ''; }, 900); }
  orb(i) { this.orbEls[i].classList.add('on'); }
  itemUsed() { this.itemShown = undefined; }

  update(dt) {
    const g = this.g, p = g.player; if (!p) return;
    $('pos').firstChild.nodeValue = p.rank; $('lap').textContent = Math.min(LAPS, p.lap + 1); $('time').textContent = fmt(g.raceTime);
    $('speed').firstChild.nodeValue = Math.round(Math.abs(p.speed) * 3.9) + ' ';
    const lv = p.driftLevel(), bar = $('bar').firstElementChild;
    if (p.drifting) { bar.style.width = clamp(p.charge / 2.6, 0, 1) * 100 + '%'; bar.style.background = ['#cfd8e0', '#4fc3ff', '#ffa530', '#ff4fd8'][lv]; }
    else if (p.boostT > 0) { bar.style.width = clamp(p.boostT / 3, 0, 1) * 100 + '%'; bar.style.background = '#ffd83a'; } else bar.style.width = '0%';
    // bonus
    const box = $('itembox');
    if (p.rollT > 0) { this.rouT -= dt; if (this.rouT <= 0) { this.rouT = 0.07; const ks = Object.keys(ITEMS); $('itemicon').textContent = ITEMS[ks[Math.floor(Math.random() * ks.length)]].icon; } $('itemname').textContent = ''; box.classList.remove('has'); this.itemShown = '?'; }
    else if (this.itemShown !== p.item) { this.itemShown = p.item; $('itemicon').textContent = p.item ? ITEMS[p.item].icon : ''; $('itemname').textContent = p.item ? ITEMS[p.item].name : ''; box.classList.toggle('has', !!p.item); }
    $('wrong').style.display = p.wrongT > 1 ? 'block' : 'none';
    $('help').style.display = g.raceTime > 9 ? 'none' : '';
    this.drawMap();
  }

  drawMap() {
    const g = this.g, c = this.map, tr = g.track, b = tr.bounds, W = 360, pad = 26;
    const sc = Math.min((W - pad * 2) / (b.x1 - b.x0), (W - pad * 2) / (b.z1 - b.z0));
    const X = (x) => W / 2 + (x - (b.x0 + b.x1) / 2) * sc, Y = (z) => W / 2 - (z - (b.z0 + b.z1) / 2) * sc;
    c.clearRect(0, 0, W, W); c.lineJoin = c.lineCap = 'round';
    tr.outline.forEach((pts, i) => {
      c.beginPath(); pts.forEach(([x, z], j) => (j ? c.lineTo(X(x), Y(z)) : c.moveTo(X(x), Y(z)))); if (i === 0) c.closePath();
      c.strokeStyle = i === 0 ? 'rgba(20,18,28,.9)' : 'rgba(20,18,28,.9)'; c.lineWidth = i === 0 ? 13 : 8; c.setLineDash([]); c.stroke();
      c.strokeStyle = i === 0 ? '#fff' : '#ffd83a'; c.lineWidth = i === 0 ? 7 : 3; c.setLineDash(i === 0 ? [] : [6, 6]); c.stroke();
    });
    c.setLineDash([]);
    const s0 = tr.main.samples[0]; c.fillStyle = '#14121c'; c.fillRect(X(s0.x) - 3, Y(s0.z) - 9, 6, 18);
    for (const o of g.items.orbs) if (!o.taken) { c.beginPath(); c.arc(X(o.def.x), Y(o.def.z), 5, 0, 6.3); c.fillStyle = '#ff9a1c'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff3c0'; c.stroke(); }
    for (let i = g.karts.length - 1; i >= 0; i--) {
      const k = g.karts[i]; c.beginPath(); c.arc(X(k.x), Y(k.z), k.isPlayer ? 10 : 7, 0, 6.3); c.fillStyle = k.css; c.fill();
      c.lineWidth = k.isPlayer ? 4 : 2; c.strokeStyle = k.isPlayer ? '#fff' : '#14121c'; c.stroke();
    }
  }

  results(order, tour, trackIndex) {
    $('hud').style.display = 'none'; $('touch').classList.remove('on');
    const g = this.g, me = g.player, last = tour && tour.round === TRACKS.length - 1;
    $('resSub').textContent = tour ? `TOURNOI · MANCHE ${tour.round + 1}/${TRACKS.length} · ${TRACKS[trackIndex].name}` : TRACKS[trackIndex].name;
    let rows = order;
    if (tour && last) rows = [...g.karts].sort((a, b) => tour.points[b.index] - tour.points[a.index]);
    const place = rows.indexOf(me) + 1;
    $('resTitle').textContent = tour && last ? (place === 1 ? 'CHAMPION !' : `CLASSEMENT FINAL · ${place}e`) : (me.rank === 1 ? 'VICTOIRE !' : `${me.rank}e PLACE`);
    $('resTable').innerHTML = rows.map((k, i) => `<tr class="${k.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span style="color:${k.css}">●</span> ${k.name}</td>`
      + (tour && last ? '' : `<td class="n">${k.finished ? fmt(k.finishTime) : '—'}</td>`)
      + (tour ? `<td class="n">${last ? '' : '+' + POINTS[order.indexOf(k)] + ' · '}${tour.points[k.index]} pts</td>` : '')
      + (k.isPlayer ? `<td class="n">✦ ${k.orbs}/7</td>` : '<td></td>') + '</tr>').join('');
    $('bNext').textContent = tour ? (last ? 'TERMINER' : 'CIRCUIT SUIVANT ▶') : 'REJOUER';
    $('results').classList.add('on');
  }
}

// ---------- démarrage ----------
(async () => {
  await loadKartModel();
  const game = new Game(); window.__game = game;
  $('loading').style.display = 'none'; $('menuBtns').style.display = 'flex';
  if (params.has('track')) game.startQuick(+params.get('track') || 0);
})();
