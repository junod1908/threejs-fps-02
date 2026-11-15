// HARBOURFALL — fx.js
// Transient visuals, all pooled and preallocated: tracers, hit sparks,
// muzzle flashes, the detpack explosion and smoke clouds. Nothing here is
// created per frame — update() advances lifetimes and hides what expired.

import * as THREE from 'three';

const TRACERS = 40;
const SPARKS = 360;
const FLASHES = 12;
const SMOKES = 40;

let scene = null;
let tracers = [], sparks = null, flashes = [], smokes = [];
let sparkVel = null, sparkLife = null, sparkPos = null;
let boomLight = null, boomShell = null, boomAt = -99;

function gradientSprite(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Sprite(mat);
}

export function initFx(s) {
  scene = s;
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACERS; i++) {
    const line = new THREE.Line(tGeo.clone(), new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, until: 0 });
  }
  sparkPos = new Float32Array(SPARKS * 3);
  sparkVel = new Float32Array(SPARKS * 3);
  sparkLife = new Float32Array(SPARKS);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({
    color: 0xffc37a, size: 0.09, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  for (let i = 0; i < FLASHES; i++) {
    const spr = gradientSprite('rgba(255,230,160,1)', 'rgba(255,140,40,0)');
    spr.scale.set(0.55, 0.55, 1);
    spr.visible = false;
    scene.add(spr);
    flashes.push({ spr, until: 0 });
  }
  for (let i = 0; i < SMOKES; i++) {
    const spr = gradientSprite('rgba(168,175,186,0.55)', 'rgba(168,175,186,0)');
    spr.visible = false;
    scene.add(spr);
    smokes.push({ spr, born: -99, x: 0, z: 0, seed: Math.random() * 10 });
  }
  boomLight = new THREE.PointLight(0xff7a30, 0, 40, 1.6);
  scene.add(boomLight);
  boomShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false }),
  );
  boomShell.visible = false;
  scene.add(boomShell);
}

let tracerIdx = 0, flashIdx = 0, sparkIdx = 0, smokeIdx = 0;

export function spawnTracer(x1, y1, z1, x2, y2, z2, color) {
  const t = tracers[tracerIdx++ % TRACERS];
  const a = t.line.geometry.attributes.position.array;
  a[0] = x1; a[1] = y1; a[2] = z1; a[3] = x2; a[4] = y2; a[5] = z2;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.85;
  t.line.visible = true;
  t.until = performance.now() / 1000 + 0.055;
}
export function spawnSparks(x, y, z, n = 6, spread = 1.6) {
  for (let k = 0; k < n; k++) {
    const i = sparkIdx++ % SPARKS;
    sparkPos[i * 3] = x; sparkPos[i * 3 + 1] = y; sparkPos[i * 3 + 2] = z;
    sparkVel[i * 3] = (Math.random() - 0.5) * spread;
    sparkVel[i * 3 + 1] = Math.random() * spread * 0.9;
    sparkVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    sparkLife[i] = 0.25 + Math.random() * 0.3;
  }
}
export function spawnMuzzle(x, y, z) {
  const f = flashes[flashIdx++ % FLASHES];
  f.spr.position.set(x, y, z);
  f.spr.material.rotation = Math.random() * Math.PI;
  f.spr.visible = true;
  f.until = performance.now() / 1000 + 0.045;
}
export function spawnSmoke(x, z) {
  // a loose cluster of puffs that reads as one cloud from any angle
  for (let k = 0; k < 5; k++) {
    const s = smokes[smokeIdx++ % SMOKES];
    s.x = x + (Math.random() - 0.5) * 2.4;
    s.z = z + (Math.random() - 0.5) * 2.4;
    s.born = performance.now() / 1000 - k * 0.12;
    s.spr.visible = true;
  }
}
export function spawnExplosion(x, z) {
  boomAt = performance.now() / 1000;
  boomLight.position.set(x, 2.2, z);
  boomShell.position.set(x, 1.4, z);
  boomShell.visible = true;
  spawnSparks(x, 1.2, z, 60, 7);
}

const SMOKE_LIFE = 7.5;
export function updateFx() {
  const now = performance.now() / 1000;
  for (const t of tracers) if (t.line.visible && now > t.until) t.line.visible = false;
  for (const f of flashes) if (f.spr.visible && now > f.until) f.spr.visible = false;
  const dt = 1 / 60;
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -10; continue; }
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 5.5 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
    if (sparkPos[i * 3 + 1] < 0.03) sparkLife[i] = 0;
  }
  sparks.geometry.attributes.position.needsUpdate = true;
  for (const s of smokes) {
    if (!s.spr.visible) continue;
    const age = now - s.born;
    if (age > SMOKE_LIFE) { s.spr.visible = false; continue; }
    const grow = Math.min(1, age / 1.6);
    const fade = age > SMOKE_LIFE - 1.6 ? (SMOKE_LIFE - age) / 1.6 : 1;
    const size = 2.2 + grow * 4.4;
    s.spr.scale.set(size, size * 0.72, 1);
    s.spr.position.set(s.x, 1.15 + Math.sin(age * 0.7 + s.seed) * 0.12, s.z);
    s.spr.material.opacity = 0.85 * fade * Math.min(1, age * 3 + 0.2);
  }
  const boomAge = now - boomAt;
  if (boomShell.visible) {
    if (boomAge > 0.7) { boomShell.visible = false; boomLight.intensity = 0; }
    else {
      const k = boomAge / 0.7;
      boomShell.scale.setScalar(1 + k * 15);
      boomShell.material.opacity = 0.5 * (1 - k);
      boomLight.intensity = 900 * (1 - k);
    }
  }
}
