// HARBOURFALL — map.js
// The Kestrel Yard: an original container-terminal map on a 4 m grid.
// One string per row is the whole layout — '#' a concrete block, 'X' a
// shipping container, 'c' a low crate stack, 'A'/'B' the two cargo sites,
// 'a'/'d' the Viper and Warden spawn aprons. The same grid drives the
// collision boxes, the bot pathfinding (breadth-first over open cells)
// and the instanced meshes, so what the bots walk is what the player sees.

import * as THREE from 'three';
import { PALETTE } from './config.js';

export const CELL = 4;
export const COLS = 23;
export const ROWS = 16;

const GRID_TEXT = [
  '#######################',
  '#AAA#......#......#ddd#',
  '#AAA#.XX...#..XX..#ddd#',
  '#A.AA....#......#.....#',
  '##.##..XX#..XX..##.##.#',
  '#....#...c.#.......#..#',
  '#..XX..##..#..##.c.#..#',
  '#......#...#...#..XX..#',
  '#.XX...#..###..#......#',
  '#....##.....#.c..##..##',
  '#..#...XXc..#..XX...#.#',
  '#.##......#......#..BB#',
  '#......#..#..#..#..BBB#',
  '#aa....#..#..#..##.BBB#',
  '#aaa#......#......#BB.#',
  '#######################',
];

export const HEIGHTS = { '#': 3.4, X: 2.8, c: 1.4 };
const SOLID = new Set(['#', 'X', 'c']);

export function cellCenter(c, r) {
  return { x: (c - (COLS - 1) / 2) * CELL, z: (r - (ROWS - 1) / 2) * CELL };
}
export function cellAt(x, z) {
  return {
    c: Math.round(x / CELL + (COLS - 1) / 2),
    r: Math.round(z / CELL + (ROWS - 1) / 2),
  };
}
export function cellChar(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return '#';
  return GRID_TEXT[r][c];
}
export function isSolidCell(c, r) {
  return SOLID.has(cellChar(c, r));
}

// Collision boxes, one per solid cell: {minX, maxX, minZ, maxZ, h}.
export const colliders = [];
const spawnCells = { atk: [], def: [] };
const siteCells = { A: [], B: [] };
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const ch = GRID_TEXT[r][c];
    const { x, z } = cellCenter(c, r);
    if (SOLID.has(ch)) {
      colliders.push({
        minX: x - CELL / 2, maxX: x + CELL / 2,
        minZ: z - CELL / 2, maxZ: z + CELL / 2,
        h: HEIGHTS[ch], kind: ch,
      });
    } else if (ch === 'a') spawnCells.atk.push({ x, z });
    else if (ch === 'd') spawnCells.def.push({ x, z });
    else if (ch === 'A') siteCells.A.push({ x, z });
    else if (ch === 'B') siteCells.B.push({ x, z });
  }
}

function centroid(cells) {
  let x = 0, z = 0;
  for (const p of cells) { x += p.x; z += p.z; }
  return { x: x / cells.length, z: z / cells.length };
}
export const SITES = {
  A: { ...centroid(siteCells.A), r: 8.5, cells: siteCells.A },
  B: { ...centroid(siteCells.B), r: 8.5, cells: siteCells.B },
};
export const SPAWNS = spawnCells;
// Defender hold cells (col, row) with cover nearby, per site and mid.
export const HOLD_CELLS = {
  A: [[4, 2], [2, 4], [5, 3]],
  B: [[18, 12], [20, 10], [17, 13]],
  mid: [[11, 7], [10, 4], [13, 11]],
};
export function holdPoints(key) {
  return HOLD_CELLS[key].map(([c, r]) => cellCenter(c, r));
}
export function inSite(pos, site) {
  const s = SITES[site];
  const dx = pos.x - s.x, dz = pos.z - s.z;
  return dx * dx + dz * dz <= s.r * s.r;
}
export function siteAt(pos) {
  if (inSite(pos, 'A')) return 'A';
  if (inSite(pos, 'B')) return 'B';
  return null;
}

// ------------------------------------------------------------ pathfinding
// Breadth-first search over open cells; returns world-space waypoints from
// the cell beside the start to the target cell, or null when unreachable.
export function findPath(from, to) {
  const s = cellAt(from.x, from.z);
  const t = cellAt(to.x, to.z);
  if (isSolidCell(t.c, t.r)) return null;
  const key = (c, r) => r * COLS + c;
  const prev = new Map([[key(s.c, s.r), null]]);
  const queue = [[s.c, s.r]];
  for (let head = 0; head < queue.length; head++) {
    const [c, r] = queue[head];
    if (c === t.c && r === t.r) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, k = key(nc, nr);
      if (!prev.has(k) && !isSolidCell(nc, nr)) {
        prev.set(k, [c, r]);
        queue.push([nc, nr]);
      }
    }
  }
  if (!prev.has(key(t.c, t.r))) return null;
  const cells = [];
  let cur = [t.c, t.r];
  while (cur) { cells.push(cur); cur = prev.get(key(cur[0], cur[1])); }
  cells.reverse();
  return cells.slice(1).map(([c, r]) => cellCenter(c, r));
}

// ------------------------------------------------------------ textures
function canvasTexture(size, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function noise(ctx, s, base, fleck, n) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = fleck;
    ctx.globalAlpha = 0.05 + Math.random() * 0.1;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 2 + Math.random() * 5);
  }
  ctx.globalAlpha = 1;
}
const asphaltTex = () => canvasTexture(256, (ctx, s) => {
  noise(ctx, s, '#3a3e45', '#20242a', 900);
  ctx.strokeStyle = 'rgba(220,225,235,0.05)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(0, Math.random() * s); ctx.lineTo(s, Math.random() * s); ctx.stroke();
  }
}, [12, 9]);
const concreteTex = () => canvasTexture(256, (ctx, s) => {
  noise(ctx, s, '#5a616b', '#39404a', 500);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * s, 0, 3, s);
});
const containerTex = () => canvasTexture(256, (ctx, s) => {
  ctx.fillStyle = '#cfd4d8'; ctx.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 18) {           // corrugation
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(x, 0, 5, s);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x + 7, 0, 3, s);
  }
  ctx.fillStyle = 'rgba(20,24,30,0.55)';
  ctx.font = 'bold 26px monospace'; ctx.fillText('KESTREL', 18, 44);
  ctx.font = '15px monospace'; ctx.fillText('LINES · YARD 7', 18, 68);
  noise(ctx, s, 'rgba(0,0,0,0)', '#5a3a22', 260);   // rust flecks
});
const crateTex = () => canvasTexture(256, (ctx, s) => {
  noise(ctx, s, '#7d5f36', '#543e20', 240);
  ctx.strokeStyle = 'rgba(40,26,10,0.6)'; ctx.lineWidth = 5;
  for (let y = 0; y <= s; y += 52) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke(); }
  ctx.strokeRect(8, 8, s - 16, s - 16);
});
function siteDecalTex(letter, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------ scene build
export function buildMap(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 60, 175);

  const hemi = new THREE.HemisphereLight(0x9db1d4, 0x4a4034, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb45e, 2.0);
  sun.position.set(-40, 34, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS * CELL + 30, ROWS * CELL + 30),
    new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Site decals painted on the asphalt.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(7.6, 40),
      new THREE.MeshBasicMaterial({
        map: siteDecalTex(key, key === 'A' ? PALETTE.siteA : PALETTE.siteB),
        transparent: true, opacity: 0.85, depthWrite: false,
      }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(s.x, 0.03, s.z);
    scene.add(decal);
  }

  // Solid cells as three instanced meshes: concrete, containers, crates.
  const byKind = { '#': [], X: [], c: [] };
  for (const col of colliders) byKind[col.kind].push(col);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const addInstanced = (list, mat, colorFn) => {
    const mesh = new THREE.InstancedMesh(boxGeo, mat, list.length);
    list.forEach((col, i) => {
      const w = col.maxX - col.minX, d = col.maxZ - col.minZ;
      dummy.position.set((col.minX + col.maxX) / 2, col.h / 2, (col.minZ + col.maxZ) / 2);
      dummy.scale.set(w, col.h, d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (colorFn) mesh.setColorAt(i, colorFn(i));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  addInstanced(byKind['#'], new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.9 }));
  addInstanced(
    byKind.X,
    new THREE.MeshStandardMaterial({ map: containerTex(), roughness: 0.62, metalness: 0.35 }),
    (i) => new THREE.Color(PALETTE.containers[i % PALETTE.containers.length]),
  );
  addInstanced(byKind.c, new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.85 }));

  // Sodium lamp posts around the yard: emissive heads, four real lights.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.6, metalness: 0.6 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  const lampSpots = [[-22, -2], [12, -18], [24, 6], [-12, 18], [0, -30], [38, -8]];
  lampSpots.forEach(([x, z], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.6, 6), lampMat);
    pole.position.set(x, 2.8, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), bulbMat);
    bulb.position.set(x, 5.6, z);
    scene.add(bulb);
    if (i % 2 === 0) {
      const light = new THREE.PointLight(PALETTE.lamp, 100, 30, 1.8);
      light.position.set(x, 5.4, z);
      scene.add(light);
    }
  });

  // Distant port silhouettes: crane frames and a hull, pure mood.
  const silMat = new THREE.MeshBasicMaterial({ color: 0x11161f });
  const sil = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silMat);
    m.position.set(x, y, z);
    scene.add(m);
  };
  sil(70, 10, 8, 0, 5, -52);            // warehouse roofline north
  sil(10, 26, 2, -30, 13, -48);         // crane legs
  sil(10, 26, 2, -12, 13, -48);
  sil(24, 2, 2, -21, 25, -48);          // crane beam
  sil(90, 7, 10, 10, 3.5, 50);          // berthed hull south
  return { sun };
}

// The detpack: a slab with a blinking beacon, built once and moved by
// round.js / main.js as it changes hands.
export function buildBombMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.22, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x35322c, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.11;
  g.add(body);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  );
  beacon.position.y = 0.27;
  g.add(beacon);
  g.userData.beacon = beacon;
  return g;
}
