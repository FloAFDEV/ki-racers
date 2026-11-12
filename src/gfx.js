import * as THREE from 'three';

// ---------- matériaux cel-shading ----------
let gradient;
export function toon(opts = {}) {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([95, 95, 95, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter; gradient.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ gradientMap: gradient, ...opts });
}

const loader = new THREE.TextureLoader();
const cache = new Map();
export function loadTex(name, rx = 1, ry = 1) {
  const key = name + rx + '_' + ry;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load('./assets/' + name);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
  cache.set(key, t); return t;
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

export function makeRoadTexture(base, neon) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 2); }
    // bandes latérales
    for (let y = 0; y < h; y += 64) for (const x of [0, w - 14]) { g.fillStyle = neon ? '#59e6ff' : '#ff8a1c'; g.fillRect(x, y, 14, 32); g.fillStyle = neon ? '#e9fbff' : '#fff6e6'; g.fillRect(x, y + 32, 14, 32); }
    g.fillStyle = neon ? 'rgba(140,235,255,0.9)' : 'rgba(255,255,255,0.85)'; g.fillRect(w / 2 - 3, 20, 6, 90);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(22, 0, 3, h); g.fillRect(w - 25, 0, 3, h);
  });
}

export function makePadTexture() {
  return canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = 'rgba(255,170,0,0.85)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff7c0'; g.lineWidth = 9; g.lineJoin = 'miter';
    for (let y = -16; y < h + 32; y += 32) { g.beginPath(); g.moveTo(6, y + 26); g.lineTo(w / 2, y); g.lineTo(w - 6, y + 26); g.stroke(); }
  });
}

export function makeCheckerTexture(nx = 16, ny = 2) {
  return canvasTex(nx * 16, ny * 16, (g) => { for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); } }, false);
}

let blobTex;
export function makeBlobTexture() {
  return blobTex ||= canvasTex(128, 128, (g) => {
    for (let i = 0; i < 9; i++) {
      const x = 28 + Math.random() * 72, y = 52 + Math.random() * 28, r = 18 + Math.random() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  }, false);
}

let glowTex;
export function makeGlowTexture() {
  return glowTex ||= canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }, false);
}

let starTex;
export function makeImpactTexture() {
  return starTex ||= canvasTex(128, 128, (g) => {
    g.translate(64, 64); g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283, r = i % 2 ? 22 : 40 + Math.random() * 22; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
  }, false);
}

// ---------- ciel ----------
export function makeSky(file, tint) {
  const tex = loader.load('./assets/' + file); tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { map: { value: tex }, tint: { value: new THREE.Color(tint) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }',
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float u = abs(atan(d.x, d.z)) / 3.14159265;
        float v = clamp((asin(d.y) + 0.09) / 1.05, 0.004, 0.996);
        gl_FragColor = vec4(texture2D(map, vec2(u, v)).rgb * tint, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), mat); m.renderOrder = -10; m.frustumCulled = false;
  return m;
}

// ---------- particules ----------
export class Particles {
  constructor(scene, max = 900) {
    this.max = max; this.n = 0; this.cursor = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.data = new Float32Array(max * 3); // taille, alpha, gravité
    this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.aSize = new Float32Array(max); this.aAlpha = new Float32Array(max);
    g.setAttribute('size', new THREE.BufferAttribute(this.aSize, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.aAlpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: makeGlowTexture() }, scale: { value: 600 } },
      vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float scale; void main(){ vC=color; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*t.a*vA,t.a*vA); }',
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 5; scene.add(this.points);
    this.mat = mat;
  }
  emit(x, y, z, vx, vy, vz, color, size, ttl, grav = 0) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = ((color >> 16) & 255) / 255; this.col[i * 3 + 1] = ((color >> 8) & 255) / 255; this.col[i * 3 + 2] = (color & 255) / 255;
    this.data[i * 3] = size; this.data[i * 3 + 2] = grav; this.life[i] = ttl; this.ttl[i] = ttl;
  }
  burst(x, y, z, n, speed, color, size, ttl, grav = 0, up = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 2, s = speed * (0.4 + Math.random() * 0.6), c = Math.sqrt(Math.max(0, 1 - Math.min(1, e * e)));
      this.emit(x, y, z, Math.cos(a) * c * s, Math.abs(e) * s * 0.7 + up, Math.sin(a) * c * s, color, size * (0.6 + Math.random() * 0.8), ttl * (0.6 + Math.random() * 0.6), grav);
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.aAlpha[i] = 0; continue; }
      this.life[i] -= dt; const k = Math.max(0, this.life[i] / this.ttl[i]);
      this.vel[i * 3 + 1] -= this.data[i * 3 + 2] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.aAlpha[i] = k; this.aSize[i] = this.data[i * 3] * (0.4 + 0.6 * k);
    }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}

// ---------- aura d'énergie (flammes stylisées) ----------
const auraVS = `uniform float time; uniform float power; varying float vH; varying float vF; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  void main(){ vUv = uv; vec3 p = position; float up = clamp(p.y*0.5+0.5, 0.0, 1.0);
    float ang = atan(p.x, p.z);
    float spike = n(vec2(ang*3.0, time*5.0 - up*3.0));
    p.xz *= 1.0 + (spike-0.4)*0.35*up; p.y += up*up*(0.6 + spike*1.3)*power;
    vH = up; vec4 mv = modelViewMatrix*vec4(p,1.0); vec3 nn = normalize(normalMatrix*normal);
    vF = 1.0 - abs(dot(nn, normalize(-mv.xyz))); gl_Position = projectionMatrix*mv; }`;
const auraFS = `uniform vec3 colA; uniform vec3 colB; uniform float power; uniform float time; varying float vH; varying float vF; varying vec2 vUv;
  void main(){ float band = step(0.5, fract(vUv.x*14.0 + sin(vUv.y*9.0 - time*9.0)*0.35));
    float a = (pow(vF, 1.6)*1.1 + 0.12) * (1.0 - vH*0.75) * power;
    a *= 0.75 + 0.5*band; vec3 c = mix(colA, colB, vH + vF*0.3);
    gl_FragColor = vec4(c*a, a); }`;

export function makeAura(colA = 0xfff3a0, colB = 0xff9a10) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, power: { value: 1 }, colA: { value: new THREE.Color(colA) }, colB: { value: new THREE.Color(colB) } },
    vertexShader: auraVS, fragmentShader: auraFS,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat); m.scale.set(2.5, 2.3, 3.4); m.position.y = 1.2; m.renderOrder = 4; m.visible = false;
  return m;
}

export function makeShield() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0x58e0ff) } },
    vertexShader: 'varying float vF; varying vec3 vP; void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vec3 n=normalize(normalMatrix*normal); vF=1.0-abs(dot(n,normalize(-mv.xyz))); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform float time; uniform vec3 color; varying float vF; varying vec3 vP; void main(){ float hex=step(0.82, fract(vP.y*4.0+time*1.5))*0.35; float a=pow(vF,2.2)*1.3+0.08+hex; gl_FragColor=vec4(color*a,a); }',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), mat); m.position.y = 1.2; m.visible = false; m.renderOrder = 4; return m;
}

// Éclairs : segments brisés régénérés en continu
export class Lightning {
  constructor(color = 0x6fd0ff, bolts = 5, seg = 7) {
    this.bolts = bolts; this.seg = seg; this.arr = new Float32Array(bolts * seg * 6);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.arr, 3));
    this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.obj.frustumCulled = false; this.obj.visible = false; this.obj.renderOrder = 6; this.t = 0;
  }
  update(dt, r = 2.6, h = 3.2) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.045;
    let k = 0;
    for (let b = 0; b < this.bolts; b++) {
      const a = Math.random() * 6.283; let x = Math.cos(a) * r * 0.5, y = 0.2, z = Math.sin(a) * r * 0.7;
      for (let s = 0; s < this.seg; s++) {
        const nx = x + (Math.random() - 0.5) * 1.3, ny = y + h / this.seg * (0.5 + Math.random()), nz = z + (Math.random() - 0.5) * 1.3;
        this.arr[k++] = x; this.arr[k++] = y; this.arr[k++] = z; this.arr[k++] = nx; this.arr[k++] = ny; this.arr[k++] = nz;
        x = nx; y = ny; z = nz;
      }
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
  }
}

export function makeCloud() {
  const g = new THREE.Group(), m = toon({ color: 0xffd84a });
  [[0, 0, 0, 1.5], [1.3, -0.1, 0.4, 1.1], [-1.3, -0.1, 0.3, 1.1], [0.5, 0, -1.4, 1.2], [-0.6, 0, 1.5, 1.2], [0, -0.1, -2.4, 0.8]].forEach(([x, y, z, r]) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), m); s.position.set(x, y, z); s.scale.y = 0.6; g.add(s);
  });
  g.visible = false; return g;
}

// Lignes de vitesse en espace écran (accrochées à la caméra)
export function makeSpeedLines() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, power: { value: 0 }, color: { value: new THREE.Color(0xffffff) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv*2.0-1.0; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: `uniform float time; uniform float power; uniform vec3 color; varying vec2 vUv;
      float h(float n){ return fract(sin(n*91.345)*47453.5453); }
      void main(){ float r = length(vUv); float a = atan(vUv.y, vUv.x);
        float id = floor(a*28.6); float f = fract(a*28.6);
        float rnd = h(id + floor(time*14.0)*0.37);
        float line = step(0.72, rnd) * smoothstep(0.5, 0.42, abs(f-0.5)*3.0);
        float mask = smoothstep(0.45 + rnd*0.3, 1.25, r);
        float al = line*mask*power; gl_FragColor = vec4(color*al, al); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; m.renderOrder = 20; return m;
}

// Sprites d'impact / flashs éphémères
export class Flashes {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(x, y, z, color, size, ttl = 0.3, tex = makeImpactTexture()) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: Math.random() * 6 }));
    s.position.set(x, y, z); s.scale.setScalar(size * 0.3); s.renderOrder = 7; this.scene.add(s);
    this.list.push({ s, size, ttl, t: 0 });
  }
  ring(x, y, z, color, size, ttl = 0.5) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 7; this.scene.add(m);
    this.list.push({ s: m, size, ttl, t: 0, ring: true });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t += dt; const k = f.t / f.ttl;
      if (k >= 1) { this.scene.remove(f.s); f.s.material.dispose(); if (f.ring) f.s.geometry.dispose(); this.list.splice(i, 1); continue; }
      const e = 1 - (1 - k) * (1 - k); f.s.scale.setScalar(f.size * (0.3 + 0.7 * e)); f.s.material.opacity = 1 - k * k;
    }
  }
}
